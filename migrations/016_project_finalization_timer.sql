ALTER TABLE projects
  ADD COLUMN completed_at DATETIME NULL AFTER status,
  ADD COLUMN finalized_at DATETIME NULL AFTER completed_at;

UPDATE projects
SET completed_at = COALESCE(completed_at, updated_at)
WHERE status = 'completed' AND completed_at IS NULL;
