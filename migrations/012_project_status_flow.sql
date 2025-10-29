ALTER TABLE projects
  ADD COLUMN project_code VARCHAR(16) NULL AFTER id,
  ADD COLUMN source_ticket_id INT NULL AFTER project_code,
  ADD CONSTRAINT fk_projects_ticket FOREIGN KEY (source_ticket_id) REFERENCES tickets(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX idx_projects_project_code ON projects(project_code);
CREATE UNIQUE INDEX idx_projects_source_ticket ON projects(source_ticket_id);

ALTER TABLE projects
  MODIFY status VARCHAR(64) NOT NULL DEFAULT 'initiated';

UPDATE projects
SET status = CASE
  WHEN status = 'initiated' THEN 'new'
  WHEN status = 'in-progress' THEN 'research'
  WHEN status = 'needs-review' THEN 'awaiting_feedback'
  WHEN status = 'completed' THEN 'completed'
  WHEN status = 'delivered' THEN 'final_delivery'
  ELSE status
END;

ALTER TABLE projects
  MODIFY status ENUM(
    'new',
    'waiting_docs',
    'docs_validated',
    'research',
    'writing',
    'internal_review',
    'draft_delivery',
    'awaiting_feedback',
    'changes_requested',
    'applying_changes',
    'final_delivery',
    'completed',
    'suspended_payment',
    'suspended_info',
    'cancelled'
  ) NOT NULL DEFAULT 'new';

UPDATE projects
SET project_code = SUBSTRING(REPLACE(UUID(), '-', ''), 1, 10)
WHERE project_code IS NULL;

ALTER TABLE projects
  MODIFY project_code VARCHAR(16) NOT NULL;

CREATE TABLE project_timeline_entries (
  id INT AUTO_INCREMENT PRIMARY KEY,
  project_id INT NOT NULL,
  entry_type ENUM('status', 'comment') NOT NULL,
  status VARCHAR(64) NULL,
  message TEXT NULL,
  visibility ENUM('public', 'internal') NOT NULL DEFAULT 'public',
  created_by INT NULL,
  author_name VARCHAR(255) NULL,
  author_role VARCHAR(50) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO project_timeline_entries (
  project_id,
  entry_type,
  status,
  message,
  visibility,
  created_by,
  author_name,
  author_role,
  created_at
)
SELECT
  p.id,
  'status',
  p.status,
  'Status curent importat in istoricul proiectului.',
  'public',
  NULL,
  'Sistem',
  'system',
  p.created_at
FROM projects p;
