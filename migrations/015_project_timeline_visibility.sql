ALTER TABLE project_timeline_entries
  MODIFY entry_type ENUM('status', 'comment', 'log') NOT NULL,
  MODIFY visibility ENUM('public', 'internal', 'admin') NOT NULL DEFAULT 'public';
