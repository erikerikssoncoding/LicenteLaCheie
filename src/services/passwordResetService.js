import crypto from 'crypto';
import { nanoid } from 'nanoid';
import pool from '../config/db.js';

const RESET_TOKEN_TTL_MS = 15 * 60 * 1000;

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

async function purgeExpiredTokens(executor = pool) {
  await executor.query('DELETE FROM password_reset_tokens WHERE expires_at <= NOW()');
}

export async function createPasswordResetToken(userId) {
  if (!userId) {
    throw new Error('RESET_TOKEN_MISSING_USER');
  }
  await purgeExpiredTokens();
  const token = nanoid(48);
  const hashed = hashToken(token);
  const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MS);
  await pool.query(
    'INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) VALUES (?, ?, ?)',
    [userId, hashed, expiresAt]
  );
  return { token, expiresAt: expiresAt.getTime() };
}

export async function consumePasswordResetToken(token) {
  if (!token) {
    return null;
  }
  const hashed = hashToken(token);
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.query(
      `SELECT id, user_id, expires_at, consumed_at
       FROM password_reset_tokens
       WHERE token_hash = ?
       FOR UPDATE`,
      [hashed]
    );
    const entry = rows[0];
    if (!entry) {
      await connection.rollback();
      return null;
    }
    const expiresAt = new Date(entry.expires_at);
    if (entry.consumed_at || expiresAt <= new Date()) {
      await connection.rollback();
      return null;
    }
    await connection.query('UPDATE password_reset_tokens SET consumed_at = NOW() WHERE id = ?', [
      entry.id
    ]);
    await connection.commit();
    return { userId: entry.user_id, expiresAt: expiresAt.getTime() };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}
