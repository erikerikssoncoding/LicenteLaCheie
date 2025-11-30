ALTER TABLE tickets
  MODIFY COLUMN display_code VARCHAR(32) NOT NULL UNIQUE;

CREATE TABLE IF NOT EXISTS mail_notification_logs (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  event_type VARCHAR(64) NOT NULL,
  subject VARCHAR(255) NULL,
  recipients TEXT NULL,
  status ENUM('sent', 'error', 'skipped') NOT NULL DEFAULT 'sent',
  error_message TEXT NULL,
  context_json JSON NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_mail_notification_logs_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
