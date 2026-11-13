-- Run once on databases already upgraded to the POS schema before add-on order support.
-- Do not run after applying the current database.sql or database_upgrade.sql.
-- Back up the database first.
USE restaurant_pos;

ALTER TABLE order_items
    ADD COLUMN kot_ticket_id INT NULL;

CREATE TABLE IF NOT EXISTS order_addons (
    id INT AUTO_INCREMENT PRIMARY KEY,
    order_id INT NOT NULL,
    idempotency_key VARCHAR(64) NOT NULL UNIQUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
);

ALTER TABLE kot_tickets
    ADD COLUMN addon_id INT NULL AFTER order_id;

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
