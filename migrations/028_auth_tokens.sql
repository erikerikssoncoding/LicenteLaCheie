CREATE TABLE password_reset_tokens (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  token_hash CHAR(64) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at TIMESTAMP NOT NULL,
  consumed_at TIMESTAMP NULL,
  UNIQUE KEY uniq_password_reset_tokens_hash (token_hash),
  INDEX idx_password_reset_tokens_user_id (user_id),
  INDEX idx_password_reset_tokens_expires_at (expires_at),
  INDEX idx_password_reset_tokens_consumed_at (consumed_at),
  CONSTRAINT fk_password_reset_tokens_user_id FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE login_link_tokens (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  token_hash CHAR(64) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at TIMESTAMP NOT NULL,
  consumed_at TIMESTAMP NULL,
  UNIQUE KEY uniq_login_link_tokens_hash (token_hash),
  INDEX idx_login_link_tokens_user_id (user_id),
  INDEX idx_login_link_tokens_expires_at (expires_at),
  INDEX idx_login_link_tokens_consumed_at (consumed_at),
  CONSTRAINT fk_login_link_tokens_user_id FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE EVENT IF NOT EXISTS cleanup_password_reset_tokens
  ON SCHEDULE EVERY 1 HOUR
  DO DELETE FROM password_reset_tokens WHERE expires_at <= NOW();

CREATE EVENT IF NOT EXISTS cleanup_login_link_tokens
  ON SCHEDULE EVERY 1 HOUR
  DO DELETE FROM login_link_tokens WHERE expires_at <= NOW();
