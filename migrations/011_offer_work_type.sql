ALTER TABLE offers
  ADD COLUMN work_type VARCHAR(100) NOT NULL DEFAULT 'lucrare de licență' AFTER topic;
