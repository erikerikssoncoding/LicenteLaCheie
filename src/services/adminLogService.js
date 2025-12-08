import pool from '../config/db.js';

function sanitizeDetails(details = {}) {
  if (!details || typeof details !== 'object') {
    return {};
  }
  const cloned = { ...details };
  if (cloned.body && typeof cloned.body === 'object') {
    const sanitizedBody = { ...cloned.body };
    ['password', 'newPassword', 'confirmPassword'].forEach((key) => {
      if (key in sanitizedBody) {
        sanitizedBody[key] = '[redacted]';
      }
    });
    cloned.body = sanitizedBody;
  }
  return cloned;
}

export async function logAdminAction({
  actor = null,
  action,
  details = null,
  statusCode = null,
  ipAddress = null,
  userAgent = null
}) {
  if (!action) {
    return;
  }
  const serializedDetails = details ? JSON.stringify(sanitizeDetails(details)) : null;
  
  // MODIFICARE: Am scos "CAST(? AS JSON)" și am lăsat doar "?"
  await pool.query(
    `INSERT INTO admin_action_logs (user_id, user_name, user_role, action, details_json, status_code, ip_address, user_agent)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      actor?.id || null,
      actor?.fullName || actor?.full_name || null,
      actor?.role || null,
      action,
      serializedDetails, // Se trimite ca string simplu; baza de date se ocupă de restul
      Number.isInteger(statusCode) ? statusCode : null,
      ipAddress || null,
      userAgent || null
    ]
  );
}

export async function listRecentAdminActions(limit = 50) {
  const safeLimit = Math.min(200, Math.max(1, Number(limit)));
  try {
    const [rows] = await pool.query(
      `SELECT id, user_id, user_name, user_role, action, details_json, status_code, ip_address, user_agent, created_at
         FROM admin_action_logs
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
