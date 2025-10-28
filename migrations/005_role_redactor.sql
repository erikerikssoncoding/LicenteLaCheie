ALTER TABLE users
  MODIFY COLUMN role ENUM('client', 'redactor', 'admin', 'superadmin') NOT NULL DEFAULT 'client';

UPDATE users SET role = 'redactor' WHERE role = 'editor';
