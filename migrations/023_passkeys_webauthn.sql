ALTER TABLE passkeys
  DROP INDEX IF EXISTS uq_passkeys_token_hash,
  DROP COLUMN IF EXISTS token_hash,
  ADD COLUMN credential_id VARCHAR(255) NULL DEFAULT NULL,
  ADD COLUMN public_key TEXT NULL DEFAULT NULL,
  ADD COLUMN counter BIGINT UNSIGNED NOT NULL DEFAULT 0,
  ADD COLUMN transports TEXT NULL DEFAULT NULL,
  ADD UNIQUE KEY uq_passkeys_credential_id (credential_id),
  ADD KEY idx_passkeys_credential (credential_id);
