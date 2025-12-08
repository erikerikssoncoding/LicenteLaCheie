CREATE TABLE IF NOT EXISTS admin_action_logs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id BIGINT UNSIGNED NULL,
  user_name VARCHAR(255) NULL,
  user_role VARCHAR(50) NULL,
  action VARCHAR(255) NOT NULL,
  details_json JSON NULL,
  status_code INT NULL,
  ip_address VARCHAR(255) NULL,
  user_agent VARCHAR(512) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_admin_action_logs_user (user_id),
  KEY idx_admin_action_logs_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
