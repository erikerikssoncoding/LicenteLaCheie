ALTER TABLE users
  ADD COLUMN last_seen_at DATETIME NULL DEFAULT NULL AFTER updated_at,
  ADD INDEX idx_users_last_seen_at (last_seen_at);
