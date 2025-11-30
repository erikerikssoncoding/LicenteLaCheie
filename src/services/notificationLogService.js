import pool from '../config/db.js';

function normalizeRecipients(recipients = []) {
  if (!Array.isArray(recipients)) {
    return [];
  }
  return [...new Set(recipients.map((item) => String(item || '').trim()).filter(Boolean))];
}

export async function logMailEvent({ eventType, subject, recipients = [], status = 'sent', errorMessage = null, context = null }) {
  const normalizedRecipients = normalizeRecipients(recipients);
  const serializedContext = context ? JSON.stringify(context) : null;
  await pool.query(
    `INSERT INTO mail_notification_logs (event_type, subject, recipients, status, error_message, context_json)
     VALUES (?, ?, ?, ?, ?, ?)` ,
    [
      eventType || 'generic',
      subject || null,
      normalizedRecipients.join(', '),
      ['sent', 'error', 'skipped'].includes(status) ? status : 'sent',
      errorMessage || null,
      serializedContext
    ]
  );
}

export async function listRecentMailEvents(limit = 25) {
  const safeLimit = Math.min(100, Math.max(1, Number(limit)));
  try {
    const [rows] = await pool.query(
      `SELECT id, event_type, subject, recipients, status, error_message, context_json, created_at
         FROM mail_notification_logs
        ORDER BY created_at DESC, id DESC
        LIMIT ?`,
      [safeLimit]
    );
    return rows;
  } catch (error) {
    if (error.code === 'ER_NO_SUCH_TABLE') {
      return [];
    }
    throw error;
  }
}
