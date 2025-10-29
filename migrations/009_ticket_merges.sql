ALTER TABLE tickets
  ADD COLUMN merged_into_ticket_id INT NULL AFTER display_code,
  ADD CONSTRAINT fk_tickets_merged_into FOREIGN KEY (merged_into_ticket_id) REFERENCES tickets(id) ON DELETE SET NULL;
