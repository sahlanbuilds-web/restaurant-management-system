-- Fast Item Search & Item Code-Based Billing Database Upgrade
-- Proxima Technologies POS
USE restaurant_pos;

-- 1. Ensure item_code is VARCHAR(50) NULL
ALTER TABLE menu_items MODIFY COLUMN item_code VARCHAR(50) NULL;

-- 2. Add barcode column if it does not already exist
ALTER TABLE menu_items ADD COLUMN IF NOT EXISTS barcode VARCHAR(100) NULL AFTER item_code;

-- 3. Add unique index on barcode (MariaDB 10.4+ / MySQL)
-- In MySQL/MariaDB, multiple NULLs are permitted in a UNIQUE index.
SET @exist_barcode_idx = (
    SELECT COUNT(*) 
    FROM information_schema.statistics 
    WHERE table_schema = DATABASE() 
      AND table_name = 'menu_items' 
      AND index_name = 'uq_menu_items_barcode'
);
SET @sql_barcode_idx = IF(@exist_barcode_idx = 0, 
    'ALTER TABLE menu_items ADD UNIQUE KEY uq_menu_items_barcode (barcode)', 
    'SELECT 1'
);
PREPARE stmt_barcode_idx FROM @sql_barcode_idx;
EXECUTE stmt_barcode_idx;
DEALLOCATE PREPARE stmt_barcode_idx;

-- 4. Add index for fast live item search by name and category
SET @exist_name_idx = (
    SELECT COUNT(*) 
    FROM information_schema.statistics 
    WHERE table_schema = DATABASE() 
      AND table_name = 'menu_items' 
      AND index_name = 'idx_menu_items_name'
);
SET @sql_name_idx = IF(@exist_name_idx = 0, 
    'ALTER TABLE menu_items ADD INDEX idx_menu_items_name (name)', 
    'SELECT 1'
);
PREPARE stmt_name_idx FROM @sql_name_idx;
EXECUTE stmt_name_idx;
DEALLOCATE PREPARE stmt_name_idx;

SET @exist_cat_idx = (
    SELECT COUNT(*) 
    FROM information_schema.statistics 
    WHERE table_schema = DATABASE() 
      AND table_name = 'menu_items' 
      AND index_name = 'idx_menu_items_category'
);
SET @sql_cat_idx = IF(@exist_cat_idx = 0, 
    'ALTER TABLE menu_items ADD INDEX idx_menu_items_category (category)', 
    'SELECT 1'
);
PREPARE stmt_cat_idx FROM @sql_cat_idx;
EXECUTE stmt_cat_idx;
DEALLOCATE PREPARE stmt_cat_idx;

