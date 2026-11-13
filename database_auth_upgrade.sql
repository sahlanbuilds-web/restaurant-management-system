-- Run once on a previously upgraded POS database that lacks password_hash and auth_sessions.
-- For the original legacy schema, use database_upgrade.sql instead.
-- Do not run after applying the current database.sql or database_upgrade.sql.
-- Back up the database first.
USE restaurant_pos;

ALTER TABLE users
    ADD COLUMN password_hash VARCHAR(255) NULL AFTER password;

CREATE TABLE IF NOT EXISTS auth_sessions (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    token_hash CHAR(64) NOT NULL UNIQUE,
    expires_at DATETIME NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_auth_sessions_expiry (expires_at),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

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
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

INSERT INTO restaurant_settings (
    id, restaurant_name, business_email, phone, address, timezone, currency, receipt_header, receipt_footer
) VALUES (
    1, 'Proxima Technologies', 'admin@proxima.com', '+94 77 234 5677', '123 Main Street, Colombo, Sri Lanka', 'Asia/Colombo', 'LKR', 'Proxima Technologies', 'Thank you for dining with us.'
) ON DUPLICATE KEY UPDATE
    restaurant_name = VALUES(restaurant_name),
    business_email = VALUES(business_email),
    phone = VALUES(phone),
    address = VALUES(address),
    timezone = VALUES(timezone),
    currency = VALUES(currency),
    receipt_header = VALUES(receipt_header),
    receipt_footer = VALUES(receipt_footer);
