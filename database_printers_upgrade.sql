-- Migration for 3-Location Billing Printer System
-- Proxima Technologies POS

CREATE TABLE IF NOT EXISTS printer_settings (
  id INT AUTO_INCREMENT PRIMARY KEY,
  location_key ENUM('kitchen', 'cashier', 'bar') NOT NULL UNIQUE,
  printer_name VARCHAR(100) NOT NULL,
  connection_type ENUM('Network', 'USB', 'Windows') NOT NULL DEFAULT 'Network',
  printer_address VARCHAR(255) NOT NULL DEFAULT '127.0.0.1',
  printer_port INT NOT NULL DEFAULT 9100,
  paper_width ENUM('58mm', '80mm') NOT NULL DEFAULT '80mm',
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Seed default three printers if not exists
INSERT INTO printer_settings (location_key, printer_name, connection_type, printer_address, printer_port, paper_width, is_active)
VALUES 
  ('kitchen', 'Kitchen Printer', 'Network', '192.168.1.201', 9100, '80mm', 1),
  ('cashier', 'Cashier Printer', 'Network', '192.168.1.200', 9100, '80mm', 1),
  ('bar', 'Bar Printer', 'Network', '192.168.1.202', 9100, '80mm', 1)
ON DUPLICATE KEY UPDATE printer_name = VALUES(printer_name);

-- Create print_jobs history table
CREATE TABLE IF NOT EXISTS print_jobs (
  id INT AUTO_INCREMENT PRIMARY KEY,
  order_id INT NULL,
  printer_id INT NOT NULL,
  printer_name VARCHAR(100) NOT NULL,
  job_type ENUM('BILL', 'TEST') NOT NULL DEFAULT 'BILL',
  requested_by VARCHAR(100) NOT NULL DEFAULT 'Staff',
  status ENUM('PENDING', 'PRINTING', 'SUCCESS', 'FAILED') NOT NULL DEFAULT 'PENDING',
  error_message TEXT NULL,
  receipt_payload MEDIUMTEXT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  completed_at TIMESTAMP NULL,
  INDEX idx_order_id (order_id),
  INDEX idx_printer_id (printer_id),
  INDEX idx_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Add bill_printing_mode to restaurant_settings safely if not exists
ALTER TABLE restaurant_settings 
ADD COLUMN IF NOT EXISTS bill_printing_mode VARCHAR(50) NOT NULL DEFAULT 'ASK_LOCATION';

