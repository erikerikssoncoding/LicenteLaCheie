ALTER TABLE contact_messages
  ADD COLUMN ip_address VARCHAR(45) DEFAULT NULL AFTER phone;
