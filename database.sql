-- Restaurant Management System Schema & Initial Seed Data
USE restaurant_pos;

-- Users / Staff table with roles
CREATE TABLE IF NOT EXISTS users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    email VARCHAR(150) UNIQUE NOT NULL,
    password VARCHAR(255) NOT NULL,
    password_hash VARCHAR(255) NULL,
    role ENUM('Admin', 'Cashier', 'Waiter', 'Kitchen') NOT NULL DEFAULT 'Admin',
    phone VARCHAR(30),
    status ENUM('active', 'inactive') DEFAULT 'active',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

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

-- Categories table
CREATE TABLE IF NOT EXISTS categories (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL UNIQUE,
    item_count INT DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Menu items table
CREATE TABLE IF NOT EXISTS menu_items (
    id INT AUTO_INCREMENT PRIMARY KEY,
    item_code VARCHAR(50) UNIQUE,
    barcode VARCHAR(100) UNIQUE NULL,
    name VARCHAR(150) NOT NULL,
    description TEXT,
    category VARCHAR(100) NOT NULL,
    price DECIMAL(10,2) NOT NULL,
    cost DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    stock_quantity DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    reorder_level DECIMAL(10,2) NOT NULL DEFAULT 5.00,
    pricing_type ENUM('Fixed', 'Open') NOT NULL DEFAULT 'Fixed',
    department ENUM('Kitchen', 'Bar', 'None') NOT NULL DEFAULT 'Kitchen',
    is_free BOOLEAN NOT NULL DEFAULT FALSE,
    sends_to_kot BOOLEAN NOT NULL DEFAULT TRUE,
    image TEXT,
    available BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_menu_items_name (name),
    INDEX idx_menu_items_category (category)
);

-- Tables / Dining setup table
CREATE TABLE IF NOT EXISTS dining_tables (
    id INT AUTO_INCREMENT PRIMARY KEY,
    table_number VARCHAR(20) NOT NULL UNIQUE,
    capacity INT NOT NULL DEFAULT 4,
    status ENUM('Available', 'Occupied', 'Reserved', 'Billing') DEFAULT 'Available',
    active_order_id INT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Orders table
CREATE TABLE IF NOT EXISTS orders (
    id INT AUTO_INCREMENT PRIMARY KEY,
    order_code VARCHAR(20) NOT NULL UNIQUE,
    order_type ENUM('Dine in', 'Takeaway', 'Delivery') NOT NULL DEFAULT 'Dine in',
    table_number VARCHAR(20),
    customer_name VARCHAR(100) DEFAULT 'Guest',
    customer_note TEXT,
    steward_id INT NULL,
    total_amount DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    status ENUM('Pending', 'Preparing', 'Ready', 'Completed', 'Cancelled') DEFAULT 'Preparing',
    payment_status ENUM('Unpaid', 'Partial', 'Paid', 'Refunded') DEFAULT 'Unpaid',
    payment_method VARCHAR(50) DEFAULT 'Cash',
    idempotency_key VARCHAR(64) UNIQUE,
    stock_deducted BOOLEAN NOT NULL DEFAULT FALSE,
    created_by VARCHAR(100) DEFAULT 'Admin',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Order items table
CREATE TABLE IF NOT EXISTS order_items (
    id INT AUTO_INCREMENT PRIMARY KEY,
    order_id INT NOT NULL,
    menu_item_id INT,
    kot_ticket_id INT NULL,
    item_name VARCHAR(150) NOT NULL,
    quantity INT NOT NULL DEFAULT 1,
    unit_price DECIMAL(10,2) NOT NULL,
    subtotal DECIMAL(10,2) NOT NULL,
    special_instruction TEXT,
    department ENUM('Kitchen', 'Bar', 'None') NOT NULL DEFAULT 'Kitchen',
    sends_to_kot BOOLEAN NOT NULL DEFAULT TRUE,
    FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
);

-- Each add-on batch receives a separate station ticket; reprints reuse its number.
CREATE TABLE IF NOT EXISTS kot_tickets (
    id INT AUTO_INCREMENT PRIMARY KEY,
    ticket_code VARCHAR(30) NOT NULL UNIQUE,
    order_id INT NOT NULL,
    addon_id INT NULL,
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

-- Inventory / Stock table
CREATE TABLE IF NOT EXISTS inventory (
    id INT AUTO_INCREMENT PRIMARY KEY,
    item_name VARCHAR(150) NOT NULL,
    category VARCHAR(100) NOT NULL,
    quantity DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    unit VARCHAR(30) NOT NULL DEFAULT 'kg',
    min_alert DECIMAL(10,2) NOT NULL DEFAULT 5.00,
    status ENUM('In stock', 'Low stock', 'Out of stock') DEFAULT 'In stock',
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- Seed Initial Categories
INSERT IGNORE INTO categories (name, item_count) VALUES 
('Main course', 3),
('Sides', 1),
('Starters', 2),
('Beverages', 2),
('Desserts', 1);

-- Seed Initial Menu Items
INSERT IGNORE INTO menu_items (id, item_code, name, category, price, image, available) VALUES
(1, 'ITEM-000001', 'Classic Beef Burger', 'Main course', 1450.00, 'https://images.unsplash.com/photo-1615653633551-25dd80d2765a?auto=format&fit=crop&w=500&q=80', TRUE),
(2, 'ITEM-000002', 'Truffle Fries', 'Sides', 600.00, 'https://images.unsplash.com/photo-1582021106562-a92aaceb0eb1?auto=format&fit=crop&w=500&q=80', TRUE),
(3, 'ITEM-000003', 'Garden Harvest', 'Starters', 1150.00, 'https://images.unsplash.com/photo-1545216560-68430ad77342?auto=format&fit=crop&w=500&q=80', TRUE),
(4, 'ITEM-000004', 'House Special Bowl', 'Main course', 1600.00, 'https://images.unsplash.com/photo-1568993942805-2f1006a93d7b?auto=format&fit=crop&w=500&q=80', TRUE),
(5, 'ITEM-000005', 'Chargrilled Steak', 'Main course', 2400.00, 'https://images.unsplash.com/photo-1541544741938-0af808871cc0?auto=format&fit=crop&w=500&q=80', TRUE),
(6, 'ITEM-000006', 'Sharing Platter', 'Starters', 1850.00, 'https://images.unsplash.com/photo-1644447381290-85358ae625cb?auto=format&fit=crop&w=500&q=80', TRUE);

-- Seed Tables
INSERT IGNORE INTO dining_tables (table_number, capacity, status) VALUES
('Table 01', 2, 'Available'),
('Table 02', 2, 'Available'),
('Table 03', 4, 'Occupied'),
('Table 04', 4, 'Available'),
('Table 05', 6, 'Available'),
('Table 06', 4, 'Reserved'),
('Table 07', 4, 'Available'),
('Table 08', 4, 'Occupied'),
('Table 09', 2, 'Available'),
('Table 10', 8, 'Available'),
('Table 11', 4, 'Available'),
('Table 12', 4, 'Available');

-- Seed Users / Staff
INSERT IGNORE INTO users (name, email, password, role, phone) VALUES
('Admin User', 'admin@proxima.com', 'admin123', 'Admin', '+94 77 234 5677'),
('Cashier Nuwan', 'cashier@proxima.com', 'cashier123', 'Cashier', '+94 71 892 4411'),
('Waiter Kamal', 'waiter@proxima.com', 'waiter123', 'Waiter', '+94 75 331 9922'),
('Chef Silva', 'chef@proxima.com', 'chef123', 'Kitchen', '+94 70 442 8833');

-- Seed Sample Orders
INSERT IGNORE INTO orders (id, order_code, order_type, table_number, customer_name, total_amount, status, payment_status, payment_method) VALUES
(1048, '#1048', 'Dine in', 'Table 08', 'Dine-in Guest', 8620.00, 'Preparing', 'Paid', 'Cash'),
(1047, '#1047', 'Takeaway', '—', 'Kasun Perera', 3280.00, 'Ready', 'Paid', 'Card'),
(1046, '#1046', 'Takeaway', '—', 'Walk-in', 5840.00, 'Ready', 'Paid', 'Cash'),
(1045, '#1045', 'Dine in', 'Table 12', 'Mr. Fernando', 2750.00, 'Completed', 'Paid', 'Card'),
(1044, '#1044', 'Takeaway', '—', 'Saman Kumara', 2200.00, 'Ready', 'Paid', 'Cash'),
(1043, '#1043', 'Dine in', 'Table 03', 'Guest Table 3', 9870.00, 'Preparing', 'Paid', 'Online'),
(1042, '#1042', 'Takeaway', '—', 'Walk-in', 4490.00, 'Completed', 'Paid', 'Cash');

-- Seed Inventory
INSERT IGNORE INTO inventory (item_name, category, quantity, unit, min_alert, status) VALUES
('Beef Patty (200g)', 'Meat', 85.00, 'pcs', 20.00, 'In stock'),
('Burger Buns', 'Bakery', 140.00, 'pcs', 30.00, 'In stock'),
('Mozzarella Cheese', 'Dairy', 4.50, 'kg', 5.00, 'Low stock'),
('Potato Fries Cut', 'Frozen', 52.00, 'kg', 15.00, 'In stock'),
('Truffle Oil', 'Sauces & Oils', 1.20, 'L', 2.00, 'Low stock'),
('Ribeye Steaks', 'Meat', 28.00, 'kg', 10.00, 'In stock'),
('Fresh Salad Mix', 'Produce', 14.00, 'kg', 5.00, 'In stock');
