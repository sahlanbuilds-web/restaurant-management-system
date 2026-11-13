-- Run once on an existing restaurant_pos database before starting the upgraded app.
-- Back up the database first. Do not run after applying the updated database.sql schema.
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

ALTER TABLE menu_items
    ADD COLUMN item_code VARCHAR(40) NULL AFTER id,
    ADD UNIQUE KEY uq_menu_items_item_code (item_code),
    ADD COLUMN description TEXT NULL AFTER name,
    ADD COLUMN cost DECIMAL(10,2) NOT NULL DEFAULT 0.00 AFTER price,
    ADD COLUMN stock_quantity DECIMAL(10,2) NOT NULL DEFAULT 0.00 AFTER cost,
    ADD COLUMN reorder_level DECIMAL(10,2) NOT NULL DEFAULT 5.00 AFTER stock_quantity,
    ADD COLUMN pricing_type ENUM('Fixed', 'Open') NOT NULL DEFAULT 'Fixed' AFTER reorder_level,
    ADD COLUMN department ENUM('Kitchen', 'Bar', 'None') NOT NULL DEFAULT 'Kitchen' AFTER pricing_type,
    ADD COLUMN is_free BOOLEAN NOT NULL DEFAULT FALSE AFTER department,
    ADD COLUMN sends_to_kot BOOLEAN NOT NULL DEFAULT TRUE AFTER is_free;

UPDATE menu_items
SET item_code = CONCAT('ITEM-', LPAD(id, 6, '0'))
WHERE item_code IS NULL OR item_code = '';

ALTER TABLE orders
    ADD COLUMN customer_note TEXT NULL AFTER customer_name,
    ADD COLUMN steward_id INT NULL AFTER customer_note,
    ADD COLUMN idempotency_key VARCHAR(64) NULL,
    ADD UNIQUE KEY uq_orders_idempotency_key (idempotency_key),
    ADD COLUMN stock_deducted BOOLEAN NOT NULL DEFAULT FALSE,
    MODIFY COLUMN payment_status ENUM('Unpaid', 'Partial', 'Paid', 'Refunded') DEFAULT 'Unpaid';

ALTER TABLE order_items
    ADD COLUMN special_instruction TEXT NULL,
    ADD COLUMN department ENUM('Kitchen', 'Bar', 'None') NOT NULL DEFAULT 'Kitchen',
    ADD COLUMN sends_to_kot BOOLEAN NOT NULL DEFAULT TRUE,
    ADD COLUMN kot_ticket_id INT NULL;

CREATE TABLE IF NOT EXISTS kot_tickets (
    id INT AUTO_INCREMENT PRIMARY KEY,
    ticket_code VARCHAR(30) NOT NULL UNIQUE,
    order_id INT NOT NULL,
    station ENUM('Kitchen', 'Bar') NOT NULL DEFAULT 'Kitchen',
    status ENUM('Pending', 'Preparing', 'Ready', 'Served', 'Delayed', 'Cancelled') NOT NULL DEFAULT 'Pending',
    delay_reason TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS order_addons (
    id INT AUTO_INCREMENT PRIMARY KEY,
    order_id INT NOT NULL,
    idempotency_key VARCHAR(64) NOT NULL UNIQUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
);

ALTER TABLE kot_tickets ADD COLUMN addon_id INT NULL AFTER order_id;

SET @add_ticket_order_index = IF(
    EXISTS (
        SELECT 1 FROM information_schema.statistics
        WHERE table_schema = DATABASE()
          AND table_name = 'kot_tickets'
          AND column_name = 'order_id'
          AND seq_in_index = 1
          AND non_unique = 1
    ),
    'SELECT 1',
    'ALTER TABLE kot_tickets ADD KEY idx_kot_tickets_order_id (order_id)'
);
PREPARE add_ticket_order_index FROM @add_ticket_order_index;
EXECUTE add_ticket_order_index;
DEALLOCATE PREPARE add_ticket_order_index;

SET @drop_ticket_station_index = IF(
    EXISTS (
        SELECT 1 FROM information_schema.statistics
        WHERE table_schema = DATABASE()
          AND table_name = 'kot_tickets'
          AND index_name = 'unique_order_station'
    ),
    'ALTER TABLE kot_tickets DROP INDEX unique_order_station',
    'SELECT 1'
);
PREPARE drop_ticket_station_index FROM @drop_ticket_station_index;
EXECUTE drop_ticket_station_index;
DEALLOCATE PREPARE drop_ticket_station_index;

UPDATE order_items oi
JOIN kot_tickets t ON t.order_id = oi.order_id AND t.station = oi.department
SET oi.kot_ticket_id = t.id
WHERE oi.sends_to_kot = TRUE AND oi.department IN ('Kitchen', 'Bar');

CREATE TABLE IF NOT EXISTS payments (
    id INT AUTO_INCREMENT PRIMARY KEY,
    order_id INT NOT NULL,
    payment_method VARCHAR(50) NOT NULL,
    amount DECIMAL(10,2) NOT NULL,
    received_amount DECIMAL(10,2) NOT NULL,
    change_amount DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    idempotency_key VARCHAR(64) NOT NULL UNIQUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS stewards (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    active BOOLEAN NOT NULL DEFAULT TRUE
);
