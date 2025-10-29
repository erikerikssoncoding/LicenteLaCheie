CREATE TABLE IF NOT EXISTS security_settings (
  `key` VARCHAR(50) PRIMARY KEY,
  `is_enabled` TINYINT(1) NOT NULL DEFAULT 0,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

INSERT INTO security_settings (`key`, `is_enabled`)
VALUES
  ('csp', 1),
  ('enforce_https', 1),
  ('debug_mode', 0)
ON DUPLICATE KEY UPDATE is_enabled = VALUES(is_enabled);
