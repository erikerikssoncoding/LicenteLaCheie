import pool from '../config/db.js';
import { customAlphabet } from 'nanoid';

const generateTicketCode = customAlphabet('ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789', 15);

function pickExecutor(connection) {
  return connection ?? pool;
}

async function generateUniqueTicketCode() {
  while (true) {
    const code = generateTicketCode();
    const [rows] = await pool.query('SELECT id FROM tickets WHERE display_code = ?', [code]);
    if (rows.length === 0) {
      return code;
    }
  }
}

export async function createTicket({
  projectId,
  userId,
  subject,
  message,
  kind = 'support',
  clientMetadata = {}
}) {
  const displayCode = await generateUniqueTicketCode();
  const {
    fingerprint = null,
    ipAddress = null,
    forwardedFor = null,
    userAgent = null,
    acceptLanguage = null,
    sessionId = null,
    referer = null,
    clientHints = null,
    extraData = null
  } = clientMetadata || {};
  const serializedExtra = extraData ? JSON.stringify(extraData) : null;
  const [result] = await pool.query(
    `INSERT INTO tickets
        (project_id, created_by, subject, message, kind, display_code,
         client_fingerprint, client_ip, client_forwarded_for, client_user_agent,
         client_accept_language, client_session_id, client_referer, client_client_hints, client_extra_data)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      projectId || null,
      userId,
      subject,
      message,
      kind,
      displayCode,
      fingerprint,
      ipAddress,
      forwardedFor,
      userAgent,
      acceptLanguage,
      sessionId,
      referer,
      clientHints,
      serializedExtra
    ]
  );
  return { id: result.insertId, displayCode };
}

export async function listTicketsForUser(user) {
  if (user.role === 'client') {
    const [rows] = await pool.query(
      `SELECT t.*, p.title AS project_title, p.project_code AS project_code, merged.display_code AS merged_into_display_code
       FROM tickets t
       LEFT JOIN projects p ON p.id = t.project_id
       LEFT JOIN tickets merged ON merged.id = t.merged_into_ticket_id
       WHERE t.created_by = ?
       ORDER BY t.created_at DESC`,
      [user.id]
    );
    return rows;
  }

  if (user.role === 'redactor') {
    const [rows] = await pool.query(
      `SELECT t.*, u.full_name AS author_name, p.title AS project_title, p.project_code AS project_code, merged.display_code AS merged_into_display_code
       FROM tickets t
       LEFT JOIN users u ON u.id = t.created_by
       LEFT JOIN projects p ON p.id = t.project_id
       LEFT JOIN tickets merged ON merged.id = t.merged_into_ticket_id
       WHERE p.assigned_editor_id = ?
       ORDER BY t.created_at DESC`,
      [user.id]
    );
    return rows;
  }

  if (user.role === 'admin') {
    const [rows] = await pool.query(
      `SELECT t.*, u.full_name AS author_name, p.title AS project_title, p.project_code AS project_code, merged.display_code AS merged_into_display_code
       FROM tickets t
       LEFT JOIN users u ON u.id = t.created_by
       LEFT JOIN projects p ON p.id = t.project_id
       LEFT JOIN tickets merged ON merged.id = t.merged_into_ticket_id
       WHERE p.assigned_admin_id = ? OR p.assigned_editor_id = ? OR t.project_id IS NULL
       ORDER BY t.created_at DESC`,
      [user.id, user.id]
    );
    return rows;
  }

  const [rows] = await pool.query(
    `SELECT t.*, u.full_name AS author_name, p.title AS project_title, p.project_code AS project_code, merged.display_code AS merged_into_display_code
     FROM tickets t
     LEFT JOIN users u ON u.id = t.created_by
     LEFT JOIN projects p ON p.id = t.project_id
     LEFT JOIN tickets merged ON merged.id = t.merged_into_ticket_id
     ORDER BY t.created_at DESC`
  );
  return rows;
}

export async function addReply({ ticketId, userId, message, messageId = null }) {
  if (messageId) {
    const [existing] = await pool.query('SELECT id FROM ticket_replies WHERE message_id = ? LIMIT 1', [messageId]);
    if (existing.length > 0) {
      return { skipped: true, reason: 'DUPLICATE_MESSAGE' };
    }
  }

  const [result] = await pool.query(
    `INSERT INTO ticket_replies (ticket_id, user_id, message, message_id)
     VALUES (?, ?, ?, ?)`,
    [ticketId, userId, message, messageId]
  );
  await pool.query(`UPDATE tickets SET updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [ticketId]);
  return { skipped: false, id: result.insertId };
}

export async function getTicketById(ticketId) {
  const [rows] = await pool.query(
    `SELECT t.*, u.full_name AS author_name, u.role AS author_role, p.title AS project_title, p.project_code AS project_code,
            p.assigned_admin_id, p.assigned_editor_id, merged.display_code AS merged_into_display_code
     FROM tickets t
     LEFT JOIN users u ON u.id = t.created_by
     LEFT JOIN projects p ON p.id = t.project_id
     LEFT JOIN tickets merged ON merged.id = t.merged_into_ticket_id
     WHERE t.id = ?`,
    [ticketId]
  );

  return rows[0] || null;
}

export async function getTicketByDisplayCode(displayCode) {
  if (!displayCode) {
    return null;
  }
  const [rows] = await pool.query(
    `SELECT t.*, u.full_name AS author_name, u.role AS author_role, p.title AS project_title, p.project_code AS project_code,
            p.assigned_admin_id, p.assigned_editor_id, merged.display_code AS merged_into_display_code
       FROM tickets t
       LEFT JOIN users u ON u.id = t.created_by
       LEFT JOIN projects p ON p.id = t.project_id
       LEFT JOIN tickets merged ON merged.id = t.merged_into_ticket_id
      WHERE t.display_code = ?`,
    [displayCode]
  );

  return rows[0] || null;
}

export async function getTicketWithReplies(ticketId) {
  const [ticket, [replyRows]] = await Promise.all([
    getTicketById(ticketId),
    pool.query(
      `SELECT tr.*, u.full_name AS author_name, u.role AS author_role
       FROM ticket_replies tr
       LEFT JOIN users u ON u.id = tr.user_id
       WHERE tr.ticket_id = ?
       ORDER BY tr.created_at ASC`,
      [ticketId]
    )
  ]);

  return { ticket, replies: replyRows };
}

export async function getTicketTimelineEntries(ticketId, { limit = 10, offset = 0, includeInternal = false } = {}) {
  const safeLimit = Math.max(1, Number(limit));
  const safeOffset = Math.max(0, Number(offset));
  const visibilityClause = includeInternal ? "IN (?, ?)" : "= ?";
  const visibilityParams = includeInternal ? ['public', 'internal'] : ['public'];
  const [rows] = await pool.query(
    `SELECT entry_type, entry_id, message, created_at, author_id, author_name, author_role
     FROM (
       SELECT 'ticket' AS entry_type, t.id AS entry_id, t.message, t.created_at,
              t.created_by AS author_id, u.full_name AS author_name, u.role AS author_role
       FROM tickets t
       LEFT JOIN users u ON u.id = t.created_by
       WHERE t.id = ?
       UNION ALL
       SELECT 'reply' AS entry_type, tr.id AS entry_id, tr.message, tr.created_at,
              tr.user_id AS author_id, u.full_name AS author_name, u.role AS author_role
       FROM ticket_replies tr
       LEFT JOIN users u ON u.id = tr.user_id
       WHERE tr.ticket_id = ?
       UNION ALL
       SELECT 'log' AS entry_type, tal.id AS entry_id, tal.message, tal.created_at,
              tal.created_by AS author_id, tal.author_name AS author_name, tal.author_role AS author_role
       FROM ticket_activity_logs tal
       WHERE tal.ticket_id = ? AND tal.visibility ${visibilityClause}
     ) AS timeline
     ORDER BY created_at DESC
     LIMIT ? OFFSET ?`,
    [ticketId, ticketId, ticketId, ...visibilityParams, safeLimit, safeOffset]
  );

  return rows;
}

export async function addTicketLog({ ticketId, message, visibility = 'internal', actor = null }) {
  await pool.query(
    `INSERT INTO ticket_activity_logs (ticket_id, message, visibility, created_by, author_name, author_role)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      ticketId,
      message,
      visibility,
      actor?.id || null,
      actor?.fullName || null,
      actor?.role || null
    ]
  );
}

export async function getTicketTimelineLastRead(ticketId, userId, { connection = null } = {}) {
  if (!ticketId || !userId) {
    return null;
  }
  const executor = pickExecutor(connection);
  const [rows] = await executor.query(
    `SELECT last_read_at
       FROM ticket_timeline_reads
      WHERE ticket_id = ? AND user_id = ?`,
    [ticketId, userId]
  );
  const record = rows[0];
  if (!record?.last_read_at) {
    return null;
  }
  const value = record.last_read_at instanceof Date ? record.last_read_at : new Date(record.last_read_at);
  return Number.isNaN(value?.getTime()) ? null : value;
}

export async function markTicketTimelineRead({
  ticketId,
  userId,
  timestamp = new Date(),
  connection = null
}) {
  if (!ticketId || !userId) {
    return false;
  }
  const executor = pickExecutor(connection);
  const safeTimestamp = timestamp instanceof Date ? timestamp : new Date(timestamp);
  const normalizedTimestamp = Number.isNaN(safeTimestamp?.getTime()) ? new Date() : safeTimestamp;
  await executor.query(
    `INSERT INTO ticket_timeline_reads (ticket_id, user_id, last_read_at)
     VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE last_read_at = GREATEST(last_read_at, VALUES(last_read_at))`,
    [ticketId, userId, normalizedTimestamp]
  );
  return true;
}

export async function listMergeCandidates({ baseTicketId, createdBy, actor }) {
  if (!actor || !['admin', 'superadmin'].includes(actor.role)) {
    return [];
  }

  let query =
    `SELECT t.id, t.display_code, t.subject, t.status, t.kind, t.merged_into_ticket_id, t.project_id,
            p.assigned_admin_id
       FROM tickets t
       LEFT JOIN projects p ON p.id = t.project_id
      WHERE t.created_by = ? AND t.id <> ? AND t.merged_into_ticket_id IS NULL`;
  const params = [createdBy, baseTicketId];

  if (actor.role === 'admin') {
    query += ' AND (t.project_id IS NULL OR p.assigned_admin_id = ?)';
    params.push(actor.id);
  }

  query += ' ORDER BY t.updated_at DESC';

  const [rows] = await pool.query(query, params);
  return rows;
}

export async function mergeTickets({ targetTicketId, sourceTicketIds, actorId }) {
  if (!Array.isArray(sourceTicketIds) || sourceTicketIds.length === 0) {
    throw new Error('MERGE_NO_TICKETS_SELECTED');
  }
  if (!actorId) {
    throw new Error('MERGE_ACTOR_REQUIRED');
  }

  const normalizedTargetId = Number(targetTicketId);
  if (!Number.isInteger(normalizedTargetId) || normalizedTargetId <= 0) {
    throw new Error('MERGE_TARGET_NOT_FOUND');
  }

  const uniqueSourceIds = [...new Set(sourceTicketIds.map((id) => Number(id)))].filter(
    (id) => Number.isInteger(id) && id > 0 && id !== normalizedTargetId
  );

  if (uniqueSourceIds.length === 0) {
    throw new Error('MERGE_NO_TICKETS_SELECTED');
  }

  const connection = await pool.getConnection();
  let transactionStarted = false;

  try {
    await connection.beginTransaction();
    transactionStarted = true;

    const [targetRows] = await connection.query(
      `SELECT id, created_by, display_code, merged_into_ticket_id
         FROM tickets
        WHERE id = ?
        FOR UPDATE`,
      [normalizedTargetId]
    );

    const target = targetRows[0];
    if (!target) {
      throw new Error('MERGE_TARGET_NOT_FOUND');
    }
    if (target.merged_into_ticket_id) {
      throw new Error('MERGE_TARGET_ALREADY_MERGED');
    }

    const [sourceRows] = await connection.query(
      `SELECT id, created_by, display_code, merged_into_ticket_id
         FROM tickets
        WHERE id IN (?)
        FOR UPDATE`,
      [uniqueSourceIds]
    );

    if (sourceRows.length !== uniqueSourceIds.length) {
      throw new Error('MERGE_SOURCE_NOT_FOUND');
    }

    for (const source of sourceRows) {
      if (source.merged_into_ticket_id) {
        throw new Error('MERGE_SOURCE_ALREADY_MERGED');
      }
      if (source.created_by !== target.created_by) {
        throw new Error('MERGE_DIFFERENT_OWNER');
      }
    }

    await connection.query(
      `UPDATE tickets
          SET status = 'rezolvat', merged_into_ticket_id = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id IN (?)`,
      [normalizedTargetId, uniqueSourceIds]
    );

    const mergeMessage = `Ticketul a fost inchis cu status „merged” si redirectionat catre ticketul #${target.display_code}. Continua conversatia aici: /cont/tichete/${normalizedTargetId}`;

    for (const source of sourceRows) {
      await connection.query(
        `INSERT INTO ticket_replies (ticket_id, user_id, message)
         VALUES (?, ?, ?)`,
        [source.id, actorId, mergeMessage]
      );
    }

    const mergedCodes = sourceRows.map((entry) => `#${entry.display_code}`).join(', ');
    const targetMessage =
      sourceRows.length === 1
        ? `Ticketul ${mergedCodes} a fost fuzionat in aceasta conversatie.`
        : `Ticketele ${mergedCodes} au fost fuzionate in aceasta conversatie.`;

    await connection.query(
      `INSERT INTO ticket_replies (ticket_id, user_id, message)
       VALUES (?, ?, ?)`,
      [normalizedTargetId, actorId, targetMessage]
    );

    await connection.query('UPDATE tickets SET updated_at = CURRENT_TIMESTAMP WHERE id = ?', [normalizedTargetId]);

    await connection.commit();

    return { target, sources: sourceRows };
  } catch (error) {
    if (transactionStarted) {
      await connection.rollback();
    }
    throw error;
  } finally {
    connection.release();
  }
}

export async function updateTicketStatus(ticketId, status) {
  await pool.query(`UPDATE tickets SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [status, ticketId]);
}

export async function markTicketAsContract(ticketId) {
  await pool.query(
    `UPDATE tickets SET kind = 'contract', updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
    [ticketId]
  );
}

export async function listPendingSupportTicketsForAdmin(adminId) {
  if (!adminId) {
    const [rows] = await pool.query(
      `SELECT t.*, u.full_name AS author_name, p.title AS project_title, p.project_code AS project_code
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
    `SELECT t.*, u.full_name AS author_name, p.title AS project_title, p.project_code AS project_code
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
    `SELECT t.*, u.full_name AS author_name, p.title AS project_title, p.project_code AS project_code
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
