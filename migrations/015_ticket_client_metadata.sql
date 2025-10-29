ALTER TABLE tickets
  ADD COLUMN client_fingerprint VARCHAR(128) NULL AFTER display_code,
  ADD COLUMN client_ip VARCHAR(45) NULL AFTER client_fingerprint,
  ADD COLUMN client_forwarded_for VARCHAR(500) NULL AFTER client_ip,
  ADD COLUMN client_user_agent TEXT NULL AFTER client_forwarded_for,
  ADD COLUMN client_accept_language VARCHAR(255) NULL AFTER client_user_agent,
  ADD COLUMN client_session_id VARCHAR(128) NULL AFTER client_accept_language,
  ADD COLUMN client_referer TEXT NULL AFTER client_session_id,
  ADD COLUMN client_client_hints TEXT NULL AFTER client_referer,
  ADD COLUMN client_extra_data LONGTEXT NULL AFTER client_client_hints;
