const express = require('express');
const cors = require('cors');
const mysql = require('mysql2/promise');
const { randomUUID, randomBytes, createHash, timingSafeEqual, scrypt: scryptCallback } = require('crypto');
const { promisify } = require('util');
const { buildBillReceipt, buildTestReceipt, checkNetworkPrinterStatus, printToDevice } = require('./printerService');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 5000;
const scrypt = promisify(scryptCallback);
const sessionCookieName = 'pos_session';
const sessionDurationSeconds = 8 * 60 * 60;
const loginAttemptWindowMs = 15 * 60 * 1000;
const loginIpAttemptLimit = 30;
const loginCredentialAttemptLimit = 10;
const loginIpAttempts = new Map();
const loginCredentialAttempts = new Map();
const configuredOrigins = (process.env.APP_ORIGINS || 'http://localhost:5173,http://127.0.0.1:5173,http://localhost:4173,http://127.0.0.1:4173')
  .split(',').map((origin) => origin.trim()).filter(Boolean);
const allowedOrigins = [...new Set(['http://localhost', 'http://127.0.0.1', ...configuredOrigins])];

const loginAttemptCleanup = setInterval(() => {
  const cutoff = Date.now() - loginAttemptWindowMs;
  for (const [key, attempt] of loginIpAttempts) {
    if (attempt.startedAt <= cutoff) loginIpAttempts.delete(key);
  }
  for (const [key, attempt] of loginCredentialAttempts) {
    if (attempt.startedAt <= cutoff) loginCredentialAttempts.delete(key);
  }
}, loginAttemptWindowMs);
loginAttemptCleanup.unref();

app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) return callback(null, origin || true);
    return callback(null, false);
  },
  credentials: true
}));
app.use(express.json());
app.use((req, res, next) => {
  const requestOrigin = req.headers.origin;
  if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && requestOrigin && !allowedOrigins.includes(requestOrigin)) {
    return res.status(403).json({ error: 'This request origin is not permitted.' });
  }
  next();
});

// MySQL connection pool
const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'restaurant_pos',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

(async () => {
  try {
    await ensureRestaurantSettings();
    await ensureMenuItemsSchema();
  } catch (err) {
    console.error('Unable to initialize restaurant settings or menu schema:', err.message);
  }
})();

// Health check
app.get('/api/health', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT 1 + 1 AS result');
    res.json({ status: 'ok', db: 'connected', time: new Date() });
  } catch (err) {
    res.status(500).json({ status: 'error', error: err.message });
  }
});

function publicUser(user) {
  return { id: user.id, name: user.name, email: user.email, role: user.role, phone: user.phone };
}

function cookieValue(cookieHeader, name) {
  const entry = String(cookieHeader || '').split(';').map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`));
  return entry ? decodeURIComponent(entry.slice(name.length + 1)) : '';
}

function sessionCookie(token, clear = false) {
  const attributes = [
    `${sessionCookieName}=${clear ? '' : encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Strict',
    `Max-Age=${clear ? 0 : sessionDurationSeconds}`
  ];
  if (process.env.COOKIE_SECURE === 'true') attributes.push('Secure');
  return attributes.join('; ');
}

function loginAttemptKey(req, email) {
  return `${req.socket.remoteAddress || 'unknown'}:${email}`;
}

function activeAttempt(map, key, now) {
  const attempt = map.get(key);
  if (!attempt || now - attempt.startedAt >= loginAttemptWindowMs) {
    map.delete(key);
    return null;
  }
  return attempt;
}

function loginRateLimit(req, email, res) {
  const now = Date.now();
  const ipKey = req.socket.remoteAddress || 'unknown';
  const credentialKey = loginAttemptKey(req, email);
  const ipAttempt = activeAttempt(loginIpAttempts, ipKey, now);
  const credentialAttempt = activeAttempt(loginCredentialAttempts, credentialKey, now);
  const blockedAttempts = [
    ipAttempt && ipAttempt.count >= loginIpAttemptLimit ? ipAttempt : null,
    credentialAttempt && credentialAttempt.count >= loginCredentialAttemptLimit ? credentialAttempt : null
  ].filter(Boolean);
  if (blockedAttempts.length) {
    const retryAt = Math.max(...blockedAttempts.map((attempt) => attempt.startedAt + loginAttemptWindowMs));
    const retryAfterSeconds = Math.max(1, Math.ceil((retryAt - now) / 1000));
    res.setHeader('Retry-After', String(retryAfterSeconds));
    res.status(429).json({ error: 'Too many sign-in attempts. Please try again later.' });
    return null;
  }
  return { ipKey, credentialKey };
}

function recordLoginFailure(keys) {
  const now = Date.now();
  for (const [map, key] of [
    [loginIpAttempts, keys.ipKey],
    [loginCredentialAttempts, keys.credentialKey]
  ]) {
    const attempt = activeAttempt(map, key, now);
    if (attempt) attempt.count += 1;
    else map.set(key, { startedAt: now, count: 1 });
  }
}

async function hashPassword(password, salt = randomBytes(16).toString('hex')) {
  const key = await scrypt(password, salt, 64);
  return `scrypt$${salt}$${key.toString('hex')}`;
}

async function matchesPassword(password, storedHash, legacyPassword) {
  if (storedHash) {
    const [algorithm, salt, expectedHex] = String(storedHash).split('$');
    if (algorithm !== 'scrypt' || !/^[0-9a-f]{32}$/.test(salt || '') || !/^[0-9a-f]{128}$/.test(expectedHex || '')) return false;
    const actual = await scrypt(password, salt, 64);
    return timingSafeEqual(actual, Buffer.from(expectedHex, 'hex'));
  }
  if (typeof legacyPassword !== 'string' || legacyPassword.length === 0) return false;
  const actual = Buffer.from(password);
  const expected = Buffer.from(legacyPassword);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

async function ensureRestaurantSettings() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS restaurant_settings (
      id TINYINT UNSIGNED NOT NULL PRIMARY KEY DEFAULT 1,
      restaurant_name VARCHAR(150) NOT NULL DEFAULT 'Proxima Technologies',
      business_email VARCHAR(150) NOT NULL DEFAULT 'admin@proxima.com',
      phone VARCHAR(30) NOT NULL DEFAULT '+94 77 234 5677',
      address VARCHAR(255) NOT NULL DEFAULT '123 Main Street, Colombo, Sri Lanka',
      timezone VARCHAR(80) NOT NULL DEFAULT 'Asia/Colombo',
      currency VARCHAR(10) NOT NULL DEFAULT 'LKR',
      receipt_header VARCHAR(255) NOT NULL DEFAULT 'Proxima Technologies',
      receipt_footer VARCHAR(255) NOT NULL DEFAULT 'Thank you for dining with us.',
      bill_printing_mode VARCHAR(50) NOT NULL DEFAULT 'ASK_LOCATION',
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    INSERT INTO restaurant_settings (
      id, restaurant_name, business_email, phone, address, timezone, currency, receipt_header, receipt_footer, bill_printing_mode
    ) VALUES (
      1, 'Proxima Technologies', 'admin@proxima.com', '+94 77 234 5677', '123 Main Street, Colombo, Sri Lanka', 'Asia/Colombo', 'LKR', 'Proxima Technologies', 'Thank you for dining with us.', 'ASK_LOCATION'
    ) ON DUPLICATE KEY UPDATE
      restaurant_name = VALUES(restaurant_name),
      business_email = VALUES(business_email),
      phone = VALUES(phone),
      address = VALUES(address),
      timezone = VALUES(timezone),
      currency = VALUES(currency),
      receipt_header = VALUES(receipt_header),
      receipt_footer = VALUES(receipt_footer),
      bill_printing_mode = VALUES(bill_printing_mode)
  `);
}

async function ensureMenuItemsSchema() {
  try {
    await pool.query('ALTER TABLE menu_items MODIFY COLUMN item_code VARCHAR(50) NULL');
  } catch (e) {
    // Ignore if already modified or table not present
  }
  try {
    await pool.query('ALTER TABLE menu_items ADD COLUMN IF NOT EXISTS barcode VARCHAR(100) NULL AFTER item_code');
  } catch (e) {
    try {
      const [cols] = await pool.query("SHOW COLUMNS FROM menu_items LIKE 'barcode'");
      if (!cols.length) {
        await pool.query('ALTER TABLE menu_items ADD COLUMN barcode VARCHAR(100) NULL AFTER item_code');
      }
    } catch (innerErr) {
      console.error('Barcode column check notice:', innerErr.message);
    }
  }
  try {
    const [indexes] = await pool.query("SHOW INDEX FROM menu_items WHERE Key_name = 'uq_menu_items_barcode'");
    if (!indexes.length) {
      await pool.query('ALTER TABLE menu_items ADD UNIQUE KEY uq_menu_items_barcode (barcode)');
    }
  } catch (e) {
    // Non-fatal if index exists
  }
  try {
    const [nameIdx] = await pool.query("SHOW INDEX FROM menu_items WHERE Key_name = 'idx_menu_items_name'");
    if (!nameIdx.length) {
      await pool.query('ALTER TABLE menu_items ADD INDEX idx_menu_items_name (name)');
    }
  } catch (e) {
    // Non-fatal
  }
  try {
    const [catIdx] = await pool.query("SHOW INDEX FROM menu_items WHERE Key_name = 'idx_menu_items_category'");
    if (!catIdx.length) {
      await pool.query('ALTER TABLE menu_items ADD INDEX idx_menu_items_category (category)');
    }
  } catch (e) {
    // Non-fatal
  }
}

// --- AUTH / USERS ---
app.post('/api/auth/register', async (req, res) => {
  const name = typeof req.body.name === 'string' ? req.body.name.trim() : '';
  const email = typeof req.body.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  const password = typeof req.body.password === 'string' ? req.body.password : '';
  if (!name || name.length > 100 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 150 ||
      password.length < 10 || password.length > 1024) {
    return res.status(400).json({ error: 'Enter a valid name, email, and password of at least 10 characters.' });
  }
  try {
    const passwordHash = await hashPassword(password);
    await pool.query(
      'INSERT INTO users (name, email, password, password_hash, role, status) VALUES (?, ?, ?, ?, ?, ?)',
      [name, email, '', passwordHash, 'Waiter', 'inactive']
    );
    res.status(201).json({ success: true, message: 'Account created. An administrator must activate it before you can sign in.' });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'An account already uses that email address.' });
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/auth/login', async (req, res) => {
  const email = typeof req.body.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  const password = typeof req.body.password === 'string' ? req.body.password : '';
  if (!email || !password || email.length > 150 || password.length > 1024) {
    return res.status(400).json({ error: 'Enter your email and password.' });
  }
  const attemptKeys = loginRateLimit(req, email, res);
  if (!attemptKeys) return;
  try {
    const [[user]] = await pool.query(
      'SELECT id, name, email, role, phone, status, password, password_hash FROM users WHERE email = ?',
      [email]
    );
    if (!user || user.status !== 'active' || !await matchesPassword(password, user.password_hash, user.password)) {
      recordLoginFailure(attemptKeys);
      return res.status(401).json({ error: 'Invalid email or password.' });
    }
    loginCredentialAttempts.delete(attemptKeys.credentialKey);
    if (!user.password_hash) {
      const passwordHash = await hashPassword(password);
      await pool.query('UPDATE users SET password_hash = ?, password = ? WHERE id = ?', [passwordHash, '', user.id]);
    }
    await pool.query('DELETE FROM auth_sessions WHERE expires_at <= UTC_TIMESTAMP()');
    const token = randomBytes(32).toString('hex');
    const tokenHash = createHash('sha256').update(token).digest('hex');
    await pool.query(
      'INSERT INTO auth_sessions (user_id, token_hash, expires_at) VALUES (?, ?, DATE_ADD(UTC_TIMESTAMP(), INTERVAL ? SECOND))',
      [user.id, tokenHash, sessionDurationSeconds]
    );
    res.setHeader('Set-Cookie', sessionCookie(token));
    res.json({ success: true, user: publicUser(user) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/auth/me', async (req, res) => {
  try {
    const token = cookieValue(req.headers.cookie, sessionCookieName);
    if (!token) return res.status(401).json({ error: 'Sign in to continue.' });
    const tokenHash = createHash('sha256').update(token).digest('hex');
    const [[user]] = await pool.query(
      `SELECT u.id, u.name, u.email, u.role, u.phone
       FROM auth_sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = ? AND s.expires_at > UTC_TIMESTAMP() AND u.status = 'active'`,
      [tokenHash]
    );
    if (!user) return res.status(401).json({ error: 'Your session has expired. Sign in again.' });
    res.json({ user: publicUser(user) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/auth/logout', async (req, res) => {
  try {
    const token = cookieValue(req.headers.cookie, sessionCookieName);
    if (token) {
      const tokenHash = createHash('sha256').update(token).digest('hex');
      await pool.query('DELETE FROM auth_sessions WHERE token_hash = ?', [tokenHash]);
    }
    res.setHeader('Set-Cookie', sessionCookie('', true));
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.use('/api', async (req, res, next) => {
  if (req.path === '/health' || req.path === '/auth/register' || req.path === '/auth/login' || req.path === '/auth/me' || req.path === '/auth/logout') {
    return next();
  }
  try {
    const token = cookieValue(req.headers.cookie, sessionCookieName);
    if (!token) return res.status(401).json({ error: 'Sign in to continue.' });
    const tokenHash = createHash('sha256').update(token).digest('hex');
    const [[user]] = await pool.query(
      `SELECT u.id, u.name, u.email, u.role, u.phone
       FROM auth_sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = ? AND s.expires_at > UTC_TIMESTAMP() AND u.status = 'active'`,
      [tokenHash]
    );
    if (!user) return res.status(401).json({ error: 'Your session has expired. Sign in again.' });
    req.user = user;
    next();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// RBAC authorization helper: Admin has full access to every protected resource.
// Other roles must match one of the allowedRoles.
function requireRole(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Sign in to continue.' });
    }
    // Super-access: Admin is never restricted by role requirements
    if (req.user.role === 'Admin') {
      return next();
    }
    if (allowedRoles.length && !allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ error: `Access denied. Role "${req.user.role}" does not have permission.` });
    }
    next();
  };
}

// Audit logger helper
async function recordAuditLog(req, action, targetModule, details = '') {
  try {
    const userId = req.user ? req.user.id : null;
    const userName = req.user ? req.user.name : 'System';
    const userRole = req.user ? req.user.role : 'System';
    const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '';
    await pool.query(
      `INSERT INTO audit_logs (user_id, user_name, user_role, action, target_module, details, ip_address)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [userId, userName, userRole, action, targetModule, typeof details === 'object' ? JSON.stringify(details) : String(details), clientIp]
    );
  } catch (auditErr) {
    console.error('Audit logging error:', auditErr.message);
  }
}

app.get('/api/settings', async (req, res) => {
  if (req.user.role !== 'Admin') return res.status(403).json({ error: 'Only administrators can view restaurant settings.' });
  try {
    await ensureRestaurantSettings();
    const [[settings]] = await pool.query('SELECT * FROM restaurant_settings WHERE id = 1');
    res.json(settings || {
      restaurant_name: 'Proxima Technologies',
      business_email: 'admin@proxima.com',
      phone: '+94 77 234 5677',
      address: '123 Main Street, Colombo, Sri Lanka',
      timezone: 'Asia/Colombo',
      currency: 'LKR',
      receipt_header: 'Proxima Technologies',
      receipt_footer: 'Thank you for dining with us.'
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/settings', async (req, res) => {
  if (req.user.role !== 'Admin') return res.status(403).json({ error: 'Only administrators can update restaurant settings.' });
  const restaurantName = typeof req.body.restaurant_name === 'string' ? req.body.restaurant_name.trim() : '';
  const businessEmail = typeof req.body.business_email === 'string' ? req.body.business_email.trim().toLowerCase() : '';
  const phone = typeof req.body.phone === 'string' ? req.body.phone.trim() : '';
  const address = typeof req.body.address === 'string' ? req.body.address.trim() : '';
  const timezone = typeof req.body.timezone === 'string' ? req.body.timezone.trim() : '';
  const currency = typeof req.body.currency === 'string' ? req.body.currency.trim().toUpperCase() : '';
  const receiptHeader = typeof req.body.receipt_header === 'string' ? req.body.receipt_header.trim() : '';
  const receiptFooter = typeof req.body.receipt_footer === 'string' ? req.body.receipt_footer.trim() : '';
  const billPrintingMode = typeof req.body.bill_printing_mode === 'string' && req.body.bill_printing_mode.trim() ? req.body.bill_printing_mode.trim() : 'ASK_LOCATION';

  if (!restaurantName || restaurantName.length > 150 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(businessEmail) || businessEmail.length > 150 ||
      !phone || phone.length > 30 ||
      !address || address.length > 255 ||
      !timezone || timezone.length > 80 ||
      !currency || currency.length > 10 ||
      !receiptHeader || receiptHeader.length > 255 ||
      !receiptFooter || receiptFooter.length > 255) {
    return res.status(400).json({ error: 'Check the restaurant name, email, phone, address, timezone, currency, and receipt text.' });
  }

  try {
    await ensureRestaurantSettings();
    const [result] = await pool.query(
      `INSERT INTO restaurant_settings
       (id, restaurant_name, business_email, phone, address, timezone, currency, receipt_header, receipt_footer, bill_printing_mode)
       VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         restaurant_name = VALUES(restaurant_name),
         business_email = VALUES(business_email),
         phone = VALUES(phone),
         address = VALUES(address),
         timezone = VALUES(timezone),
         currency = VALUES(currency),
         receipt_header = VALUES(receipt_header),
         receipt_footer = VALUES(receipt_footer),
         bill_printing_mode = VALUES(bill_printing_mode)`,
      [restaurantName, businessEmail, phone, address, timezone, currency, receiptHeader, receiptFooter, billPrintingMode]
    );

    const [[settings]] = await pool.query('SELECT * FROM restaurant_settings WHERE id = 1');
    res.json({ success: true, settings: settings || { restaurant_name: restaurantName, business_email: businessEmail, phone, address, timezone, currency, receipt_header: receiptHeader, receipt_footer: receiptFooter, bill_printing_mode: billPrintingMode } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/users', async (req, res) => {
  if (req.user.role !== 'Admin') return res.status(403).json({ error: 'Only administrators can view staff accounts.' });
  try {
    const [users] = await pool.query('SELECT id, name, email, role, phone, status FROM users ORDER BY id ASC');
    res.json(users);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/users', async (req, res) => {
  if (req.user.role !== 'Admin') return res.status(403).json({ error: 'Only administrators can create staff accounts.' });
  const name = typeof req.body.name === 'string' ? req.body.name.trim() : '';
  const email = typeof req.body.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  const phone = typeof req.body.phone === 'string' ? req.body.phone.trim() : '';
  const password = typeof req.body.password === 'string' ? req.body.password : '';
  const { role } = req.body;
  if (!name || name.length > 100 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 150 ||
      phone.length > 30 || !['Admin', 'Cashier', 'Waiter', 'Kitchen'].includes(role) ||
      password.length < 10 || password.length > 1024) {
    return res.status(400).json({ error: 'Enter a valid name, email, role, phone, and password of at least 10 characters.' });
  }
  try {
    const passwordHash = await hashPassword(password);
    const [result] = await pool.query(
      'INSERT INTO users (name, email, password, password_hash, role, phone, status) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [name, email, '', passwordHash, role, phone || null, req.body.status === 'inactive' ? 'inactive' : 'active']
    );
    res.status(201).json({ success: true, id: result.insertId, message: 'Staff account created.' });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'An account already uses that email address.' });
    res.status(500).json({ error: err.message });
  }
});

app.patch('/api/users/:id', async (req, res) => {
  if (req.user.role !== 'Admin') return res.status(403).json({ error: 'Only administrators can update staff accounts.' });
  const userId = Number(req.params.id);
  const name = typeof req.body.name === 'string' ? req.body.name.trim() : '';
  const email = typeof req.body.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  const phone = typeof req.body.phone === 'string' ? req.body.phone.trim() : '';
  const { role, status } = req.body;
  const password = req.body.password;
  if (!Number.isInteger(userId) || userId < 1 || !name || name.length > 100 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 150 ||
      phone.length > 30 || !['Admin', 'Cashier', 'Waiter', 'Kitchen'].includes(role) ||
      !['active', 'inactive'].includes(status) ||
      (password !== undefined && password !== '' && (typeof password !== 'string' || password.length < 10 || password.length > 1024))) {
    return res.status(400).json({ error: 'Check the account details, status, and any new password (at least 10 characters).' });
  }
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [[target]] = await connection.query(
      'SELECT id, role, status FROM users WHERE id = ? FOR UPDATE',
      [userId]
    );
    if (!target) {
      await connection.rollback();
      return res.status(404).json({ error: 'Staff account not found.' });
    }
    const removesAdminAccess = target.role === 'Admin' && target.status === 'active' &&
      (role !== 'Admin' || status !== 'active');
    if (removesAdminAccess) {
      const [activeAdmins] = await connection.query(
        "SELECT id FROM users WHERE role = 'Admin' AND status = 'active' FOR UPDATE"
      );
      if (activeAdmins.length <= 1) {
        await connection.rollback();
        return res.status(409).json({ error: 'The last active administrator cannot be deactivated or changed to another role.' });
      }
    }
    const passwordHash = password ? await hashPassword(password) : null;
    await connection.query(
      `UPDATE users SET name = ?, email = ?, phone = ?, role = ?, status = ?,
       password_hash = COALESCE(?, password_hash), password = IF(? IS NULL, password, '')
       WHERE id = ?`,
      [name, email, phone || null, role, status, passwordHash, passwordHash, userId]
    );
    if (passwordHash || target.role !== role || target.status !== status) {
      await connection.query('DELETE FROM auth_sessions WHERE user_id = ?', [userId]);
    }
    await connection.commit();
    res.json({ success: true, message: 'Staff account updated.' });
  } catch (err) {
    await connection.rollback();
    if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'An account already uses that email address.' });
    res.status(500).json({ error: err.message });
  } finally {
    connection.release();
  }
});

app.get('/api/stewards', async (req, res) => {
  try {
    const [stewards] = await pool.query('SELECT id, name, active FROM stewards ORDER BY name ASC');
    res.json(stewards);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/stewards', async (req, res) => {
  if (req.user.role !== 'Admin') return res.status(403).json({ error: 'Only administrators can manage stewards.' });
  const name = typeof req.body.name === 'string' ? req.body.name.trim() : '';
  if (!name || name.length > 100) return res.status(400).json({ error: 'Enter a steward name of up to 100 characters.' });
  try {
    const [result] = await pool.query('INSERT INTO stewards (name) VALUES (?)', [name]);
    res.json({ success: true, id: result.insertId, message: 'Steward added' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.patch('/api/stewards/:id', async (req, res) => {
  if (req.user.role !== 'Admin') return res.status(403).json({ error: 'Only administrators can manage stewards.' });
  const name = typeof req.body.name === 'string' ? req.body.name.trim() : '';
  const active = req.body.active;
  if (!name || name.length > 100 || typeof active !== 'boolean') {
    return res.status(400).json({ error: 'Enter a steward name and choose whether the steward is active.' });
  }
  try {
    const [result] = await pool.query('UPDATE stewards SET name = ?, active = ? WHERE id = ?', [name, active, req.params.id]);
    if (!result.affectedRows) return res.status(404).json({ error: 'Steward not found.' });
    res.json({ success: true, message: 'Steward updated' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- MENU ITEMS ---
app.get('/api/menu', async (req, res) => {
  try {
    const [items] = await pool.query('SELECT * FROM menu_items ORDER BY id ASC');
    res.json(req.user.role === 'Admin' ? items : items.map(({ cost, ...item }) => item));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/menu/search', async (req, res) => {
  const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  const code = typeof req.query.code === 'string' ? req.query.code.trim() : '';
  const barcode = typeof req.query.barcode === 'string' ? req.query.barcode.trim() : '';
  const exact = req.query.exact === 'true' || req.query.exact === '1';
  const availableOnly = req.query.available_only === 'true' || req.query.available_only === '1';
  const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 25));

  try {
    let query = '';
    let params = [];

    if (code) {
      if (exact) {
        query = `SELECT * FROM menu_items WHERE LOWER(item_code) = LOWER(?) ${availableOnly ? 'AND available = 1' : ''} LIMIT ?`;
        params = [code, limit];
      } else {
        query = `
          SELECT *,
            CASE
              WHEN LOWER(item_code) = LOWER(?) THEN 1
              WHEN LOWER(item_code) LIKE LOWER(?) THEN 2
              ELSE 3
            END AS search_rank
          FROM menu_items
          WHERE (LOWER(item_code) = LOWER(?) OR LOWER(item_code) LIKE LOWER(?))
          ${availableOnly ? 'AND available = 1' : ''}
          ORDER BY search_rank ASC, name ASC
          LIMIT ?
        `;
        params = [code, `${code}%`, code, `${code}%`, limit];
      }
    } else if (barcode) {
      if (exact) {
        query = `SELECT * FROM menu_items WHERE barcode = ? ${availableOnly ? 'AND available = 1' : ''} LIMIT ?`;
        params = [barcode, limit];
      } else {
        query = `
          SELECT *,
            CASE
              WHEN barcode = ? THEN 1
              WHEN barcode LIKE ? THEN 2
              ELSE 3
            END AS search_rank
          FROM menu_items
          WHERE (barcode = ? OR barcode LIKE ?)
          ${availableOnly ? 'AND available = 1' : ''}
          ORDER BY search_rank ASC, name ASC
          LIMIT ?
        `;
        params = [barcode, `${barcode}%`, barcode, `${barcode}%`, limit];
      }
    } else if (q) {
      const qLower = q.toLowerCase();
      const qPrefix = `${qLower}%`;
      const qLike = `%${qLower}%`;

      query = `
        SELECT *,
          CASE
            WHEN LOWER(item_code) = ? THEN 1
            WHEN barcode = ? THEN 2
            WHEN LOWER(name) = ? THEN 3
            WHEN LOWER(item_code) LIKE ? THEN 4
            WHEN barcode LIKE ? THEN 5
            WHEN LOWER(name) LIKE ? THEN 6
            WHEN LOWER(item_code) LIKE ? THEN 7
            WHEN barcode LIKE ? THEN 8
            WHEN LOWER(name) LIKE ? THEN 9
            WHEN LOWER(category) LIKE ? THEN 10
            ELSE 11
          END AS search_rank
        FROM menu_items
        WHERE (
          LOWER(item_code) = ?
          OR barcode = ?
          OR LOWER(name) = ?
          OR LOWER(item_code) LIKE ?
          OR barcode LIKE ?
          OR LOWER(name) LIKE ?
          OR LOWER(category) LIKE ?
        )
        ${availableOnly ? 'AND available = 1' : ''}
        ORDER BY search_rank ASC, name ASC
        LIMIT ?
      `;
      params = [
        qLower, q, qLower,
        qPrefix, `${q}%`, qPrefix,
        qLike, `%${q}%`, qLike, qLike,
        qLower, q, qLower,
        qLike, `%${q}%`, qLike, qLike,
        limit
      ];
    } else {
      query = `SELECT * FROM menu_items ${availableOnly ? 'WHERE available = 1' : ''} ORDER BY id ASC LIMIT ?`;
      params = [limit];
    }

    const [items] = await pool.query(query, params);
    const sanitized = req.user.role === 'Admin' ? items : items.map(({ cost, ...item }) => item);
    res.json(sanitized);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/menu/generate-code', async (req, res) => {
  if (req.user.role !== 'Admin') return res.status(403).json({ error: 'Only administrators can generate item codes.' });
  const category = typeof req.query.category === 'string' ? req.query.category.trim().toLowerCase() : '';
  let prefix = 'ITM';
  if (category.includes('drink') || category.includes('beverage') || category.includes('juice') || category.includes('bar')) {
    prefix = 'DR';
  } else if (category.includes('food') || category.includes('rice') || category.includes('kottu') || category.includes('starter') || category.includes('main') || category.includes('burger')) {
    prefix = 'FD';
  } else if (category.includes('dessert') || category.includes('sweet') || category.includes('bakery')) {
    prefix = 'DS';
  }
  
  if (req.query.prefix && typeof req.query.prefix === 'string') {
    const customPrefix = req.query.prefix.trim().toUpperCase();
    if (/^[A-Za-z0-9_-]{2,10}$/.test(customPrefix)) {
      prefix = customPrefix;
    }
  }

  try {
    const [rows] = await pool.query('SELECT item_code FROM menu_items WHERE item_code LIKE ?', [`${prefix}%`]);
    let maxNum = 0;
    const numRegex = new RegExp(`^${prefix}[-_]?([0-9]+)$`, 'i');
    for (const r of rows) {
      const match = String(r.item_code).match(numRegex);
      if (match && match[1]) {
        const num = parseInt(match[1], 10);
        if (num > maxNum) maxNum = num;
      }
    }
    const nextNum = maxNum + 1;
    const formattedNum = prefix.length <= 2 ? String(nextNum).padStart(3, '0') : String(nextNum).padStart(6, '0');
    const generatedCode = prefix.length <= 2 ? `${prefix}${formattedNum}` : `${prefix}-${formattedNum}`;
    res.json({ code: generatedCode });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/menu/items/:id/add-to-cart', async (req, res) => {
  const { id } = req.params;
  const { quantity = 1, special_instruction = '' } = req.body || {};
  try {
    const [[item]] = await pool.query('SELECT * FROM menu_items WHERE id = ?', [id]);
    if (!item) return res.status(404).json({ error: 'Menu item not found.' });
    if (!item.available) {
      return res.status(400).json({ error: `"${item.name}" is currently marked unavailable.` });
    }
    const price = item.pricing_type === 'Open' ? (req.body.price !== undefined ? Number(req.body.price) : 0) : Number(item.price);
    const cartLine = {
      id: item.id,
      name: item.name,
      code: item.item_code,
      barcode: item.barcode,
      category: item.category,
      price,
      quantity: Math.max(1, Math.min(99, Number(quantity) || 1)),
      openPrice: item.pricing_type === 'Open',
      is_free: Boolean(item.is_free),
      department: item.department,
      special_instruction: String(special_instruction || '').slice(0, 500)
    };
    res.json({ success: true, item: cartLine });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/menu', async (req, res) => {
  if (req.user.role !== 'Admin') return res.status(403).json({ error: 'Only administrators can change menu items or costs.' });
  const {
    item_code, barcode, name, description, category, price, cost, stock_quantity,
    pricing_type, department, is_free, sends_to_kot, image, available, reorder_level
  } = req.body;
  const normalizedCode = typeof item_code === 'string' ? item_code.trim() : '';
  const normalizedBarcode = typeof barcode === 'string' && barcode.trim() ? barcode.trim() : null;
  const parsedPrice = Number(price);
  const parsedCost = Number(cost ?? 0);
  const parsedStock = Number(stock_quantity ?? 0);
  const parsedReorderLevel = Number(reorder_level ?? 5);
  const isFree = is_free === true;

  if (!normalizedCode || !/^[A-Za-z0-9_-]{2,50}$/.test(normalizedCode)) {
    return res.status(400).json({ error: 'Enter a unique item code (2–50 letters, numbers, _ or -).' });
  }
  if (normalizedBarcode && !/^[A-Za-z0-9_-]{3,100}$/.test(normalizedBarcode)) {
    return res.status(400).json({ error: 'Enter a valid barcode (3–100 letters, numbers, _ or -).' });
  }
  if (!name?.trim() || !category?.trim() || !Number.isFinite(parsedPrice) || parsedPrice < 0 || parsedPrice > 99999999.99 ||
      !Number.isFinite(parsedCost) || parsedCost < 0 || parsedCost > 99999999.99 ||
      !Number.isFinite(parsedStock) || parsedStock < 0 || parsedStock > 99999999.99 ||
      !Number.isFinite(parsedReorderLevel) || parsedReorderLevel < 0 || parsedReorderLevel > 99999999.99 ||
      (parsedPrice === 0 && !isFree && (pricing_type || 'Fixed') !== 'Open') ||
      !['Fixed', 'Open'].includes(pricing_type || 'Fixed') ||
      !['Kitchen', 'Bar', 'None'].includes(department || 'Kitchen')) {
    return res.status(400).json({ error: 'Check the item name, category, price, cost, stock, and settings.' });
  }
  try {
    const [result] = await pool.query(
      `INSERT INTO menu_items
       (item_code, barcode, name, description, category, price, cost, stock_quantity, reorder_level, pricing_type, department, is_free, sends_to_kot, image, available)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [normalizedCode, normalizedBarcode, name.trim(), description || '', category.trim(), parsedPrice, parsedCost, parsedStock, parsedReorderLevel,
        pricing_type || 'Fixed', department || 'Kitchen', isFree, sends_to_kot !== false,
        image || null, available !== false]
    );
    res.json({ success: true, id: result.insertId, message: 'Menu item created' });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      const msg = `${err.sqlMessage || ''} ${err.message || ''}`.toLowerCase();
      if (msg.includes('barcode')) {
        return res.status(409).json({ error: `Barcode "${normalizedBarcode}" is already in use by another item.` });
      }
      return res.status(409).json({ error: `Item code "${normalizedCode}" is already in use.` });
    }
    res.status(500).json({ error: err.message });
  }
});

app.patch('/api/menu/:id', async (req, res) => {
  if (req.user.role !== 'Admin') return res.status(403).json({ error: 'Only administrators can change menu items or costs.' });
  const { id } = req.params;
  const {
    item_code, barcode, name, description, category, price, cost, stock_quantity,
    pricing_type, department, is_free, sends_to_kot, image, available, reorder_level
  } = req.body;
  const normalizedCode = typeof item_code === 'string' ? item_code.trim() : '';
  const normalizedBarcode = typeof barcode === 'string' && barcode.trim() ? barcode.trim() : null;
  const parsedPrice = Number(price);
  const parsedCost = Number(cost ?? 0);
  const parsedStock = Number(stock_quantity ?? 0);
  const parsedReorderLevel = Number(reorder_level ?? 5);
  const isFree = is_free === true;

  if (!normalizedCode || !/^[A-Za-z0-9_-]{2,50}$/.test(normalizedCode)) {
    return res.status(400).json({ error: 'Enter a valid item code (2–50 letters, numbers, _ or -).' });
  }
  if (normalizedBarcode && !/^[A-Za-z0-9_-]{3,100}$/.test(normalizedBarcode)) {
    return res.status(400).json({ error: 'Enter a valid barcode (3–100 letters, numbers, _ or -).' });
  }
  if (!name?.trim() || !category?.trim() ||
      !Number.isFinite(parsedPrice) || parsedPrice < 0 || parsedPrice > 99999999.99 || (parsedPrice === 0 && !isFree && pricing_type !== 'Open') ||
      !Number.isFinite(parsedCost) || parsedCost < 0 || parsedCost > 99999999.99 ||
      !Number.isFinite(parsedStock) || parsedStock < 0 || parsedStock > 99999999.99 ||
      !Number.isFinite(parsedReorderLevel) || parsedReorderLevel < 0 || parsedReorderLevel > 99999999.99 ||
      !['Fixed', 'Open'].includes(pricing_type) || !['Kitchen', 'Bar', 'None'].includes(department)) {
    return res.status(400).json({ error: 'Check the item code, name, category, price, cost, stock, and settings.' });
  }
  try {
    const [result] = await pool.query(
      `UPDATE menu_items SET item_code = ?, barcode = ?, name = ?, description = ?, category = ?, price = ?, cost = ?,
       stock_quantity = ?, reorder_level = ?, pricing_type = ?, department = ?, is_free = ?, sends_to_kot = ?, image = ?, available = ?
       WHERE id = ?`,
      [normalizedCode, normalizedBarcode, name.trim(), description || '', category.trim(), parsedPrice, parsedCost, parsedStock, parsedReorderLevel,
        pricing_type, department, isFree, sends_to_kot !== false, image || null, available !== false, id]
    );
    if (!result.affectedRows) return res.status(404).json({ error: 'Menu item not found.' });
    res.json({ success: true, message: 'Menu item updated' });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      const msg = `${err.sqlMessage || ''} ${err.message || ''}`.toLowerCase();
      if (msg.includes('barcode')) {
        return res.status(409).json({ error: `Barcode "${normalizedBarcode}" is already in use by another item.` });
      }
      return res.status(409).json({ error: `Item code "${normalizedCode}" is already in use.` });
    }
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/menu/:id', async (req, res) => {
  if (req.user.role !== 'Admin') return res.status(403).json({ error: 'Only administrators can change menu items.' });
  try {
    const [result] = await pool.query('DELETE FROM menu_items WHERE id = ?', [req.params.id]);
    if (!result.affectedRows) return res.status(404).json({ error: 'Menu item not found.' });
    res.json({ success: true, message: 'Menu item removed' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- CATEGORIES ---
app.get('/api/categories', async (req, res) => {
  try {
    const [categories] = await pool.query('SELECT * FROM categories ORDER BY id ASC');
    res.json(categories);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/categories', requireRole('Admin'), async (req, res) => {
  const name = typeof req.body.name === 'string' ? req.body.name.trim() : '';
  if (!name || name.length > 50) return res.status(400).json({ error: 'Category name must be between 1 and 50 characters.' });
  try {
    const [result] = await pool.query('INSERT INTO categories (name) VALUES (?)', [name]);
    await recordAuditLog(req, 'CREATE_CATEGORY', 'menu', { categoryId: result.insertId, name });
    res.status(201).json({ success: true, id: result.insertId, name, message: 'Category added' });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Category already exists.' });
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/categories/:id', requireRole('Admin'), async (req, res) => {
  try {
    const [result] = await pool.query('DELETE FROM categories WHERE id = ?', [req.params.id]);
    if (!result.affectedRows) return res.status(404).json({ error: 'Category not found.' });
    await recordAuditLog(req, 'DELETE_CATEGORY', 'menu', { categoryId: req.params.id });
    res.json({ success: true, message: 'Category deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- TABLES ---
app.get('/api/tables', async (req, res) => {
  try {
    const [tables] = await pool.query('SELECT * FROM dining_tables ORDER BY id ASC');
    res.json(tables);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/tables', requireRole('Admin'), async (req, res) => {
  const tableNumber = typeof req.body.table_number === 'string' ? req.body.table_number.trim() : '';
  const capacity = parseInt(req.body.capacity, 10) || 4;
  if (!tableNumber || tableNumber.length > 20) return res.status(400).json({ error: 'Table number is required.' });
  try {
    const [result] = await pool.query(
      'INSERT INTO dining_tables (table_number, capacity, status) VALUES (?, ?, ?)',
      [tableNumber, capacity, req.body.status || 'Available']
    );
    await recordAuditLog(req, 'CREATE_TABLE', 'tables', { tableId: result.insertId, tableNumber, capacity });
    res.status(201).json({ success: true, id: result.insertId, message: 'Table created' });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'A table with that number already exists.' });
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/tables/:id', requireRole('Admin'), async (req, res) => {
  const tableId = parseInt(req.params.id, 10);
  const tableNumber = typeof req.body.table_number === 'string' ? req.body.table_number.trim() : '';
  const capacity = parseInt(req.body.capacity, 10) || 4;
  const status = req.body.status || 'Available';
  if (!tableNumber) return res.status(400).json({ error: 'Table number is required.' });
  try {
    const [result] = await pool.query(
      'UPDATE dining_tables SET table_number = ?, capacity = ?, status = ? WHERE id = ?',
      [tableNumber, capacity, status, tableId]
    );
    if (!result.affectedRows) return res.status(404).json({ error: 'Table not found.' });
    await recordAuditLog(req, 'UPDATE_TABLE', 'tables', { tableId, tableNumber, capacity, status });
    res.json({ success: true, message: 'Table updated successfully' });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Table number already in use.' });
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/tables/:id', requireRole('Admin'), async (req, res) => {
  const tableId = parseInt(req.params.id, 10);
  try {
    const [result] = await pool.query('DELETE FROM dining_tables WHERE id = ?', [tableId]);
    if (!result.affectedRows) return res.status(404).json({ error: 'Table not found.' });
    await recordAuditLog(req, 'DELETE_TABLE', 'tables', { tableId });
    res.json({ success: true, message: 'Table removed' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.patch('/api/tables/:id/status', async (req, res) => {
  if (!['Admin', 'Waiter'].includes(req.user.role)) {
    return res.status(403).json({ error: 'Only waiters or administrators can update table status.' });
  }
  const { id } = req.params;
  const { status } = req.body;
  try {
    await pool.query('UPDATE dining_tables SET status = ? WHERE id = ?', [status, id]);
    res.json({ success: true, message: 'Table status updated' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- ORDERS ---
app.get('/api/orders', async (req, res) => {
  if (!['Admin', 'Cashier', 'Waiter'].includes(req.user.role)) {
    return res.status(403).json({ error: 'Your account cannot view order details.' });
  }
  try {
    const [orders] = await pool.query('SELECT * FROM orders ORDER BY id DESC');
    res.json(orders);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/orders', async (req, res) => {
  if (!['Admin', 'Cashier', 'Waiter'].includes(req.user.role)) {
    return res.status(403).json({ error: 'Only front-of-house staff can create orders.' });
  }
  const { order_type, table_number, customer_name, customer_note, steward_id, items, created_by, idempotency_key } = req.body;
  if (!Array.isArray(items) || items.length === 0 || items.length > 100 ||
      !['Dine in', 'Takeaway', 'Delivery'].includes(order_type || 'Dine in') ||
      typeof idempotency_key !== 'string' || idempotency_key.length < 16 || idempotency_key.length > 64) {
    return res.status(400).json({ error: 'The order is incomplete or invalid. Please review it and try again.' });
  }
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const [existing] = await connection.query(
      'SELECT id, order_code, total_amount FROM orders WHERE idempotency_key = ?',
      [idempotency_key]
    );
    if (existing.length) {
      await connection.commit();
      return res.json({ success: true, orderId: existing[0].id, order_code: existing[0].order_code, total_amount: existing[0].total_amount, message: 'Order already received' });
    }

    let totalCents = 0;
    const orderItems = [];
    for (const item of items) {
      const quantity = Number(item.quantity ?? item.qty);
      const itemId = Number(item.id);
      if (!Number.isInteger(itemId) || !Number.isInteger(quantity) || quantity < 1 || quantity > 99) {
        throw Object.assign(new Error('Each item needs a valid item and quantity between 1 and 99.'), { statusCode: 400 });
      }
      const [[menuItem]] = await connection.query(
        'SELECT id, name, price, pricing_type, is_free, available, department, sends_to_kot FROM menu_items WHERE id = ? FOR UPDATE',
        [itemId]
      );
      if (!menuItem || !menuItem.available) {
        throw Object.assign(new Error('A selected item is no longer available. Refresh the menu and try again.'), { statusCode: 409 });
      }
      const price = menuItem.pricing_type === 'Open' ? Number(item.price) : Number(menuItem.price);
      if (!Number.isFinite(price) || price < 0 || (price === 0 && !menuItem.is_free)) {
        throw Object.assign(new Error(`Enter a valid price for ${menuItem.name}.`), { statusCode: 400 });
      }
      const unitCents = Math.round(price * 100);
      const subtotalCents = unitCents * quantity;
      if (!Number.isSafeInteger(subtotalCents) || subtotalCents > 9999999999) {
        throw Object.assign(new Error('The item total is too large.'), { statusCode: 400 });
      }
      totalCents += subtotalCents;
      if (!Number.isSafeInteger(totalCents) || totalCents > 9999999999) {
        throw Object.assign(new Error('The order total is too large.'), { statusCode: 400 });
      }
      orderItems.push({
        itemId, name: menuItem.name, quantity, unitPrice: unitCents / 100,
        subtotal: subtotalCents / 100,
        specialInstruction: String(item.special_instruction || '').slice(0, 500),
        department: menuItem.department || 'Kitchen',
        sendsToKot: Boolean(menuItem.sends_to_kot)
      });
    }

    const stations = [...new Set(orderItems.filter((item) => item.sendsToKot && item.department !== 'None').map((item) => item.department))];
    if ((order_type || 'Dine in') === 'Dine in' && !table_number) {
      throw Object.assign(new Error('Select a table for a dine-in order.'), { statusCode: 400 });
    }
    if (steward_id) {
      const [[steward]] = await connection.query(
        'SELECT id FROM stewards WHERE id = ? AND active = TRUE',
        [steward_id]
      );
      if (!steward) throw Object.assign(new Error('The selected steward is not active.'), { statusCode: 400 });
    }

    const order_code = `#${randomUUID().replace(/-/g, '').slice(0, 16)}`;
    const [orderResult] = await connection.query(
      `INSERT INTO orders
       (order_code, order_type, table_number, customer_name, customer_note, steward_id, total_amount, status, payment_status, payment_method, created_by, idempotency_key)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [order_code, order_type || 'Dine in', table_number || '—', customer_name?.trim() || 'Guest',
        String(customer_note || '').slice(0, 1000), steward_id || null, totalCents / 100, stations.length ? 'Pending' : 'Ready',
        totalCents === 0 ? 'Paid' : 'Unpaid', totalCents === 0 ? 'Complimentary' : 'Unpaid',
        created_by || 'Staff', idempotency_key]
    );
    const orderId = orderResult.insertId;

    for (const item of orderItems) {
      await connection.query(
        `INSERT INTO order_items (order_id, menu_item_id, item_name, quantity, unit_price, subtotal, special_instruction, department, sends_to_kot)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [orderId, item.itemId, item.name, item.quantity, item.unitPrice, item.subtotal,
          item.specialInstruction, item.department, item.sendsToKot]
      );
    }
    if (totalCents === 0) {
      await connection.query(
        `UPDATE menu_items mi
         JOIN (SELECT menu_item_id, SUM(quantity) AS quantity FROM order_items WHERE order_id = ? GROUP BY menu_item_id) oi
           ON oi.menu_item_id = mi.id
         SET mi.stock_quantity = GREATEST(0, mi.stock_quantity - oi.quantity)`,
        [orderId]
      );
      await connection.query('UPDATE orders SET stock_deducted = TRUE WHERE id = ?', [orderId]);
    }

    for (const station of stations) {
      const [ticketResult] = await connection.query(
        'INSERT INTO kot_tickets (ticket_code, order_id, station) VALUES (?, ?, ?)',
        [`${station === 'Bar' ? 'BOT' : 'KOT'}-${randomUUID().slice(0, 8).toUpperCase()}`, orderId, station]
      );
      await connection.query(
        'UPDATE order_items SET kot_ticket_id = ? WHERE order_id = ? AND department = ? AND sends_to_kot = TRUE AND kot_ticket_id IS NULL',
        [ticketResult.insertId, orderId, station]
      );
    }
    const [tickets] = await connection.query('SELECT ticket_code FROM kot_tickets WHERE order_id = ? ORDER BY id', [orderId]);

    if (order_type === 'Dine in' && table_number && table_number !== '—') {
      const [tables] = await connection.query(
        'UPDATE dining_tables SET status = "Occupied", active_order_id = ? WHERE table_number = ? AND status = "Available"',
        [orderId, table_number]
      );
      if (!tables.affectedRows) throw Object.assign(new Error('The selected table is not available.'), { statusCode: 409 });
    }

    await connection.commit();
    res.json({ success: true, orderId, order_code, total_amount: totalCents / 100, kot_codes: tickets.map((ticket) => ticket.ticket_code), message: 'Order created successfully' });
  } catch (err) {
    await connection.rollback();
    if (err.code === 'ER_DUP_ENTRY') {
      const [duplicate] = await connection.query(
        'SELECT id, order_code, total_amount FROM orders WHERE idempotency_key = ?',
        [idempotency_key]
      );
      if (duplicate.length) {
        return res.json({
          success: true,
          orderId: duplicate[0].id,
          order_code: duplicate[0].order_code,
          total_amount: duplicate[0].total_amount,
          message: 'Order already received'
        });
      }
    }
    res.status(err.statusCode || 500).json({ error: err.message });
  } finally {
    connection.release();
  }
});

app.post('/api/orders/:id/items', async (req, res) => {
  if (!['Admin', 'Cashier', 'Waiter'].includes(req.user.role)) {
    return res.status(403).json({ error: 'Only front-of-house staff can add items to an order.' });
  }
  const orderId = Number(req.params.id);
  const { items, idempotency_key } = req.body;
  if (!Number.isInteger(orderId) || orderId < 1 || !Array.isArray(items) || items.length === 0 || items.length > 100 ||
      typeof idempotency_key !== 'string' || idempotency_key.length < 16 || idempotency_key.length > 64) {
    return res.status(400).json({ error: 'The added items or request key are invalid.' });
  }
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [[order]] = await connection.query(
      'SELECT id, order_code, order_type, table_number, status, payment_status, stock_deducted FROM orders WHERE id = ? FOR UPDATE',
      [orderId]
    );
    if (!order) throw Object.assign(new Error('Order not found.'), { statusCode: 404 });

    const [[existingAddon]] = await connection.query(
      'SELECT id, order_id FROM order_addons WHERE idempotency_key = ?',
      [idempotency_key]
    );
    if (existingAddon) {
      if (Number(existingAddon.order_id) !== orderId) {
        throw Object.assign(new Error('This request key was already used for another order.'), { statusCode: 409 });
      }
      const [[balance]] = await connection.query(
        'SELECT o.total_amount, GREATEST(0, o.total_amount - COALESCE(SUM(p.amount), 0)) AS remaining FROM orders o LEFT JOIN payments p ON p.order_id = o.id WHERE o.id = ? GROUP BY o.id',
        [orderId]
      );
      const [tickets] = await connection.query(
        'SELECT ticket_code FROM kot_tickets WHERE addon_id = ? ORDER BY id',
        [existingAddon.id]
      );
      await connection.commit();
      return res.json({
        success: true, orderId, order_code: order.order_code,
        total_amount: Number(balance.total_amount), remaining: Number(balance.remaining),
        kot_codes: tickets.map((ticket) => ticket.ticket_code), message: 'Added items already received'
      });
    }
    if (['Completed', 'Cancelled'].includes(order.status) || order.payment_status === 'Refunded') {
      throw Object.assign(new Error('Items can only be added to an active, non-refunded order.'), { statusCode: 409 });
    }

    const [addonResult] = await connection.query(
      'INSERT INTO order_addons (order_id, idempotency_key) VALUES (?, ?)',
      [orderId, idempotency_key]
    );
    const addonId = addonResult.insertId;
    let addonCents = 0;
    const addonItems = [];
    for (const item of items) {
      const quantity = Number(item.quantity ?? item.qty);
      const itemId = Number(item.id);
      if (!Number.isInteger(itemId) || !Number.isInteger(quantity) || quantity < 1 || quantity > 99) {
        throw Object.assign(new Error('Each added item needs a valid item and quantity between 1 and 99.'), { statusCode: 400 });
      }
      const [[menuItem]] = await connection.query(
        'SELECT id, name, price, pricing_type, is_free, available, department, sends_to_kot FROM menu_items WHERE id = ? FOR UPDATE',
        [itemId]
      );
      if (!menuItem || !menuItem.available) {
        throw Object.assign(new Error('A selected item is no longer available. Refresh the menu and try again.'), { statusCode: 409 });
      }
      const price = menuItem.pricing_type === 'Open' ? Number(item.price) : Number(menuItem.price);
      if (!Number.isFinite(price) || price < 0 || (price === 0 && !menuItem.is_free)) {
        throw Object.assign(new Error(`Enter a valid price for ${menuItem.name}.`), { statusCode: 400 });
      }
      const unitCents = Math.round(price * 100);
      const subtotalCents = unitCents * quantity;
      addonCents += subtotalCents;
      if (!Number.isSafeInteger(addonCents) || addonCents > 9999999999) {
        throw Object.assign(new Error('The added items total is too large.'), { statusCode: 400 });
      }
      addonItems.push({
        itemId, name: menuItem.name, quantity, unitPrice: unitCents / 100,
        subtotal: subtotalCents / 100,
        specialInstruction: String(item.special_instruction || '').slice(0, 500),
        department: menuItem.department || 'Kitchen',
        sendsToKot: Boolean(menuItem.sends_to_kot)
      });
    }
    const [[currentTotal]] = await connection.query('SELECT total_amount FROM orders WHERE id = ?', [orderId]);
    const newTotalCents = Math.round(Number(currentTotal.total_amount) * 100) + addonCents;
    if (!Number.isSafeInteger(newTotalCents) || newTotalCents > 9999999999) {
      throw Object.assign(new Error('The updated order total is too large.'), { statusCode: 400 });
    }
    const [paymentRows] = await connection.query(
      'SELECT COALESCE(SUM(amount), 0) AS paid FROM payments WHERE order_id = ?',
      [orderId]
    );
    const paidCents = Math.round(Number(paymentRows[0].paid) * 100);
    const paymentStatus = paidCents >= newTotalCents ? 'Paid' : paidCents > 0 ? 'Partial' : 'Unpaid';

    for (const item of addonItems) {
      const [itemResult] = await connection.query(
        `INSERT INTO order_items (order_id, menu_item_id, item_name, quantity, unit_price, subtotal, special_instruction, department, sends_to_kot)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [orderId, item.itemId, item.name, item.quantity, item.unitPrice, item.subtotal,
          item.specialInstruction, item.department, item.sendsToKot]
      );
      item.id = itemResult.insertId;
    }

    const stations = [...new Set(addonItems.filter((item) => item.sendsToKot && item.department !== 'None').map((item) => item.department))];
    const ticketCodes = [];
    for (const station of stations) {
      const ticketCode = `${station === 'Bar' ? 'BOT' : 'KOT'}-${randomUUID().slice(0, 8).toUpperCase()}`;
      const [ticketResult] = await connection.query(
        'INSERT INTO kot_tickets (ticket_code, order_id, addon_id, station) VALUES (?, ?, ?, ?)',
        [ticketCode, orderId, addonId, station]
      );
      const itemIds = addonItems.filter((item) => item.department === station && item.sendsToKot).map((item) => item.id);
      await connection.query(
        `UPDATE order_items SET kot_ticket_id = ? WHERE id IN (${itemIds.map(() => '?').join(',')})`,
        [ticketResult.insertId, ...itemIds]
      );
      ticketCodes.push(ticketCode);
    }

    if (order.stock_deducted) {
      const quantities = new Map();
      for (const item of addonItems) {
        quantities.set(item.itemId, (quantities.get(item.itemId) || 0) + item.quantity);
      }
      for (const [itemId, quantity] of quantities) {
        await connection.query(
          'UPDATE menu_items SET stock_quantity = GREATEST(0, stock_quantity - ?) WHERE id = ?',
          [quantity, itemId]
        );
      }
    }
    await connection.query(
      'UPDATE orders SET total_amount = ?, payment_status = ?, status = ? WHERE id = ?',
      [newTotalCents / 100, paymentStatus, stations.length ? 'Pending' : order.status, orderId]
    );
    const remaining = Math.max(0, newTotalCents - paidCents) / 100;
    await connection.commit();
    res.json({
      success: true, orderId, order_code: order.order_code,
      total_amount: newTotalCents / 100, remaining,
      kot_codes: ticketCodes, message: 'Items added to the order'
    });
  } catch (err) {
    await connection.rollback();
    if (err.code === 'ER_DUP_ENTRY') {
      const [[existingAddon]] = await pool.query(
        'SELECT id, order_id FROM order_addons WHERE idempotency_key = ?',
        [idempotency_key]
      );
      if (existingAddon && Number(existingAddon.order_id) !== orderId) {
        return res.status(409).json({ error: 'This request key was already used for another order.' });
      }
      if (existingAddon) {
        const [[existingOrder]] = await pool.query(
          'SELECT order_code, total_amount FROM orders WHERE id = ?',
          [orderId]
        );
        const [[balance]] = await pool.query(
          'SELECT o.total_amount, GREATEST(0, o.total_amount - COALESCE(SUM(p.amount), 0)) AS remaining FROM orders o LEFT JOIN payments p ON p.order_id = o.id WHERE o.id = ? GROUP BY o.id',
          [orderId]
        );
        const [tickets] = await pool.query(
          'SELECT ticket_code FROM kot_tickets WHERE addon_id = ? ORDER BY id',
          [existingAddon.id]
        );
        return res.json({
          success: true, orderId, order_code: existingOrder.order_code,
          total_amount: Number(balance.total_amount), remaining: Number(balance.remaining),
          kot_codes: tickets.map((ticket) => ticket.ticket_code), message: 'Added items already received'
        });
      }
    }
    res.status(err.statusCode || 500).json({ error: err.message });
  } finally {
    connection.release();
  }
});

app.post('/api/orders/:id/payment', async (req, res) => {
  if (!['Admin', 'Cashier', 'Waiter'].includes(req.user.role)) {
    return res.status(403).json({ error: 'Only front-of-house staff can record payments.' });
  }
  const orderId = Number(req.params.id);
  const { payment_method, amount, received_amount, idempotency_key } = req.body;
  const amountCents = Math.round(Number(amount) * 100);
  const receivedCents = Math.round(Number(received_amount) * 100);
  if (!Number.isInteger(orderId) || orderId < 1 ||
      !['Cash', 'Card', 'Online', 'Credit', 'Other'].includes(payment_method) ||
      !Number.isSafeInteger(amountCents) || amountCents <= 0 || amountCents > 9999999999 ||
      !Number.isSafeInteger(receivedCents) || receivedCents < amountCents ||
      (payment_method !== 'Cash' && receivedCents !== amountCents) ||
      typeof idempotency_key !== 'string' || idempotency_key.length < 16 || idempotency_key.length > 64) {
    return res.status(400).json({ error: 'Check the payment method and amount received.' });
  }
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [duplicate] = await connection.query(
      'SELECT id, order_id, change_amount FROM payments WHERE idempotency_key = ?',
      [idempotency_key]
    );
    if (duplicate.length) {
      const [[balance]] = await connection.query(
        'SELECT GREATEST(0, total_amount - (SELECT COALESCE(SUM(amount), 0) FROM payments WHERE order_id = ?)) AS remaining FROM orders WHERE id = ?',
        [duplicate[0].order_id, duplicate[0].order_id]
      );
      await connection.commit();
      return res.json({
        success: true,
        change: Number(duplicate[0].change_amount),
        remaining: Number(balance.remaining),
        message: 'Payment already received'
      });
    }
    const [[order]] = await connection.query('SELECT total_amount, customer_name, table_number, status, payment_status, stock_deducted FROM orders WHERE id = ? FOR UPDATE', [orderId]);
    if (!order || order.payment_status === 'Refunded') {
      await connection.rollback();
      return res.status(404).json({ error: 'A payable order could not be found.' });
    }
    if (payment_method === 'Credit' && (!order.customer_name || order.customer_name === 'Guest')) {
      await connection.rollback();
      return res.status(400).json({ error: 'Add the customer name to the order before recording credit.' });
    }
    const [[{ paid }]] = await connection.query('SELECT COALESCE(SUM(amount), 0) AS paid FROM payments WHERE order_id = ?', [orderId]);
    const dueCents = Math.round((Number(order.total_amount) - Number(paid)) * 100);
    if (amountCents > dueCents) {
      await connection.rollback();
      return res.status(400).json({ error: 'Payment is more than the outstanding balance.' });
    }
    await connection.query(
      'INSERT INTO payments (order_id, payment_method, amount, received_amount, change_amount, idempotency_key) VALUES (?, ?, ?, ?, ?, ?)',
      [orderId, payment_method, amountCents / 100, receivedCents / 100, (receivedCents - amountCents) / 100, idempotency_key]
    );
    const fullyPaid = amountCents === dueCents;
    const [[{ ticket_count }]] = await connection.query('SELECT COUNT(*) AS ticket_count FROM kot_tickets WHERE order_id = ?', [orderId]);
    const completed = fullyPaid && (Number(ticket_count) === 0 || order.status === 'Completed');
    await connection.query(
      'UPDATE orders SET payment_status = ?, payment_method = ?, status = ? WHERE id = ?',
      [fullyPaid ? 'Paid' : 'Partial', payment_method, completed ? 'Completed' : order.status, orderId]
    );
    if (fullyPaid && !order.stock_deducted) {
      await connection.query(
        `UPDATE menu_items mi
         JOIN (SELECT menu_item_id, SUM(quantity) AS quantity FROM order_items WHERE order_id = ? GROUP BY menu_item_id) oi
           ON oi.menu_item_id = mi.id
         SET mi.stock_quantity = GREATEST(0, mi.stock_quantity - oi.quantity)`,
        [orderId]
      );
      await connection.query('UPDATE orders SET stock_deducted = TRUE WHERE id = ?', [orderId]);
    }
    if (completed && order.table_number && order.table_number !== '—') {
      await connection.query(
        'UPDATE dining_tables SET status = "Available", active_order_id = NULL WHERE table_number = ? AND active_order_id = ?',
        [order.table_number, orderId]
      );
    }
    const [[{ remaining }]] = await connection.query(
      'SELECT GREATEST(0, total_amount - (SELECT COALESCE(SUM(amount), 0) FROM payments WHERE order_id = ?)) AS remaining FROM orders WHERE id = ?',
      [orderId, orderId]
    );
    await connection.commit();
    res.json({ success: true, change: (receivedCents - amountCents) / 100, remaining: Number(remaining), message: 'Payment recorded' });
  } catch (err) {
    await connection.rollback();
    if (err.code === 'ER_DUP_ENTRY') {
      const [duplicate] = await connection.query(
        'SELECT id, order_id, change_amount FROM payments WHERE idempotency_key = ?',
        [idempotency_key]
      );
      if (duplicate.length) {
        const [[balance]] = await connection.query(
          'SELECT GREATEST(0, total_amount - (SELECT COALESCE(SUM(amount), 0) FROM payments WHERE order_id = ?)) AS remaining FROM orders WHERE id = ?',
          [duplicate[0].order_id, duplicate[0].order_id]
        );
        return res.json({
          success: true,
          change: Number(duplicate[0].change_amount),
          remaining: Number(balance.remaining),
          message: 'Payment already received'
        });
      }
    }
    res.status(500).json({ error: err.message });
  } finally {
    connection.release();
  }
});

app.get('/api/kot', async (req, res) => {
  const station = req.query.station;
  if (station && !['Kitchen', 'Bar'].includes(station)) return res.status(400).json({ error: 'Invalid ticket station.' });
  try {
    const [tickets] = await pool.query(
      `SELECT t.*, o.order_code, o.table_number, o.customer_note, o.created_at AS order_created_at
       FROM kot_tickets t JOIN orders o ON o.id = t.order_id
       WHERE (? IS NULL OR t.station = ?) ORDER BY t.created_at ASC`,
      [station || null, station || null]
    );
    for (const ticket of tickets) {
      const [items] = await pool.query(
        `SELECT item_name, quantity, special_instruction FROM order_items
         WHERE kot_ticket_id = ? AND sends_to_kot = TRUE ORDER BY id`,
        [ticket.id]
      );
      ticket.items = items;
    }
    res.json(tickets);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.patch('/api/kot/:id', async (req, res) => {
  if (!['Admin', 'Kitchen'].includes(req.user.role)) {
    return res.status(403).json({ error: 'Only kitchen staff or administrators can update preparation tickets.' });
  }
  const { status, delay_reason } = req.body;
  if (!['Pending', 'Preparing', 'Ready', 'Served', 'Delayed', 'Cancelled'].includes(status) ||
      (status === 'Delayed' && !String(delay_reason || '').trim())) {
    return res.status(400).json({ error: 'Choose a valid status and enter a reason for a delay.' });
  }
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [result] = await connection.query(
      'UPDATE kot_tickets SET status = ?, delay_reason = ? WHERE id = ?',
      [status, status === 'Delayed' ? String(delay_reason).trim().slice(0, 500) : null, req.params.id]
    );
    if (!result.affectedRows) {
      await connection.rollback();
      return res.status(404).json({ error: 'Kitchen ticket not found.' });
    }
    const [[ticket]] = await connection.query('SELECT order_id FROM kot_tickets WHERE id = ?', [req.params.id]);
    const [[ticketStatus]] = await connection.query(
      `SELECT COUNT(*) AS total, SUM(status IN ('Ready', 'Served', 'Cancelled')) AS ready,
       SUM(status IN ('Served', 'Cancelled')) AS served,
       SUM(status IN ('Preparing', 'Delayed')) AS active
       FROM kot_tickets WHERE order_id = ?`,
      [ticket.order_id]
    );
    const orderStatus = Number(ticketStatus.total) === Number(ticketStatus.served)
      ? 'Completed'
      : Number(ticketStatus.total) === Number(ticketStatus.ready) ? 'Ready'
        : Number(ticketStatus.active) > 0 ? 'Preparing' : 'Pending';
    const [[order]] = await connection.query(
      'SELECT payment_status, table_number FROM orders WHERE id = ? FOR UPDATE',
      [ticket.order_id]
    );
    await connection.query('UPDATE orders SET status = ? WHERE id = ?', [orderStatus, ticket.order_id]);
    if (orderStatus === 'Completed' && order.payment_status === 'Paid' && order.table_number && order.table_number !== '—') {
      await connection.query(
        'UPDATE dining_tables SET status = "Available", active_order_id = NULL WHERE table_number = ? AND active_order_id = ?',
        [order.table_number, ticket.order_id]
      );
    }
    await connection.commit();
    res.json({ success: true, message: 'Ticket updated' });
  } catch (err) {
    await connection.rollback();
    res.status(500).json({ error: err.message });
  } finally {
    connection.release();
  }
});

app.patch('/api/orders/:id/status', async (req, res) => {
  if (!['Admin', 'Cashier', 'Waiter'].includes(req.user.role)) {
    return res.status(403).json({ error: 'Your account cannot update order status.' });
  }
  const { id } = req.params;
  const { status } = req.body;
  if (!['Pending', 'Preparing', 'Ready', 'Completed', 'Cancelled'].includes(status)) {
    return res.status(400).json({ error: 'Choose a valid order status.' });
  }
  try {
    await pool.query('UPDATE orders SET status = ? WHERE id = ?', [status, id]);
    res.json({ success: true, message: 'Order status updated' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- INVENTORY ---
app.get('/api/inventory', async (req, res) => {
  try {
    const [items] = await pool.query('SELECT * FROM inventory ORDER BY id ASC');
    res.json(items);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/inventory', requireRole('Admin'), async (req, res) => {
  const { item_name, category, quantity, unit, min_alert, status } = req.body;
  if (!item_name || !category) return res.status(400).json({ error: 'Item name and category are required.' });
  try {
    const [result] = await pool.query(
      `INSERT INTO inventory (item_name, category, quantity, unit, min_alert, status)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [item_name.trim(), category.trim(), parseFloat(quantity) || 0, unit || 'kg', parseFloat(min_alert) || 5, status || 'In stock']
    );
    await recordAuditLog(req, 'CREATE_INVENTORY', 'inventory', { id: result.insertId, item_name, quantity });
    res.status(201).json({ success: true, id: result.insertId, message: 'Inventory item added' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/inventory/:id', requireRole('Admin'), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { item_name, category, quantity, unit, min_alert, status } = req.body;
  try {
    const [result] = await pool.query(
      `UPDATE inventory SET item_name = ?, category = ?, quantity = ?, unit = ?, min_alert = ?, status = ?
       WHERE id = ?`,
      [item_name, category, parseFloat(quantity) || 0, unit || 'kg', parseFloat(min_alert) || 5, status || 'In stock', id]
    );
    if (!result.affectedRows) return res.status(404).json({ error: 'Inventory item not found.' });
    await recordAuditLog(req, 'UPDATE_INVENTORY', 'inventory', { id, item_name, quantity, status });
    res.json({ success: true, message: 'Inventory item updated' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/inventory/:id', requireRole('Admin'), async (req, res) => {
  const id = parseInt(req.params.id, 10);
  try {
    const [result] = await pool.query('DELETE FROM inventory WHERE id = ?', [id]);
    if (!result.affectedRows) return res.status(404).json({ error: 'Inventory item not found.' });
    await recordAuditLog(req, 'DELETE_INVENTORY', 'inventory', { id });
    res.json({ success: true, message: 'Inventory item removed' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- ROLES & PERMISSIONS MANAGEMENT ---
app.get('/api/roles', requireRole('Admin'), async (req, res) => {
  try {
    const [roles] = await pool.query('SELECT * FROM system_roles ORDER BY id ASC');
    const [permissions] = await pool.query('SELECT * FROM role_permissions ORDER BY role_name, module_name ASC');
    res.json({ roles, permissions });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/roles/:roleName/permissions', requireRole('Admin'), async (req, res) => {
  const { roleName } = req.params;
  const { module_name, can_view, can_create, can_edit, can_delete } = req.body;
  if (!module_name) return res.status(400).json({ error: 'Module name is required.' });
  try {
    await pool.query(
      `INSERT INTO role_permissions (role_name, module_name, can_view, can_create, can_edit, can_delete)
       VALUES (?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         can_view = VALUES(can_view),
         can_create = VALUES(can_create),
         can_edit = VALUES(can_edit),
         can_delete = VALUES(can_delete)`,
      [roleName, module_name, can_view ? 1 : 0, can_create ? 1 : 0, can_edit ? 1 : 0, can_delete ? 1 : 0]
    );
    await recordAuditLog(req, 'UPDATE_ROLE_PERMISSIONS', 'roles', { roleName, module_name });
    res.json({ success: true, message: `Permissions updated for ${roleName}` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- AUDIT LOGS ---
app.get('/api/audit-logs', requireRole('Admin'), async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
    const [logs] = await pool.query('SELECT * FROM audit_logs ORDER BY id DESC LIMIT ?', [limit]);
    res.json(logs);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- COMPREHENSIVE REPORTS ---
app.get('/api/reports/sales-summary', requireRole('Admin'), async (req, res) => {
  try {
    // 1. Overall sales & order counts
    const [[summary]] = await pool.query(`
      SELECT 
        COALESCE(SUM(total_amount), 0) AS gross_sales,
        COUNT(*) AS total_orders,
        COALESCE(SUM(CASE WHEN payment_status = 'Paid' THEN total_amount ELSE 0 END), 0) AS paid_sales,
        COALESCE(SUM(CASE WHEN status = 'Completed' THEN 1 ELSE 0 END), 0) AS completed_orders,
        COALESCE(SUM(CASE WHEN status = 'Cancelled' THEN 1 ELSE 0 END), 0) AS cancelled_orders,
        COALESCE(SUM(CASE WHEN status IN ('Pending', 'Preparing') THEN 1 ELSE 0 END), 0) AS pending_orders
      FROM orders
    `);

    // 2. Payment methods breakdown
    const [paymentBreakdown] = await pool.query(`
      SELECT payment_method, COALESCE(SUM(amount), 0) as total, COUNT(*) as count
      FROM payments GROUP BY payment_method
    `);

    // 3. Category performance
    const [categorySales] = await pool.query(`
      SELECT m.category, COALESCE(SUM(oi.subtotal), 0) as total, SUM(oi.quantity) as qty
      FROM order_items oi
      LEFT JOIN menu_items m ON m.id = oi.menu_item_id
      GROUP BY m.category
    `);

    // 4. Daily sales over last 7 days
    const [dailySales] = await pool.query(`
      SELECT DATE(created_at) as order_date, COALESCE(SUM(total_amount), 0) as total, COUNT(*) as orders_count
      FROM orders
      WHERE created_at >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)
      GROUP BY DATE(created_at)
      ORDER BY order_date ASC
    `);

    res.json({
      summary,
      paymentBreakdown,
      categorySales,
      dailySales
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- DASHBOARD METRICS ---
app.get('/api/dashboard/metrics', requireRole('Admin'), async (req, res) => {
  try {
    const [[{ total_sales }]] = await pool.query('SELECT COALESCE(SUM(total_amount), 0) AS total_sales FROM orders WHERE payment_status = "Paid"');
    const [[{ total_orders }]] = await pool.query('SELECT COUNT(*) AS total_orders FROM orders');
    const [[{ active_tables }]] = await pool.query('SELECT COUNT(*) AS active_tables FROM dining_tables WHERE status = "Occupied"');
    const [[{ total_tables }]] = await pool.query('SELECT COUNT(*) AS total_tables FROM dining_tables');
    const [[{ pending_orders }]] = await pool.query('SELECT COUNT(*) AS pending_orders FROM orders WHERE status IN ("Pending", "Preparing")');

    res.json({
      totalSales: `LKR ${Number(total_sales).toLocaleString()}`,
      totalOrders: total_orders,
      activeTables: `${active_tables} / ${total_tables}`,
      pendingOrders: pending_orders
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- 3-LOCATION PRINTER SYSTEM APIS ---

// GET /api/printers - List all configured printers with dynamic online status
app.get('/api/printers', async (req, res) => {
  try {
    const [printers] = await pool.query('SELECT * FROM printer_settings ORDER BY id ASC');
    // Augment with real-time connection check
    const enriched = await Promise.all(printers.map(async (printer) => {
      let isConnected = false;
      let statusText = 'Disconnected';
      if (!printer.is_active) {
        statusText = 'Disabled';
      } else if (printer.connection_type === 'Network') {
        const pingResult = await checkNetworkPrinterStatus(printer.printer_address, printer.printer_port, 1500);
        isConnected = pingResult.online;
        statusText = isConnected ? 'Connected' : pingResult.message;
      } else {
        isConnected = true;
        statusText = 'Connected (USB/Direct)';
      }
      return {
        ...printer,
        is_connected: isConnected,
        connection_status: statusText
      };
    }));

    res.json(enriched);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/printers - Create or reset a printer
app.post('/api/printers', async (req, res) => {
  if (req.user.role !== 'Admin') {
    return res.status(403).json({ error: 'Only administrators can configure printers.' });
  }
  const { location_key, printer_name, connection_type, printer_address, printer_port, paper_width, is_active } = req.body;
  if (!['kitchen', 'cashier', 'bar'].includes(location_key) || !printer_name || !connection_type || !printer_address) {
    return res.status(400).json({ error: 'Invalid printer payload. Provide location_key (kitchen, cashier, bar), printer_name, connection_type, and printer_address.' });
  }
  try {
    const [result] = await pool.query(
      `INSERT INTO printer_settings (location_key, printer_name, connection_type, printer_address, printer_port, paper_width, is_active)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         printer_name = VALUES(printer_name),
         connection_type = VALUES(connection_type),
         printer_address = VALUES(printer_address),
         printer_port = VALUES(printer_port),
         paper_width = VALUES(paper_width),
         is_active = VALUES(is_active)`,
      [location_key, printer_name, connection_type, printer_address, parseInt(printer_port, 10) || 9100, paper_width || '80mm', is_active !== false ? 1 : 0]
    );
    res.json({ success: true, message: 'Printer configuration saved.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/printers/:id - Update printer configuration
app.put('/api/printers/:id', async (req, res) => {
  if (req.user.role !== 'Admin') {
    return res.status(403).json({ error: 'Only administrators can configure printers.' });
  }
  const printerId = parseInt(req.params.id, 10);
  const { printer_name, connection_type, printer_address, printer_port, paper_width, is_active } = req.body;
  
  if (!printer_name || !connection_type || !printer_address) {
    return res.status(400).json({ error: 'Provide printer name, connection type, and device address.' });
  }

  try {
    const [[existing]] = await pool.query('SELECT id FROM printer_settings WHERE id = ?', [printerId]);
    if (!existing) return res.status(404).json({ error: 'Printer not found.' });

    await pool.query(
      `UPDATE printer_settings SET
         printer_name = ?,
         connection_type = ?,
         printer_address = ?,
         printer_port = ?,
         paper_width = ?,
         is_active = ?
       WHERE id = ?`,
      [
        printer_name.trim(),
        connection_type,
        printer_address.trim(),
        parseInt(printer_port, 10) || 9100,
        paper_width === '58mm' ? '58mm' : '80mm',
        is_active ? 1 : 0,
        printerId
      ]
    );

    const [[updated]] = await pool.query('SELECT * FROM printer_settings WHERE id = ?', [printerId]);
    res.json({ success: true, printer: updated, message: 'Printer updated successfully.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/printers/:id/status - Live hardware status probe
app.get('/api/printers/:id/status', async (req, res) => {
  const printerId = parseInt(req.params.id, 10);
  try {
    const [[printer]] = await pool.query('SELECT * FROM printer_settings WHERE id = ?', [printerId]);
    if (!printer) return res.status(404).json({ error: 'Printer not found.' });

    if (!printer.is_active) {
      return res.json({ id: printerId, is_connected: false, status: 'Disabled', message: 'Printer is disabled in settings.' });
    }

    if (printer.connection_type === 'Network') {
      const pingResult = await checkNetworkPrinterStatus(printer.printer_address, printer.printer_port, 2000);
      return res.json({ id: printerId, is_connected: pingResult.online, status: pingResult.online ? 'Online' : 'Offline', message: pingResult.message });
    }

    return res.json({ id: printerId, is_connected: true, status: 'Online', message: 'Direct/USB ready.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/printers/:id/test - Perform test print
app.post('/api/printers/:id/test', async (req, res) => {
  if (req.user.role !== 'Admin') {
    return res.status(403).json({ error: 'Only administrators can send test prints.' });
  }
  const printerId = parseInt(req.params.id, 10);
  try {
    const [[printer]] = await pool.query('SELECT * FROM printer_settings WHERE id = ?', [printerId]);
    if (!printer) return res.status(404).json({ error: 'Printer not found.' });
    if (!printer.is_active) return res.status(400).json({ error: 'Cannot test an inactive printer. Enable it first.' });

    const [[settings]] = await pool.query('SELECT * FROM restaurant_settings WHERE id = 1');
    const testBuffer = buildTestReceipt(printer, settings || {});

    // Record pending print job
    const [jobResult] = await pool.query(
      `INSERT INTO print_jobs (order_id, printer_id, printer_name, job_type, requested_by, status)
       VALUES (NULL, ?, ?, 'TEST', ?, 'PRINTING')`,
      [printer.id, printer.printer_name, req.user.name || 'Admin']
    );
    const jobId = jobResult.insertId;

    try {
      const printResult = await printToDevice(printer, testBuffer);
      await pool.query(
        'UPDATE print_jobs SET status = "SUCCESS", completed_at = CURRENT_TIMESTAMP WHERE id = ?',
        [jobId]
      );
      res.json({ success: true, message: `Test print successful: ${printResult.message}`, simulated: Boolean(printResult.simulated) });
    } catch (printErr) {
      await pool.query(
        'UPDATE print_jobs SET status = "FAILED", error_message = ?, completed_at = CURRENT_TIMESTAMP WHERE id = ?',
        [printErr.message, jobId]
      );
      res.status(502).json({ error: `Test print failed: ${printErr.message}` });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/billing/print - Dispatches physical receipt to selected printer location
app.post('/api/billing/print', async (req, res) => {
  // Staff with cashier/admin/waiter roles can print bills
  if (!['Admin', 'Cashier', 'Waiter'].includes(req.user.role)) {
    return res.status(403).json({ error: 'Unauthorized to print billing receipts.' });
  }

  const { order_id, printer_id, location_key, idempotency_key } = req.body;
  if (!order_id || (!printer_id && !location_key)) {
    return res.status(400).json({ error: 'Provide order_id and target printer (printer_id or location_key).' });
  }

  const parsedOrderId = parseInt(order_id, 10);
  try {
    // 1. Check duplicate print submissions via idempotency if provided
    if (idempotency_key) {
      const [[recentJob]] = await pool.query(
        `SELECT id, status, completed_at FROM print_jobs 
         WHERE order_id = ? AND status = 'PRINTING' AND created_at > DATE_SUB(NOW(), INTERVAL 10 SECOND)`,
        [parsedOrderId]
      );
      if (recentJob) {
        return res.status(409).json({ error: 'A print job is already in progress for this order. Please wait.' });
      }
    }

    // 2. Fetch printer
    let printerQuery = 'SELECT * FROM printer_settings WHERE ';
    let printerParam;
    if (printer_id) {
      printerQuery += 'id = ?';
      printerParam = parseInt(printer_id, 10);
    } else {
      printerQuery += 'location_key = ?';
      printerParam = location_key;
    }
    const [[printer]] = await pool.query(printerQuery, [printerParam]);
    if (!printer) {
      return res.status(404).json({ error: 'Selected printer destination not found.' });
    }
    if (!printer.is_active) {
      return res.status(400).json({ error: `The ${printer.printer_name} is currently inactive and cannot receive print jobs.` });
    }

    // 3. Fetch order details with items and payments
    const [[order]] = await pool.query('SELECT * FROM orders WHERE id = ?', [parsedOrderId]);
    if (!order) {
      return res.status(404).json({ error: 'Order not found.' });
    }

    const [items] = await pool.query('SELECT * FROM order_items WHERE order_id = ? ORDER BY id ASC', [parsedOrderId]);
    const [payments] = await pool.query('SELECT * FROM payments WHERE order_id = ? ORDER BY id ASC', [parsedOrderId]);
    const [[settings]] = await pool.query('SELECT * FROM restaurant_settings WHERE id = 1');

    // Attach steward name if steward_id
    let stewardName = '';
    if (order.steward_id) {
      const [[steward]] = await pool.query('SELECT name FROM stewards WHERE id = ?', [order.steward_id]);
      if (steward) stewardName = steward.name;
    }

    const fullOrderData = {
      ...order,
      items,
      payments,
      steward_name: stewardName,
      cashier_name: req.user.name || 'Staff'
    };

    // 4. Generate ESC/POS thermal receipt binary
    const receiptBuffer = buildBillReceipt(fullOrderData, settings || {}, printer.paper_width);

    // 5. Create print_jobs entry with PENDING/PRINTING status
    const [jobResult] = await pool.query(
      `INSERT INTO print_jobs (order_id, printer_id, printer_name, job_type, requested_by, status, receipt_payload)
       VALUES (?, ?, ?, 'BILL', ?, 'PRINTING', ?)`,
      [parsedOrderId, printer.id, printer.printer_name, req.user.name || 'Staff', receiptBuffer.toString('base64')]
    );
    const jobId = jobResult.insertId;

    // 6. Transmit to actual physical printer
    try {
      const printResult = await printToDevice(printer, receiptBuffer);
      await pool.query(
        'UPDATE print_jobs SET status = "SUCCESS", completed_at = CURRENT_TIMESTAMP WHERE id = ?',
        [jobId]
      );

      res.json({
        success: true,
        job_id: jobId,
        printer_name: printer.printer_name,
        location: printer.location_key,
        message: `Receipt sent to ${printer.printer_name} successfully.`,
        simulated: Boolean(printResult.simulated)
      });
    } catch (deviceError) {
      await pool.query(
        'UPDATE print_jobs SET status = "FAILED", error_message = ?, completed_at = CURRENT_TIMESTAMP WHERE id = ?',
        [deviceError.message, jobId]
      );

      // Return 502 Bad Gateway to signify hardware/device transmission failure
      return res.status(502).json({
        success: false,
        job_id: jobId,
        printer_name: printer.printer_name,
        error: `Physical print failed on ${printer.printer_name}: ${deviceError.message}`
      });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/billing/print-jobs - List printing history
app.get('/api/billing/print-jobs', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 30, 100);
    const [jobs] = await pool.query(
      `SELECT id, order_id, printer_id, printer_name, job_type, requested_by, status, error_message, created_at, completed_at
       FROM print_jobs ORDER BY id DESC LIMIT ?`,
      [limit]
    );
    res.json(jobs);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/billing/print-jobs/:id - Single job status
app.get('/api/billing/print-jobs/:id', async (req, res) => {
  const jobId = parseInt(req.params.id, 10);
  try {
    const [[job]] = await pool.query(
      `SELECT id, order_id, printer_id, printer_name, job_type, requested_by, status, error_message, created_at, completed_at
       FROM print_jobs WHERE id = ?`,
      [jobId]
    );
    if (!job) return res.status(404).json({ error: 'Print job not found.' });
    res.json(job);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/billing/print-jobs/:id/retry - Retry failed print job
app.post('/api/billing/print-jobs/:id/retry', async (req, res) => {
  if (!['Admin', 'Cashier'].includes(req.user.role)) {
    return res.status(403).json({ error: 'Unauthorized to retry print jobs.' });
  }
  const jobId = parseInt(req.params.id, 10);
  try {
    const [[job]] = await pool.query('SELECT * FROM print_jobs WHERE id = ?', [jobId]);
    if (!job) return res.status(404).json({ error: 'Print job not found.' });

    const [[printer]] = await pool.query('SELECT * FROM printer_settings WHERE id = ?', [job.printer_id]);
    if (!printer) return res.status(404).json({ error: 'Printer for this job no longer exists.' });
    if (!printer.is_active) return res.status(400).json({ error: `Printer ${printer.printer_name} is inactive.` });

    if (!job.receipt_payload) {
      return res.status(400).json({ error: 'No cached receipt payload to retransmit.' });
    }

    const receiptBuffer = Buffer.from(job.receipt_payload, 'base64');
    try {
      const printResult = await printToDevice(printer, receiptBuffer);
      await pool.query(
        'UPDATE print_jobs SET status = "SUCCESS", error_message = NULL, completed_at = CURRENT_TIMESTAMP WHERE id = ?',
        [jobId]
      );
      res.json({ success: true, message: `Retry succeeded on ${printer.printer_name}.`, simulated: Boolean(printResult.simulated) });
    } catch (deviceError) {
      await pool.query(
        'UPDATE print_jobs SET status = "FAILED", error_message = ?, completed_at = CURRENT_TIMESTAMP WHERE id = ?',
        [deviceError.message, jobId]
      );
      return res.status(502).json({ error: `Retry failed: ${deviceError.message}` });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Backend server running on http://localhost:${PORT}`);
});
