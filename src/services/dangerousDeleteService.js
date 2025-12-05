import { promises as fs } from 'fs';
import pool from '../config/db.js';
import { resolveStoredFilePath } from '../utils/fileStorage.js';

function pickExecutor(connection) {
  return connection || pool;
}

async function deleteProjectFilesFromDisk(connection, projectId) {
  const executor = pickExecutor(connection);
  const [files] = await executor.query(
    `SELECT stored_name
       FROM project_files
      WHERE project_id = ?`,
    [projectId]
  );
  for (const file of files) {
    if (!file?.stored_name) {
      continue;
    }
    const filePath = resolveStoredFilePath(file.stored_name);
    await fs.unlink(filePath).catch(() => {});
  }
}

export async function deleteTicketById({ ticketId, actor, connection = null }) {
  if (!actor || actor.role !== 'superadmin') {
    throw new Error('INSUFFICIENT_PRIVILEGES');
  }
  const executor = pickExecutor(connection);
  await executor.query('UPDATE offers SET ticket_id = NULL WHERE ticket_id = ?', [ticketId]);
  await executor.query('DELETE FROM tickets WHERE id = ?', [ticketId]);
}

export async function deleteProjectById({ projectId, actor, connection = null }) {
  if (!actor || actor.role !== 'superadmin') {
    throw new Error('INSUFFICIENT_PRIVILEGES');
  }
  const executor = pickExecutor(connection);
  await deleteProjectFilesFromDisk(executor, projectId);
  await executor.query('DELETE FROM projects WHERE id = ?', [projectId]);
}
