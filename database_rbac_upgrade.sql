-- Role, Permissions, and Audit Logs Migration
-- Proxima Technologies POS

CREATE TABLE IF NOT EXISTS system_roles (
  id INT AUTO_INCREMENT PRIMARY KEY,
  role_name VARCHAR(50) NOT NULL UNIQUE,
  description VARCHAR(255) NULL,
  is_system TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT INTO system_roles (role_name, description, is_system)
VALUES 
  ('Admin', 'Full unrestricted super-administrator access to all operations, reports, settings, and modules', 1),
  ('Cashier', 'Front-of-house billing, payments, orders, and receipts', 1),
  ('Waiter', 'Table management, customer order taking, and adding order items', 1),
  ('Kitchen', 'KOT/BOT ticket queues and food preparation workflows', 1)
ON DUPLICATE KEY UPDATE description = VALUES(description);

CREATE TABLE IF NOT EXISTS role_permissions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  role_name VARCHAR(50) NOT NULL,
  module_name VARCHAR(50) NOT NULL,
  can_view TINYINT(1) NOT NULL DEFAULT 1,
  can_create TINYINT(1) NOT NULL DEFAULT 0,
  can_edit TINYINT(1) NOT NULL DEFAULT 0,
  can_delete TINYINT(1) NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_role_module (role_name, module_name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Seed default permissions
INSERT INTO role_permissions (role_name, module_name, can_view, can_create, can_edit, can_delete)
VALUES
  -- Admin has everything
  ('Admin', 'dashboard', 1, 1, 1, 1),
  ('Admin', 'pos', 1, 1, 1, 1),
  ('Admin', 'orders', 1, 1, 1, 1),
  ('Admin', 'tables', 1, 1, 1, 1),
  ('Admin', 'kitchen', 1, 1, 1, 1),
  ('Admin', 'menu', 1, 1, 1, 1),
  ('Admin', 'inventory', 1, 1, 1, 1),
  ('Admin', 'users', 1, 1, 1, 1),
  ('Admin', 'printers', 1, 1, 1, 1),
  ('Admin', 'reports', 1, 1, 1, 1),
  ('Admin', 'settings', 1, 1, 1, 1),
  ('Admin', 'audit', 1, 1, 1, 1),

  -- Cashier
  ('Cashier', 'dashboard', 1, 0, 0, 0),
  ('Cashier', 'pos', 1, 1, 1, 0),
  ('Cashier', 'orders', 1, 1, 1, 0),
  ('Cashier', 'tables', 1, 0, 1, 0),
  ('Cashier', 'reports', 1, 0, 0, 0),

  -- Waiter
  ('Waiter', 'dashboard', 1, 0, 0, 0),
  ('Waiter', 'pos', 1, 1, 1, 0),
  ('Waiter', 'orders', 1, 1, 1, 0),
  ('Waiter', 'tables', 1, 0, 1, 0),

  -- Kitchen
  ('Kitchen', 'dashboard', 1, 0, 0, 0),
  ('Kitchen', 'kitchen', 1, 0, 1, 0)
ON DUPLICATE KEY UPDATE can_view = VALUES(can_view), can_create = VALUES(can_create), can_edit = VALUES(can_edit), can_delete = VALUES(can_delete);

-- Audit log for administrative and critical POS actions
CREATE TABLE IF NOT EXISTS audit_logs (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NULL,
  user_name VARCHAR(100) NOT NULL DEFAULT 'System',
  user_role VARCHAR(50) NOT NULL DEFAULT 'Admin',
  action VARCHAR(100) NOT NULL,
  target_module VARCHAR(50) NOT NULL,
  details TEXT NULL,
  ip_address VARCHAR(45) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_action (action),
  INDEX idx_module (target_module),
  INDEX idx_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

