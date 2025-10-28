ALTER TABLE offers
  ADD COLUMN user_id INT NULL AFTER client_name,
  CHANGE price offer_amount DECIMAL(10,2) NULL,
  ADD COLUMN status ENUM('pending', 'sent', 'accepted', 'refused', 'counter_pending', 'counter_submitted', 'expired') NOT NULL DEFAULT 'pending' AFTER offer_amount,
  ADD COLUMN expires_at DATETIME NULL AFTER status,
  ADD COLUMN counter_amount DECIMAL(10,2) NULL AFTER expires_at,
  ADD COLUMN counter_expires_at DATETIME NULL AFTER counter_amount,
  ADD COLUMN decision_at DATETIME NULL AFTER counter_expires_at,
  ADD COLUMN ticket_id INT NULL AFTER decision_at,
  ADD COLUMN last_notified_at DATETIME NULL AFTER ticket_id,
  ADD CONSTRAINT fk_offers_user FOREIGN KEY (user_id) REFERENCES users(id),
  ADD CONSTRAINT fk_offers_ticket FOREIGN KEY (ticket_id) REFERENCES tickets(id);
