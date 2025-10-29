ALTER TABLE tickets
  ADD COLUMN display_code VARCHAR(16) NULL AFTER id;

UPDATE tickets
SET display_code = UPPER(SUBSTRING(REPLACE(UUID(), '-', ''), 1, 6))
WHERE display_code IS NULL;

ALTER TABLE tickets
  MODIFY COLUMN display_code VARCHAR(16) NOT NULL UNIQUE;

ALTER TABLE contract_signatures
  ADD COLUMN contract_stage ENUM('pending_data', 'draft', 'awaiting_admin', 'completed') NOT NULL DEFAULT 'pending_data' AFTER user_id,
  ADD COLUMN contract_draft LONGTEXT NULL AFTER contract_stage,
  ADD COLUMN client_signature LONGTEXT NULL AFTER contract_draft,
  ADD COLUMN client_signed_at DATETIME NULL AFTER client_signature,
  ADD COLUMN admin_signature LONGTEXT NULL AFTER client_signed_at,
  ADD COLUMN admin_signed_at DATETIME NULL AFTER admin_signature,
  ADD COLUMN contract_number VARCHAR(16) NULL AFTER admin_signed_at,
  ADD COLUMN contract_date DATE NULL AFTER contract_number;
