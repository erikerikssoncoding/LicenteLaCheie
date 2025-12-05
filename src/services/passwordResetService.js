import crypto from 'crypto';
import { nanoid } from 'nanoid';

const RESET_TOKEN_TTL_MS = 15 * 60 * 1000;
const resetTokens = new Map();

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function purgeExpiredTokens() {
  const now = Date.now();
  for (const [key, entry] of resetTokens.entries()) {
    if (!entry || entry.expiresAt <= now) {
      resetTokens.delete(key);
    }
  }
}

export function createPasswordResetToken(userId) {
  if (!userId) {
    throw new Error('RESET_TOKEN_MISSING_USER');
  }
  purgeExpiredTokens();
  const token = nanoid(48);
  const hashed = hashToken(token);
  const expiresAt = Date.now() + RESET_TOKEN_TTL_MS;
  resetTokens.set(hashed, { userId, expiresAt });
  return { token, expiresAt };
}

export function consumePasswordResetToken(token) {
  if (!token) {
    return null;
  }
  purgeExpiredTokens();
  const hashed = hashToken(token);
  const entry = resetTokens.get(hashed);
  if (!entry) {
    return null;
  }
  resetTokens.delete(hashed);
  if (entry.expiresAt <= Date.now()) {
    return null;
  }
  return entry;
}
