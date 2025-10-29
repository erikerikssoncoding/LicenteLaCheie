CREATE TABLE IF NOT EXISTS ticket_activity_logs (
  id INT AUTO_INCREMENT PRIMARY KEY,
  ticket_id INT NOT NULL,
  message TEXT NOT NULL,
  visibility ENUM('public', 'internal') NOT NULL DEFAULT 'internal',
  created_by INT NULL,
  author_name VARCHAR(255) DEFAULT NULL,
  author_role ENUM('client', 'redactor', 'admin', 'superadmin') DEFAULT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_ticket_activity_ticket FOREIGN KEY (ticket_id) REFERENCES tickets(id) ON DELETE CASCADE,
  CONSTRAINT fk_ticket_activity_user FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
