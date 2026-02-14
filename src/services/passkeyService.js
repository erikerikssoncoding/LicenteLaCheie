import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse
} from '@simplewebauthn/server';
import pool from '../config/db.js';

export const PASSKEY_LIMIT_PER_USER = 3;
export const PASSKEY_TOTAL_LIMIT_PER_USER = 20;
const PASSKEY_ORIGIN_MAX_LENGTH = 2048;
const PASSKEY_RP_ID_MAX_LENGTH = 253;

const RP_ID_REGEX = /^([a-z0-9](-*[a-z0-9])*)(\.[a-z0-9](-*[a-z0-9])*)*$/i;
const IP_REGEX = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;
const ALPHANUM_SYMBOL_REGEX = /^[a-z0-9\s!"#$%&'()*+,./:;<=>?@[\\\]^_`{|}~-]+$/i;
const PASSKEY_CHALLENGE_MIN_LENGTH = 8;
const PASSKEY_CHALLENGE_MAX_LENGTH = 2048;

function sanitizeLabel(label) {
  if (!label) return 'Passkey securizat';
  const trimmed = label.toString().trim();
  return trimmed.length ? trimmed.slice(0, 150) : 'Passkey securizat';
}

function normalizePasskeyRpID(rpID) {
  if (!rpID || typeof rpID !== 'string') {
    return null;
  }
  const normalized = rpID.toLowerCase().trim();
  if (!normalized || normalized.length > PASSKEY_RP_ID_MAX_LENGTH) {
    return null;
  }
  if (normalized === 'localhost' || normalized === '127.0.0.1' || normalized === '::1') {
    return normalized;
  }
  if (!RP_ID_REGEX.test(normalized) || normalized.length > PASSKEY_RP_ID_MAX_LENGTH) {
    return null;
  }
  if (!/\.[a-z]{2,}$/i.test(normalized) && !IP_REGEX.test(normalized)) {
    return null;
  }
  return normalized;
}

function normalizePasskeyOrigin(origin, rpID) {
  if (!origin || typeof origin !== 'string' || origin.length > PASSKEY_ORIGIN_MAX_LENGTH) {
    return null;
  }
  const sanitized = origin.replace(/\s+/g, '');
  let parsed;
  try {
    parsed = new URL(sanitized);
  } catch (error) {
    return null;
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    return null;
  }
  const normalizedHost = normalizePasskeyRpID(parsed.hostname);
  if (!normalizedHost || normalizedHost !== rpID) {
    return null;
  }
  return `${parsed.protocol}//${parsed.host}`;
}

function normalizePasskeyCredentials(value) {
  if (!value || typeof value !== 'string') {
    return null;
  }
  const sanitized = value.trim();
  return ALPHANUM_SYMBOL_REGEX.test(sanitized) ? sanitized : null;
}

function parseTransports(value) {
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    return Array.isArray(parsed) ? parsed : undefined;
  } catch (error) {
    return undefined;
  }
}

// Funcție ajutătoare pentru a obține ID-ul corect ca string Base64URL
function normalizeCredentialID(credentialID) {
  if (!credentialID) return null;
  // Dacă e deja string, îl returnăm direct (evităm dubla codare)
  if (typeof credentialID === 'string') {
    return credentialID;
  }
  // Dacă e Buffer/Array, îl convertim
  return Buffer.from(credentialID).toString('base64url');
}

export async function countActivePasskeysForUser(userId) {
  const [rows] = await pool.query(
    `SELECT COUNT(*) AS total FROM passkeys WHERE user_id = ? AND revoked_at IS NULL`,
    [userId]
  );
  return rows[0]?.total || 0;
}

export async function countTotalPasskeysForUser(userId) {
  const [rows] = await pool.query(
    `SELECT COUNT(*) AS total FROM passkeys WHERE user_id = ?`,
    [userId]
  );
  return rows[0]?.total || 0;
}

async function getActiveCredentialDescriptors(userId) {
  const [rows] = await pool.query(
    `SELECT credential_id, transports FROM passkeys WHERE user_id = ? AND revoked_at IS NULL`,
    [userId]
  );
  return rows
    .map((row) => {
      // row.credential_id este deja string Base64URL corect în noua implementare
      return {
        id: row.credential_id, 
        type: 'public-key',
        transports: parseTransports(row.transports)
      };
    })
    .filter(Boolean);
}

export async function generatePasskeyRegistrationOptions({ user, rpID, rpName }) {
  if (!user?.id) throw new Error('USER_REQUIRED');
  const normalizedRpID = normalizePasskeyRpID(rpID);
  if (!normalizedRpID) {
    throw new Error('PASSKEY_RP_ID_INVALID');
  }

  const [activeCount, totalCount] = await Promise.all([
    countActivePasskeysForUser(user.id),
    countTotalPasskeysForUser(user.id)
  ]);

  if (activeCount >= PASSKEY_LIMIT_PER_USER) {
    const error = new Error('PASSKEY_LIMIT_REACHED');
    error.status = 400;
    throw error;
  }

  if (totalCount >= PASSKEY_TOTAL_LIMIT_PER_USER) {
    const error = new Error('PASSKEY_TOTAL_LIMIT_REACHED');
    error.status = 400;
    throw error;
  }

  const excludeCredentials = await getActiveCredentialDescriptors(user.id);
  const userName = user.email || `user-${user.id}`;
  const displayName = user.fullName || user.email || `Utilizator ${user.id}`;
  
  // Convertim ID-ul numeric în format binar compatibil cu standardul nou
  const userID = new Uint8Array(Buffer.from(String(user.id)));

  return generateRegistrationOptions({
    rpName,
    rpID: normalizedRpID,
    userName,
    userDisplayName: displayName,
    userID,
    attestationType: 'none',
    excludeCredentials,
    authenticatorSelection: {
      residentKey: 'preferred',
      userVerification: 'preferred',
    }
  });
}

export async function verifyPasskeyRegistration({ userId, response, expectedChallenge, rpID, origin, label }) {
  if (!userId) throw new Error('USER_ID_REQUIRED');
  if (!expectedChallenge) throw new Error('PASSKEY_CHALLENGE_MISSING');
  const normalizedRpID = normalizePasskeyRpID(rpID);
  if (!normalizedRpID) {
    throw new Error('PASSKEY_RP_ID_INVALID');
  }
  const normalizedOrigin = normalizePasskeyOrigin(origin, normalizedRpID);
  if (!normalizedOrigin) {
    throw new Error('PASSKEY_ORIGIN_INVALID');
  }
  if (!response || typeof response !== 'object') {
    throw new Error('PASSKEY_RESPONSE_INVALID');
  }

  const [activeCount, totalCount] = await Promise.all([
    countActivePasskeysForUser(userId),
    countTotalPasskeysForUser(userId)
  ]);

  if (activeCount >= PASSKEY_LIMIT_PER_USER || totalCount >= PASSKEY_TOTAL_LIMIT_PER_USER) {
    const error = new Error('PASSKEY_LIMIT_REACHED');
    error.status = 400;
    throw error;
  }

  const verification = await verifyRegistrationResponse({
    response,
    expectedChallenge,
    expectedOrigin: normalizedOrigin,
    expectedRPID: normalizedRpID,
    requireUserVerification: true
  });

  if (!verification.verified || !verification.registrationInfo) {
    const error = new Error('PASSKEY_REGISTRATION_FAILED');
    error.status = 400;
    throw error;
  }

  const { registrationInfo } = verification;
  
  // FIX CRITIC: Folosim funcția de normalizare pentru a evita dubla codare
  const credentialIdEncoded = normalizeCredentialID(registrationInfo.credentialID);
  
  const credentialPublicKey = registrationInfo.credentialPublicKey;
  const credentialCounter = registrationInfo.counter ?? 0;
  const transports = parseTransports(registrationInfo.transports) || parseTransports(response?.response?.transports) || [];
  
  const publicKeyEncoded = Buffer.from(credentialPublicKey).toString('base64');
  const name = sanitizeLabel(label);

  await pool.query(
    `INSERT INTO passkeys (user_id, name, credential_id, public_key, counter, transports, created_at)
     VALUES (?, ?, ?, ?, ?, ?, NOW())`,
    [userId, name, credentialIdEncoded, publicKeyEncoded, credentialCounter, transports.length ? JSON.stringify(transports) : null]
  );

  return { verified: true };
}

// --- LOGICĂ NOUĂ PENTRU AUTENTIFICARE ---

export async function generatePasskeyAuthenticationOptions({ rpID }) {
  const normalizedRpID = normalizePasskeyRpID(rpID);
  if (!normalizedRpID) {
    throw new Error('PASSKEY_RP_ID_INVALID');
  }
  return generateAuthenticationOptions({
    rpID: normalizedRpID,
    userVerification: 'preferred',
  });
}

export async function verifyPasskeyAuthentication({ response, expectedChallenge, rpID, origin }) {
  if (!response || typeof response !== 'object') {
    throw new Error('PASSKEY_RESPONSE_INVALID');
  }
  if (!expectedChallenge || typeof expectedChallenge !== 'string') {
    throw new Error('PASSKEY_CHALLENGE_MISSING');
  }
  const normalizedChallenge = expectedChallenge.trim();
  if (
    normalizedChallenge.length < PASSKEY_CHALLENGE_MIN_LENGTH ||
    normalizedChallenge.length > PASSKEY_CHALLENGE_MAX_LENGTH
  ) {
    throw new Error('PASSKEY_CHALLENGE_INVALID');
  }

  const normalizedRpID = normalizePasskeyRpID(rpID);
  if (!normalizedRpID) {
    throw new Error('PASSKEY_RP_ID_INVALID');
  }
  const normalizedOrigin = normalizePasskeyOrigin(origin, normalizedRpID);
  if (!normalizedOrigin) {
    throw new Error('PASSKEY_ORIGIN_INVALID');
  }
  const credentialID = normalizePasskeyCredentials(response.id);
  if (!credentialID) {
    throw new Error('PASSKEY_CREDENTIAL_INVALID');
  }

  const [rows] = await pool.query(
    `SELECT p.*, u.email, u.full_name, u.role, u.phone, u.is_active
     FROM passkeys p
     JOIN users u ON p.user_id = u.id
     WHERE p.credential_id = ? AND p.revoked_at IS NULL`,
    [credentialID]
  );

  const passkey = rows[0];
  if (!passkey) {
    console.error('Passkey not found in DB.');
    throw new Error('PASSKEY_NOT_FOUND');
  }

  const verification = await verifyAuthenticationResponse({
    response,
    expectedChallenge: normalizedChallenge,
    expectedOrigin: normalizedOrigin,
    expectedRPID: normalizedRpID,
    authenticator: {
      credentialID: passkey.credential_id,
      credentialPublicKey: Buffer.from(passkey.public_key, 'base64'),
      counter: passkey.counter,
      transports: parseTransports(passkey.transports) || []
    }
  });

  if (!verification.verified) {
    throw new Error('VERIFICATION_FAILED');
  }

  const newCounter = verification.authenticationInfo.newCounter;
  await pool.query('UPDATE passkeys SET counter = ?, last_used_at = NOW() WHERE id = ?', [newCounter, passkey.id]);

  return {
    verified: true,
    user: {
      id: passkey.user_id,
      email: passkey.email,
      fullName: passkey.full_name,
      role: passkey.role,
      phone: passkey.phone,
      is_active: passkey.is_active
    }
  };
}

export async function listPasskeysForUser(userId, { includeRevoked = true } = {}) {
  if (!userId) return [];
  const conditions = ['user_id = ?'];
  if (!includeRevoked) conditions.push('revoked_at IS NULL');
  
  const [rows] = await pool.query(
    `SELECT id, name, created_at, last_used_at, revoked_at FROM passkeys WHERE ${conditions.join(' AND ')} ORDER BY created_at DESC`,
    [userId]
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
  if (!userId || !passkeyId) return false;
  const [result] = await pool.query(
    `UPDATE passkeys SET revoked_at = NOW() WHERE id = ? AND user_id = ? AND revoked_at IS NULL`,
    [passkeyId, userId]
  );
  return result.affectedRows > 0;
}

// Legacy - nu mai e folosit
export async function authenticatePasskey(token) {
  return null;
}
