import crypto from 'crypto';
import pool from '../config/db.js';

const PASSKEY_TOKEN_BYTES = 48;
export const PASSKEY_LIMIT_PER_USER = 3;

function hashToken(token) {
  return crypto.createHash('sha512').update(token).digest('hex');
}

function sanitizeLabel(label) {
  if (!label) {
    return 'Passkey securizat';
  }
  const trimmed = label.toString().trim();
  if (!trimmed.length) {
    return 'Passkey securizat';
  }
  return trimmed.slice(0, 150);
}

export function generatePasskeyToken() {
  return crypto.randomBytes(PASSKEY_TOKEN_BYTES).toString('hex');
}

export async function countActivePasskeysForUser(userId) {
  const [rows] = await pool.query(
    `SELECT COUNT(*) AS total
     FROM passkeys
     WHERE user_id = ?
       AND revoked_at IS NULL`,
    [userId]
  );
  return rows[0]?.total || 0;
}

export async function createPasskey({ userId, label }) {
  if (!userId) {
    throw new Error('USER_ID_REQUIRED');
  }
  const activeCount = await countActivePasskeysForUser(userId);
  if (activeCount >= PASSKEY_LIMIT_PER_USER) {
    const error = new Error('PASSKEY_LIMIT_REACHED');
    error.status = 400;
    throw error;
  }
  const token = generatePasskeyToken();
  const tokenHash = hashToken(token);
  const name = sanitizeLabel(label);
  const [result] = await pool.query(
    `INSERT INTO passkeys (user_id, name, token_hash, created_at)
     VALUES (?, ?, ?, NOW())`,
    [userId, name, tokenHash]
  );
  return { token, passkeyId: result.insertId, name };
}

export async function listPasskeysForUser(userId, { includeRevoked = true } = {}) {
  if (!userId) {
    return [];
  }
  const conditions = ['user_id = ?'];
  const params = [userId];
  if (!includeRevoked) {
    conditions.push('revoked_at IS NULL');
  }
  const [rows] = await pool.query(
    `SELECT id, name, created_at, last_used_at, revoked_at
     FROM passkeys
     WHERE ${conditions.join(' AND ')}
     ORDER BY created_at DESC`,
    params
  );
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
    revokedAt: row.revoked_at,
    status: row.revoked_at ? 'revoked' : 'active'
  }));
}

export async function revokePasskey({ userId, passkeyId }) {
  if (!userId || !passkeyId) {
    return false;
  }
  const [result] = await pool.query(
    `UPDATE passkeys
     SET revoked_at = NOW()
     WHERE id = ?
       AND user_id = ?
       AND revoked_at IS NULL`,
    [passkeyId, userId]
  );
  return result.affectedRows > 0;
}

export async function revokeAllPasskeysForUser(userId) {
  if (!userId) {
    return 0;
  }
  const [result] = await pool.query(
    `UPDATE passkeys
     SET revoked_at = NOW()
     WHERE user_id = ?
       AND revoked_at IS NULL`,
    [userId]
  );
  return result.affectedRows || 0;
}

export async function authenticatePasskey(token) {
  if (!token || typeof token !== 'string' || token.length < 40) {
    return null;
  }
  const tokenHash = hashToken(token);
  const [rows] = await pool.query(
    `SELECT p.id AS passkey_id,
            p.user_id,
            p.revoked_at,
            u.id,
            u.email,
            u.full_name,
            u.role,
            u.phone,
            u.is_active
     FROM passkeys p
     JOIN users u ON u.id = p.user_id
     WHERE p.token_hash = ?
       AND p.revoked_at IS NULL
     LIMIT 1`,
    [tokenHash]
  );
  const match = rows[0];
  if (!match || !match.is_active) {
    return null;
  }
  await pool.query(
    `UPDATE passkeys
     SET last_used_at = NOW()
     WHERE id = ?`,
    [match.passkey_id]
  );
  return {
    passkeyId: match.passkey_id,
    user: {
      id: match.id,
      email: match.email,
      fullName: match.full_name,
      role: match.role,
      phone: match.phone
    }
  };
}
