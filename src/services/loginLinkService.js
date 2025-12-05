import { nanoid } from 'nanoid';

const LOGIN_LINK_TTL_MS = 15 * 60 * 1000;
const loginTokens = new Map();

function purgeExpiredTokens() {
  const now = Date.now();
  for (const [token, entry] of loginTokens.entries()) {
    if (!entry || entry.expiresAt <= now) {
      loginTokens.delete(token);
    }
  }
}

export function createOneTimeLoginLink({ userId }) {
  if (!userId) {
    throw new Error('LOGIN_TOKEN_MISSING_USER');
  }
  purgeExpiredTokens();
  const token = nanoid(48);
  const expiresAt = Date.now() + LOGIN_LINK_TTL_MS;
  loginTokens.set(token, { userId, expiresAt });
  return { token, expiresAt };
}

export function consumeOneTimeLoginToken(token) {
  if (!token) {
    return null;
  }
  purgeExpiredTokens();
  const entry = loginTokens.get(token);
  if (!entry) {
    return null;
  }
  loginTokens.delete(token);
  if (entry.expiresAt <= Date.now()) {
    return null;
  }
  return entry;
}
