CREATE TABLE IF NOT EXISTS mail_sync_state (
  id TINYINT UNSIGNED NOT NULL PRIMARY KEY,
  last_successful_sync DATETIME NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

INSERT INTO mail_sync_state (id, last_successful_sync)
VALUES (1, NULL)
ON DUPLICATE KEY UPDATE last_successful_sync = VALUES(last_successful_sync);
