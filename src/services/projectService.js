import { customAlphabet } from 'nanoid';
import pool from '../config/db.js';
import {
  PROJECT_STATUSES,
  PROJECT_FLOW_STATUSES,
  getProjectStatusById,
  getNextProjectStatusId,
  getPreviousProjectStatusId,
  isValidProjectStatus
} from '../utils/projectStatuses.js';
import { addTicketLog } from './ticketService.js';

const PROJECT_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const generateProjectCode = customAlphabet(PROJECT_CODE_ALPHABET, 10);
export const PROJECT_COMPLETION_LOCK_HOURS = 24;
const COMPLETION_LOCK_DURATION_MS = PROJECT_COMPLETION_LOCK_HOURS * 60 * 60 * 1000;

function pickExecutor(connection) {
  return connection ?? pool;
}

async function generateUniqueProjectCode(executor = pool) {
  while (true) {
    const code = generateProjectCode();
    const [rows] = await executor.query('SELECT id FROM projects WHERE project_code = ?', [code]);
    if (rows.length === 0) {
      return code;
    }
  }
}

function sanitizeText(value) {
  if (!value) {
    return null;
  }
  const trimmed = String(value).trim();
  return trimmed.length ? trimmed : null;
}

function coerceDate(value) {
  if (!value) {
    return null;
  }
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date?.getTime()) ? null : date;
}

export function getProjectCompletionDeadline(project) {
  const completedAt = coerceDate(project?.completed_at);
  if (!completedAt) {
    return null;
  }
  return new Date(completedAt.getTime() + COMPLETION_LOCK_DURATION_MS);
}

export function isProjectConversationLocked(project, referenceDate = new Date()) {
  if (!project || project.status !== 'completed') {
    return false;
  }
  const finalizedAt = coerceDate(project.finalized_at);
  if (finalizedAt) {
    return true;
  }
  const deadline = getProjectCompletionDeadline(project);
  if (!deadline) {
    return false;
  }
  return referenceDate >= deadline;
}

async function addProjectTimelineEntry({
  projectId,
  entryType,
  status = null,
  message = null,
  actor = null,
  visibility = 'public',
  connection = null
}) {
  const executor = pickExecutor(connection);
  const sanitizedMessage = sanitizeText(message);
  await executor.query(
    `INSERT INTO project_timeline_entries
        (project_id, entry_type, status, message, visibility, created_by, author_name, author_role)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      projectId,
      entryType,
      status || null,
      sanitizedMessage,
      visibility,
      actor?.id || null,
      actor?.fullName || null,
      actor?.role || null
    ]
  );
}

export async function createProject({
  title,
  description,
  degreeLevel,
  deadline,
  clientId,
  assignedAdminId,
  assignedRedactorId,
  sourceTicketId = null,
  actor = null,
  initialNote = null,
  connection = null
}) {
  const executor = pickExecutor(connection);
  const projectCode = await generateUniqueProjectCode(executor);
  const statusInfo = getProjectStatusById('new');
  const defaultTimelineMessage =
    sanitizeText(initialNote) || statusInfo?.clientMessage || statusInfo?.description || null;
  const [result] = await executor.query(
    `INSERT INTO projects
        (project_code, title, description, degree_level, deadline, status, progress_notes,
         client_id, assigned_admin_id, assigned_editor_id, source_ticket_id)
     VALUES (?, ?, ?, ?, ?, 'new', ?, ?, ?, ?, ?)`,
    [
      projectCode,
      title,
      description,
      degreeLevel,
      deadline || null,
      defaultTimelineMessage,
      clientId,
      assignedAdminId || null,
      assignedRedactorId || null,
      sourceTicketId || null
    ]
  );
  const projectId = result.insertId;
  await addProjectTimelineEntry({
    projectId,
    entryType: 'status',
    status: 'new',
    message: defaultTimelineMessage,
    actor,
    connection: executor
  });
  return { id: projectId, projectCode };
}

export async function listProjectsForUser(user) {
  if (user.role === 'client') {
    const [rows] = await pool.query(
      `SELECT p.*, ua.full_name AS assigned_admin_name, ue.full_name AS assigned_redactor_name
       FROM projects p
       LEFT JOIN users ua ON ua.id = p.assigned_admin_id
       LEFT JOIN users ue ON ue.id = p.assigned_editor_id
       WHERE p.client_id = ?
       ORDER BY p.created_at DESC`,
      [user.id]
    );
    return rows;
  }

  if (user.role === 'redactor') {
    const [rows] = await pool.query(
      `SELECT p.*, uc.full_name AS client_name, uc.email AS client_email, ua.full_name AS assigned_admin_name
       FROM projects p
       LEFT JOIN users uc ON uc.id = p.client_id
       LEFT JOIN users ua ON ua.id = p.assigned_admin_id
        WHERE p.assigned_editor_id = ?
        ORDER BY p.created_at DESC`,
      [user.id]
    );
    return rows;
  }

  if (user.role === 'admin') {
    const [rows] = await pool.query(
      `SELECT p.*, uc.full_name AS client_name, uc.email AS client_email, ua.full_name AS assigned_admin_name, ue.full_name AS assigned_redactor_name
       FROM projects p
       LEFT JOIN users uc ON uc.id = p.client_id
       LEFT JOIN users ua ON ua.id = p.assigned_admin_id
       LEFT JOIN users ue ON ue.id = p.assigned_editor_id
        WHERE p.assigned_admin_id = ?
        ORDER BY p.created_at DESC`,
      [user.id]
    );
    return rows;
  }

  const [rows] = await pool.query(
    `SELECT p.*, uc.full_name AS client_name, uc.email AS client_email, ua.full_name AS assigned_admin_name, ue.full_name AS assigned_redactor_name
     FROM projects p
     LEFT JOIN users uc ON uc.id = p.client_id
     LEFT JOIN users ua ON ua.id = p.assigned_admin_id
     LEFT JOIN users ue ON ue.id = p.assigned_editor_id
     ORDER BY p.created_at DESC`
  );
  return rows;
}

export async function updateProjectStatus({ projectId, status, notes = null, actor = null, connection = null }) {
  if (!isValidProjectStatus(status)) {
    throw new Error('INVALID_PROJECT_STATUS');
  }
  const executor = pickExecutor(connection);
  const [existingRows] = await executor.query(
    `SELECT status, completed_at, finalized_at FROM projects WHERE id = ?`,
    [projectId]
  );
  const existing = existingRows[0];
  if (!existing) {
    throw new Error('PROJECT_NOT_FOUND');
  }
  const sanitizedNotes = sanitizeText(notes);
  const now = new Date();
  let completedAt = coerceDate(existing.completed_at);
  let finalizedAt = coerceDate(existing.finalized_at);
  if (status === 'completed') {
    completedAt = completedAt || now;
  } else if (existing.status === 'completed') {
    completedAt = null;
    finalizedAt = null;
  }
  await executor.query(
    `UPDATE projects
        SET status = ?,
            progress_notes = ?,
            completed_at = ?,
            finalized_at = ?,
            updated_at = CURRENT_TIMESTAMP
      WHERE id = ?`,
    [status, sanitizedNotes, completedAt, finalizedAt, projectId]
  );
  const statusInfo = getProjectStatusById(status);
  const message = sanitizedNotes || statusInfo?.clientMessage || statusInfo?.description || null;
  await addProjectTimelineEntry({
    projectId,
    entryType: 'status',
    status,
    message,
    actor,
    connection: executor
  });
}

export async function getProjectById(projectId) {
  const [rows] = await pool.query(
    `SELECT p.*, uc.full_name AS client_name, uc.email AS client_email,
            ua.full_name AS admin_name, ue.full_name AS redactor_name
     FROM projects p
     LEFT JOIN users uc ON uc.id = p.client_id
     LEFT JOIN users ua ON ua.id = p.assigned_admin_id
     LEFT JOIN users ue ON ue.id = p.assigned_editor_id
     WHERE p.id = ?`,
    [projectId]
  );
  return rows[0] || null;
}

export async function assignProject(projectId, { adminId, redactorId }) {
  const updates = [];
  const params = [];
  if (adminId !== undefined) {
    updates.push('assigned_admin_id = ?');
    params.push(adminId);
  }
  if (redactorId !== undefined) {
    updates.push('assigned_editor_id = ?');
    params.push(redactorId);
  }
  if (!updates.length) {
    return;
  }
  updates.push('updated_at = CURRENT_TIMESTAMP');
  params.push(projectId);
  const setClause = updates.join(', ');
  await pool.query(`UPDATE projects SET ${setClause} WHERE id = ?`, params);
}

export async function listProjectFiles(projectId) {
  const [rows] = await pool.query(
    `SELECT pf.id, pf.project_id, pf.uploader_id, pf.uploader_role, pf.origin, pf.original_name, pf.stored_name,
            pf.mime_type, pf.file_size, pf.created_at, u.full_name AS uploader_name
       FROM project_files pf
       LEFT JOIN users u ON u.id = pf.uploader_id
      WHERE pf.project_id = ? AND pf.is_deleted = 0
      ORDER BY pf.created_at DESC, pf.id DESC`,
    [projectId]
  );
  return rows;
}

export async function countProjectFilesByOrigin(projectId, origin) {
  const [[result]] = await pool.query(
    `SELECT COUNT(*) AS total
       FROM project_files
      WHERE project_id = ? AND origin = ? AND is_deleted = 0`,
    [projectId, origin]
  );
  return Number(result?.total || 0);
}

export async function createProjectFile({
  projectId,
  uploaderId,
  uploaderRole,
  origin,
  originalName,
  storedName,
  mimeType,
  fileSize,
  connection = null
}) {
  const executor = pickExecutor(connection);
  const [result] = await executor.query(
    `INSERT INTO project_files
        (project_id, uploader_id, uploader_role, origin, original_name, stored_name, mime_type, file_size)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [projectId, uploaderId, uploaderRole, origin, originalName, storedName, mimeType, fileSize]
  );
  return result.insertId;
}

export async function getProjectFileById(fileId) {
  const [rows] = await pool.query(
    `SELECT pf.*, u.full_name AS uploader_name
       FROM project_files pf
       LEFT JOIN users u ON u.id = pf.uploader_id
      WHERE pf.id = ? AND pf.is_deleted = 0`,
    [fileId]
  );
  return rows[0] || null;
}

export async function softDeleteProjectFile(fileId, { actor } = {}) {
  const file = await getProjectFileById(fileId);
  await pool.query(
    `UPDATE project_files
        SET is_deleted = 1,
            deleted_at = CURRENT_TIMESTAMP,
            updated_at = CURRENT_TIMESTAMP
      WHERE id = ?`,
    [fileId]
  );
  if (actor && file) {
    await addProjectTimelineEntry({
      projectId: file.project_id,
      entryType: 'log',
      visibility: 'admin',
      message: `${actor.fullName} (${actor.role}) a șters fișierul ${file.original_name}.`,
      actor
    });
  }
}

export async function listDocumentRequests(projectId) {
  const [rows] = await pool.query(
    `SELECT r.id, r.project_id, r.requested_by, r.message, r.status, r.created_at, r.closed_at, r.closed_by,
            ru.full_name AS requester_name, cu.full_name AS closed_by_name
       FROM project_document_requests r
       LEFT JOIN users ru ON ru.id = r.requested_by
       LEFT JOIN users cu ON cu.id = r.closed_by
      WHERE r.project_id = ?
      ORDER BY r.created_at DESC, r.id DESC`,
    [projectId]
  );
  return rows;
}

export async function createDocumentRequest({ projectId, requestedBy, message }) {
  const sanitizedMessage = sanitizeText(message);
  if (!sanitizedMessage) {
    throw new Error('EMPTY_MESSAGE');
  }
  const [result] = await pool.query(
    `INSERT INTO project_document_requests (project_id, requested_by, message)
     VALUES (?, ?, ?)`,
    [projectId, requestedBy, sanitizedMessage]
  );
  return result.insertId;
}

export async function closeDocumentRequest({ requestId, closedBy }) {
  await pool.query(
    `UPDATE project_document_requests
        SET status = 'closed', closed_at = CURRENT_TIMESTAMP, closed_by = ?
      WHERE id = ?`,
    [closedBy || null, requestId]
  );
}

export async function getDocumentRequestById(requestId) {
  const [rows] = await pool.query(
    `SELECT r.*, ru.full_name AS requester_name
       FROM project_document_requests r
       LEFT JOIN users ru ON ru.id = r.requested_by
      WHERE r.id = ?`,
    [requestId]
  );
  return rows[0] || null;
}

export async function hasOpenDocumentRequests(projectId) {
  const [[result]] = await pool.query(
    `SELECT COUNT(*) AS total
       FROM project_document_requests
      WHERE project_id = ? AND status = 'open'`,
    [projectId]
  );
  return Number(result?.total || 0) > 0;
}

export async function getClientProjectHighlights(clientId) {
  const [[deadlineRows], [adminRows], [redactorRows]] = await Promise.all([
    pool.query(
      `SELECT p.id, p.title, p.deadline, ua.full_name AS admin_name, ue.full_name AS redactor_name
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
    redactors: redactorRows
  };
}

export async function getRedactorProjectHighlights(redactorId) {
  const [[statusRows], [deadlineRows]] = await Promise.all([
    pool.query(
      `SELECT status, COUNT(*) AS total
       FROM projects
       WHERE assigned_editor_id = ?
       GROUP BY status`,
      [redactorId]
    ),
    pool.query(
      `SELECT id, title, deadline
       FROM projects
       WHERE assigned_editor_id = ? AND deadline IS NOT NULL
       ORDER BY deadline ASC
       LIMIT 3`,
      [redactorId]
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

export async function getProjectTimelineEntries(
  projectId,
  { limit = 10, offset = 0, visibilities = ['public'] } = {}
) {
  const safeLimit = Math.max(1, Number(limit));
  const safeOffset = Math.max(0, Number(offset));
  const rawVisibilities = Array.isArray(visibilities) ? visibilities : ['public'];
  const sanitizedVisibilities = rawVisibilities
    .map((value) => (typeof value === 'string' ? value.trim() : null))
    .filter((value) => value);
  const uniqueVisibilities = Array.from(new Set(sanitizedVisibilities));
  const finalVisibilities = uniqueVisibilities.length ? uniqueVisibilities : ['public'];
  const placeholders = finalVisibilities.map(() => '?').join(', ');
  const [rows] = await pool.query(
    `SELECT id, entry_type, status, message, visibility, created_at, created_by, author_name, author_role
       FROM project_timeline_entries
       WHERE project_id = ? AND visibility IN (${placeholders})
       ORDER BY created_at DESC, id DESC
       LIMIT ? OFFSET ?`,
    [projectId, ...finalVisibilities, safeLimit, safeOffset]
  );
  return rows;
}

export async function getProjectTimelineLastRead(projectId, userId, { connection = null } = {}) {
  if (!projectId || !userId) {
    return null;
  }
  const executor = pickExecutor(connection);
  const [rows] = await executor.query(
    `SELECT last_read_at
       FROM project_timeline_reads
      WHERE project_id = ? AND user_id = ?`,
    [projectId, userId]
  );
  const record = rows[0];
  if (!record?.last_read_at) {
    return null;
  }
  const value = record.last_read_at instanceof Date ? record.last_read_at : new Date(record.last_read_at);
  return Number.isNaN(value?.getTime()) ? null : value;
}

export async function markProjectTimelineRead({
  projectId,
  userId,
  timestamp = new Date(),
  connection = null
}) {
  if (!projectId || !userId) {
    return false;
  }
  const executor = pickExecutor(connection);
  const safeTimestamp = timestamp instanceof Date ? timestamp : new Date(timestamp);
  const normalizedTimestamp = Number.isNaN(safeTimestamp?.getTime()) ? new Date() : safeTimestamp;
  await executor.query(
    `INSERT INTO project_timeline_reads (project_id, user_id, last_read_at)
     VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE last_read_at = GREATEST(last_read_at, VALUES(last_read_at))`,
    [projectId, userId, normalizedTimestamp]
  );
  return true;
}

export async function addProjectComment({ projectId, message, actor, visibility = 'public', connection = null }) {
  const sanitizedMessage = sanitizeText(message);
  if (!sanitizedMessage) {
    throw new Error('EMPTY_MESSAGE');
  }
  await addProjectTimelineEntry({
    projectId,
    entryType: 'comment',
    message: sanitizedMessage,
    actor,
    visibility,
    connection
  });
}

export async function finalizeProjectConversation(
  projectId,
  { actor = null, reason = 'manual', connection = null } = {}
) {
  const executor = pickExecutor(connection);
  const [rows] = await executor.query(
    `SELECT status, finalized_at FROM projects WHERE id = ?`,
    [projectId]
  );
  const project = rows[0];
  if (!project) {
    throw new Error('PROJECT_NOT_FOUND');
  }
  if (project.status !== 'completed') {
    throw new Error('PROJECT_NOT_COMPLETED');
  }
  if (project.finalized_at) {
    return false;
  }
  await executor.query(
    `UPDATE projects
        SET finalized_at = CURRENT_TIMESTAMP,
            updated_at = CURRENT_TIMESTAMP
      WHERE id = ?`,
    [projectId]
  );
  const message =
    reason === 'auto'
      ? 'Proiectul a fost arhivat automat după 24 de ore în starea „Proiect Finalizat / Arhivat”.'
      : 'Proiectul a fost arhivat manual de superadmin. Discuțiile au fost închise.';
  const actorInfo = actor || { fullName: 'Sistem', role: 'system' };
  await addProjectTimelineEntry({
    projectId,
    entryType: 'comment',
    message,
    actor: actorInfo,
    visibility: 'public',
    connection: executor
  });
  return true;
}

export async function ensureProjectCompletionFinalized(project) {
  if (!project || project.status !== 'completed') {
    return { project, autoFinalized: false };
  }
  const finalizedAt = coerceDate(project.finalized_at);
  if (finalizedAt) {
    return { project, autoFinalized: false };
  }
  const deadline = getProjectCompletionDeadline(project);
  const now = new Date();
  if (deadline && now >= deadline) {
    const finalized = await finalizeProjectConversation(project.id, { reason: 'auto' });
    if (finalized) {
      const refreshed = await getProjectById(project.id);
      return { project: refreshed, autoFinalized: true };
    }
    const refreshed = await getProjectById(project.id);
    return { project: refreshed, autoFinalized: false };
  }
  return { project, autoFinalized: false };
}

export async function createProjectFromTicket({ ticketId, actor }) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.query(
      `SELECT t.id, t.subject, t.message, t.project_id, t.created_by, t.display_code,
              o.id AS offer_id, o.program, o.topic, o.work_type, o.delivery_date, o.offer_amount, o.notes AS offer_notes,
              cs.contract_stage, cs.user_id AS contract_user_id, cs.contract_number, cs.contract_date,
              p.id AS existing_project_id
         FROM tickets t
         LEFT JOIN offers o ON o.ticket_id = t.id
         LEFT JOIN contract_signatures cs ON cs.ticket_id = t.id
         LEFT JOIN projects p ON p.source_ticket_id = t.id
        WHERE t.id = ?
        FOR UPDATE`,
      [ticketId]
    );
    const record = rows[0];
    if (!record) {
      throw new Error('TICKET_NOT_FOUND');
    }
    if (record.contract_stage !== 'completed') {
      throw new Error('CONTRACT_NOT_COMPLETED');
    }
    if (record.project_id || record.existing_project_id) {
      throw new Error('PROJECT_ALREADY_EXISTS');
    }

    const clientId = record.contract_user_id || record.created_by;
    if (!clientId) {
      throw new Error('CLIENT_NOT_IDENTIFIED');
    }

    const title = sanitizeText(record.topic) || sanitizeText(record.subject) || 'Proiect nou';
    const degreeLevel = sanitizeText(record.program) || sanitizeText(record.work_type) || 'Program nespecificat';
    const deadline = record.delivery_date || null;

    const descriptionSegments = [];
    if (record.topic) {
      descriptionSegments.push(`Tema: ${record.topic}`);
    }
    if (record.work_type) {
      descriptionSegments.push(`Tip lucrare: ${record.work_type}`);
    }
    if (record.program) {
      descriptionSegments.push(`Program de studiu: ${record.program}`);
    }
    if (record.offer_amount) {
      descriptionSegments.push(`Buget agreat: ${Number(record.offer_amount).toFixed(2)} RON`);
    }
    if (record.offer_notes) {
      descriptionSegments.push(`Note administrator ofertă: ${record.offer_notes}`);
    }
    if (record.contract_number || record.contract_date) {
      const contractDate = record.contract_date ? new Date(record.contract_date) : null;
      const formattedDate = contractDate && !Number.isNaN(contractDate.getTime())
        ? contractDate.toISOString().slice(0, 10)
        : null;
      const contractDetails = [];
      if (record.contract_number) {
        contractDetails.push(`#${record.contract_number}`);
      }
      if (formattedDate) {
        contractDetails.push(`din ${formattedDate}`);
      }
      const suffix = contractDetails.length ? ` ${contractDetails.join(' ')}` : '';
      descriptionSegments.push(`Contract semnat${suffix}`);
    }
    descriptionSegments.push('Detalii ticket inițial:');
    descriptionSegments.push(record.message || '—');
    const description = descriptionSegments.join('\n\n');

    const assignedAdminId = ['admin', 'superadmin'].includes(actor?.role) ? actor?.id || null : null;
    const initialNote = `Proiect creat din ticketul #${record.display_code} pe baza contractului semnat.`;

    const { id: projectId, projectCode } = await createProject({
      title,
      description,
      degreeLevel,
      deadline,
      clientId,
      assignedAdminId,
      assignedRedactorId: null,
      sourceTicketId: ticketId,
      actor,
      initialNote,
      connection
    });

    await connection.query('UPDATE tickets SET project_id = ? WHERE id = ?', [projectId, ticketId]);

    await addProjectComment({
      projectId,
      message: 'Discuția proiectului poate continua aici. Te rugăm să folosești timeline-ul pentru clarificări.',
      actor: {
        id: actor?.id || null,
        fullName: actor?.fullName || 'Sistem',
        role: actor?.role || 'system'
      },
      connection
    });

    await connection.commit();

    if (actor) {
      await addTicketLog({
        ticketId,
        message: `Proiectul ${projectCode} a fost creat automat din acest ticket.`,
        visibility: 'internal',
        actor
      });
    }

    return { projectId, projectCode };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export {
  PROJECT_STATUSES,
  PROJECT_FLOW_STATUSES,
  getProjectStatusById,
  getNextProjectStatusId,
  getPreviousProjectStatusId
};
