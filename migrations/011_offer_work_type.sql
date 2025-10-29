ALTER TABLE offers
  ADD COLUMN work_type VARCHAR(100) NOT NULL DEFAULT 'lucrare de licenta' AFTER topic;
