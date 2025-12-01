ALTER TABLE passkeys
  DROP INDEX uq_passkeys_token_hash,
  DROP COLUMN token_hash,
  ADD COLUMN credential_id VARCHAR(255) NOT NULL,
  ADD COLUMN public_key TEXT NOT NULL,
  ADD COLUMN counter BIGINT UNSIGNED NOT NULL DEFAULT 0,
  ADD COLUMN transports TEXT NULL DEFAULT NULL,
  ADD UNIQUE KEY uq_passkeys_credential_id (credential_id),
  ADD KEY idx_passkeys_credential (credential_id);
