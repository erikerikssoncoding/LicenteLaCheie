ALTER TABLE tickets
  ADD COLUMN kind ENUM('support', 'offer') NOT NULL DEFAULT 'support' AFTER message;
