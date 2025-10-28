import pool from '../config/db.js';

export async function createTicket({ projectId, userId, subject, message, kind = 'support' }) {
  const [result] = await pool.query(
    `INSERT INTO tickets (project_id, created_by, subject, message, kind)
     VALUES (?, ?, ?, ?, ?)`,
    [projectId || null, userId, subject, message, kind]
  );
  return result.insertId;
}

export async function listTicketsForUser(user) {
  if (user.role === 'client') {
    const [rows] = await pool.query(
      `SELECT t.*, p.title AS project_title
       FROM tickets t
       LEFT JOIN projects p ON p.id = t.project_id
       WHERE t.created_by = ?
       ORDER BY t.created_at DESC`,
      [user.id]
    );
    return rows;
  }

  if (user.role === 'redactor') {
    const [rows] = await pool.query(
      `SELECT t.*, u.full_name AS author_name, p.title AS project_title
       FROM tickets t
       LEFT JOIN users u ON u.id = t.created_by
       LEFT JOIN projects p ON p.id = t.project_id
       WHERE p.assigned_editor_id = ?
       ORDER BY t.created_at DESC`,
      [user.id]
    );
    return rows;
  }

  if (user.role === 'admin') {
    const [rows] = await pool.query(
      `SELECT t.*, u.full_name AS author_name, p.title AS project_title
       FROM tickets t
       LEFT JOIN users u ON u.id = t.created_by
       LEFT JOIN projects p ON p.id = t.project_id
       WHERE p.assigned_admin_id = ? OR t.project_id IS NULL
       ORDER BY t.created_at DESC`,
      [user.id]
    );
    return rows;
  }

  const [rows] = await pool.query(
    `SELECT t.*, u.full_name AS author_name, p.title AS project_title
     FROM tickets t
     LEFT JOIN users u ON u.id = t.created_by
     LEFT JOIN projects p ON p.id = t.project_id
     ORDER BY t.created_at DESC`
  );
  return rows;
}

export async function addReply({ ticketId, userId, message }) {
  await pool.query(
    `INSERT INTO ticket_replies (ticket_id, user_id, message)
     VALUES (?, ?, ?)`,
    [ticketId, userId, message]
  );
  await pool.query(`UPDATE tickets SET updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [ticketId]);
}

export async function getTicketWithReplies(ticketId) {
  const [[ticketRows], [replyRows]] = await Promise.all([
    pool.query(
      `SELECT t.*, u.full_name AS author_name, p.title AS project_title,
              p.assigned_admin_id, p.assigned_editor_id
       FROM tickets t
       LEFT JOIN users u ON u.id = t.created_by
       LEFT JOIN projects p ON p.id = t.project_id
       WHERE t.id = ?`,
      [ticketId]
    ),
    pool.query(
      `SELECT tr.*, u.full_name AS author_name
       FROM ticket_replies tr
       LEFT JOIN users u ON u.id = tr.user_id
       WHERE tr.ticket_id = ?
       ORDER BY tr.created_at ASC`,
      [ticketId]
    )
  ]);

  return { ticket: ticketRows[0] || null, replies: replyRows };
}

export async function updateTicketStatus(ticketId, status) {
  await pool.query(`UPDATE tickets SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [status, ticketId]);
}

export async function listPendingSupportTicketsForAdmin(adminId) {
  if (!adminId) {
    const [rows] = await pool.query(
      `SELECT t.*, u.full_name AS author_name, p.title AS project_title
       FROM tickets t
       LEFT JOIN users u ON u.id = t.created_by
       LEFT JOIN projects p ON p.id = t.project_id
       WHERE t.status <> 'rezolvat' AND t.kind = 'support'
       ORDER BY t.updated_at DESC
       LIMIT 5`
    );
    return rows;
  }

  const [rows] = await pool.query(
    `SELECT t.*, u.full_name AS author_name, p.title AS project_title
     FROM tickets t
     LEFT JOIN users u ON u.id = t.created_by
     LEFT JOIN projects p ON p.id = t.project_id
     WHERE t.status <> 'rezolvat' AND t.kind = 'support'
       AND (p.assigned_admin_id = ? OR t.project_id IS NULL)
     ORDER BY t.updated_at DESC
     LIMIT 5`,
    [adminId]
  );
  return rows;
}

export async function listPendingSupportTicketsForRedactor(redactorId) {
  const [rows] = await pool.query(
    `SELECT t.*, u.full_name AS author_name, p.title AS project_title
     FROM tickets t
     LEFT JOIN users u ON u.id = t.created_by
     LEFT JOIN projects p ON p.id = t.project_id
     WHERE t.status <> 'rezolvat' AND t.kind = 'support'
       AND p.assigned_editor_id = ?
     ORDER BY t.updated_at DESC
     LIMIT 5`,
    [redactorId]
  );
  return rows;
}

export async function listRecentTicketRepliesForUser(userId, limit = 5) {
  const [rows] = await pool.query(
    `SELECT tr.*, t.subject
     FROM ticket_replies tr
     INNER JOIN tickets t ON t.id = tr.ticket_id
     WHERE tr.user_id <> ? AND t.created_by = ?
     ORDER BY tr.created_at DESC
     LIMIT ?`,
    [userId, userId, limit]
  );
  return rows;
}
