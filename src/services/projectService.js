import pool from '../config/db.js';

export async function createProject({
  title,
  description,
  degreeLevel,
  deadline,
  clientId,
  assignedAdminId,
  assignedEditorId
}) {
  const [result] = await pool.query(
    `INSERT INTO projects
      (title, description, degree_level, deadline, status, client_id, assigned_admin_id, assigned_editor_id)
     VALUES (?, ?, ?, ?, 'initiated', ?, ?, ?)`,
    [title, description, degreeLevel, deadline, clientId, assignedAdminId || null, assignedEditorId || null]
  );
  return result.insertId;
}

export async function listProjectsForUser(user) {
  if (user.role === 'client') {
    const [rows] = await pool.query(
      `SELECT p.*, ua.full_name AS assigned_admin_name, ue.full_name AS assigned_editor_name
       FROM projects p
       LEFT JOIN users ua ON ua.id = p.assigned_admin_id
       LEFT JOIN users ue ON ue.id = p.assigned_editor_id
       WHERE p.client_id = ?
       ORDER BY p.created_at DESC`,
      [user.id]
    );
    return rows;
  }

  if (user.role === 'editor') {
    const [rows] = await pool.query(
      `SELECT p.*, uc.full_name AS client_name
       FROM projects p
       LEFT JOIN users uc ON uc.id = p.client_id
       WHERE p.assigned_editor_id = ?
       ORDER BY p.created_at DESC`,
      [user.id]
    );
    return rows;
  }

  if (user.role === 'admin') {
    const [rows] = await pool.query(
      `SELECT p.*, uc.full_name AS client_name, ue.full_name AS assigned_editor_name
       FROM projects p
       LEFT JOIN users uc ON uc.id = p.client_id
       LEFT JOIN users ue ON ue.id = p.assigned_editor_id
       WHERE p.assigned_admin_id = ?
       ORDER BY p.created_at DESC`,
      [user.id]
    );
    return rows;
  }

  const [rows] = await pool.query(
    `SELECT p.*, uc.full_name AS client_name, ua.full_name AS assigned_admin_name, ue.full_name AS assigned_editor_name
     FROM projects p
     LEFT JOIN users uc ON uc.id = p.client_id
     LEFT JOIN users ua ON ua.id = p.assigned_admin_id
     LEFT JOIN users ue ON ue.id = p.assigned_editor_id
     ORDER BY p.created_at DESC`
  );
  return rows;
}

export async function updateProjectStatus(projectId, status, notes) {
  await pool.query(
    `UPDATE projects SET status = ?, progress_notes = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
    [status, notes, projectId]
  );
}

export async function getProjectById(projectId) {
  const [rows] = await pool.query(
    `SELECT p.*, uc.full_name AS client_name, uc.email AS client_email,
            ua.full_name AS admin_name, ue.full_name AS editor_name
     FROM projects p
     LEFT JOIN users uc ON uc.id = p.client_id
     LEFT JOIN users ua ON ua.id = p.assigned_admin_id
     LEFT JOIN users ue ON ue.id = p.assigned_editor_id
     WHERE p.id = ?`,
    [projectId]
  );
  return rows[0] || null;
}

export async function assignProject(projectId, { adminId, editorId }) {
  await pool.query(
    `UPDATE projects
     SET assigned_admin_id = ?, assigned_editor_id = ?, updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
    [adminId || null, editorId || null, projectId]
  );
}

export async function getClientProjectHighlights(clientId) {
  const [[deadlineRows], [adminRows], [editorRows]] = await Promise.all([
    pool.query(
      `SELECT p.id, p.title, p.deadline, ua.full_name AS admin_name, ue.full_name AS editor_name
       FROM projects p
       LEFT JOIN users ua ON ua.id = p.assigned_admin_id
       LEFT JOIN users ue ON ue.id = p.assigned_editor_id
       WHERE p.client_id = ? AND p.deadline IS NOT NULL
       ORDER BY p.deadline ASC
       LIMIT 1`,
      [clientId]
    ),
    pool.query(
      `SELECT DISTINCT ua.id, ua.full_name
       FROM projects p
       INNER JOIN users ua ON ua.id = p.assigned_admin_id
       WHERE p.client_id = ?`,
      [clientId]
    ),
    pool.query(
      `SELECT DISTINCT ue.id, ue.full_name
       FROM projects p
       INNER JOIN users ue ON ue.id = p.assigned_editor_id
       WHERE p.client_id = ?`,
      [clientId]
    )
  ]);

  return {
    nextDeadline: deadlineRows[0] || null,
    admins: adminRows,
    editors: editorRows
  };
}

export async function getEditorProjectHighlights(editorId) {
  const [[statusRows], [deadlineRows]] = await Promise.all([
    pool.query(
      `SELECT status, COUNT(*) AS total
       FROM projects
       WHERE assigned_editor_id = ?
       GROUP BY status`,
      [editorId]
    ),
    pool.query(
      `SELECT id, title, deadline
       FROM projects
       WHERE assigned_editor_id = ? AND deadline IS NOT NULL
       ORDER BY deadline ASC
       LIMIT 3`,
      [editorId]
    )
  ]);

  return {
    statusCounts: statusRows,
    upcomingDeadlines: deadlineRows
  };
}

export async function getAdminProjectHighlights(adminId) {
  const [[statusRows], [recentClients]] = await Promise.all([
    pool.query(
      `SELECT status, COUNT(*) AS total
       FROM projects
       WHERE assigned_admin_id = ?
       GROUP BY status`,
      [adminId]
    ),
    pool.query(
      `SELECT p.id, p.title, uc.full_name AS client_name, p.deadline
       FROM projects p
       LEFT JOIN users uc ON uc.id = p.client_id
       WHERE p.assigned_admin_id = ?
       ORDER BY p.created_at DESC
       LIMIT 5`,
      [adminId]
    )
  ]);

  return {
    statusCounts: statusRows,
    recentProjects: recentClients
  };
}
