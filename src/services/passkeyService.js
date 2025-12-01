import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse
} from '@simplewebauthn/server';
import pool from '../config/db.js';

export const PASSKEY_LIMIT_PER_USER = 3;

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

function parseTransports(value) {
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    return Array.isArray(parsed) ? parsed : undefined;
  } catch (error) {
    return undefined;
  }
}

function decodeCredentialId(value) {
  if (!value) {
    return null;
  }
  try {
    return Buffer.from(value, 'base64url');
  } catch (error) {
    return null;
  }
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

async function getActiveCredentialDescriptors(userId) {
  const [rows] = await pool.query(
    `SELECT credential_id, transports
     FROM passkeys
     WHERE user_id = ?
       AND revoked_at IS NULL`,
    [userId]
  );
  return rows
    .map((row) => {
      const decodedId = decodeCredentialId(row.credential_id);
      if (!decodedId) {
        return null;
      }
      return {
        id: decodedId,
        type: 'public-key',
        transports: parseTransports(row.transports)
      };
    })
    .filter(Boolean);
}

async function getActiveCredentialDescriptorsForEmail(email) {
  if (!email) {
    return [];
  }

  const [rows] = await pool.query(
    `SELECT p.credential_id, p.transports
     FROM passkeys p
     INNER JOIN users u ON u.id = p.user_id
     WHERE u.email = ?
       AND u.is_active = 1
       AND p.revoked_at IS NULL`,
    [email]
  );

  return rows
    .map((row) => {
      const decodedId = decodeCredentialId(row.credential_id);
      if (!decodedId) {
        return null;
      }
      return {
        id: decodedId,
        type: 'public-key',
        transports: parseTransports(row.transports)
      };
    })
    .filter(Boolean);
}

export async function generatePasskeyRegistrationOptions({ user, rpID, rpName }) {
  if (!user?.id) {
    throw new Error('USER_REQUIRED');
  }
  const activeCount = await countActivePasskeysForUser(user.id);
  if (activeCount >= PASSKEY_LIMIT_PER_USER) {
    const error = new Error('PASSKEY_LIMIT_REACHED');
    error.status = 400;
    throw error;
  }
  const excludeCredentials = await getActiveCredentialDescriptors(user.id);
  const userName = user.email || `user-${user.id}`;
  const displayName = user.fullName || user.email || `Utilizator ${user.id}`;

  return generateRegistrationOptions({
    rpName,
    rpID,
    userName,
    userDisplayName: displayName,
    userID: String(user.id),
    attestationType: 'none',
    excludeCredentials
  });
}

export async function verifyPasskeyRegistration({
  userId,
  response,
  expectedChallenge,
  rpID,
  origin,
  label
}) {
  if (!userId) {
    throw new Error('USER_ID_REQUIRED');
  }
  if (!expectedChallenge) {
    throw new Error('PASSKEY_CHALLENGE_MISSING');
  }
  const activeCount = await countActivePasskeysForUser(userId);
  if (activeCount >= PASSKEY_LIMIT_PER_USER) {
    const error = new Error('PASSKEY_LIMIT_REACHED');
    error.status = 400;
    throw error;
  }

  const verification = await verifyRegistrationResponse({
    response,
    expectedChallenge,
    expectedOrigin: origin,
    expectedRPID: rpID,
    requireUserVerification: true
  });

  if (!verification.verified || !verification.registrationInfo) {
    const error = new Error('PASSKEY_REGISTRATION_FAILED');
    error.status = 400;
    throw error;
  }

  const { registrationInfo } = verification;
  const credentialID = registrationInfo.credentialID;
  const credentialPublicKey = registrationInfo.credentialPublicKey;
  const credentialCounter = registrationInfo.counter ?? 0;
  const transports = registrationInfo.transports || response?.response?.transports || [];

  const credentialIdEncoded = Buffer.from(credentialID).toString('base64url');
  const publicKeyEncoded = Buffer.from(credentialPublicKey).toString('base64');
  const name = sanitizeLabel(label);

  await pool.query(
    `INSERT INTO passkeys (user_id, name, credential_id, public_key, counter, transports, created_at)
     VALUES (?, ?, ?, ?, ?, ?, NOW())`,
    [userId, name, credentialIdEncoded, publicKeyEncoded, credentialCounter, transports.length ? JSON.stringify(transports) : null]
  );

  return { verified: true };
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

export async function generatePasskeyAuthenticationOptions({ rpID, userEmail }) {
  const allowCredentials = await getActiveCredentialDescriptorsForEmail(userEmail);

  const options = await generateAuthenticationOptions({
    rpID,
    userVerification: 'preferred',
    timeout: 60000,
    allowCredentials: allowCredentials.length ? allowCredentials : undefined
  });

  return options;
}

async function findPasskeyByCredentialId(credentialId) {
  if (!credentialId) {
    return null;
  }

  const [rows] = await pool.query(
    `SELECT
      p.id,
      p.user_id,
      p.credential_id,
      p.public_key,
      p.counter,
      p.transports,
      u.email,
      u.full_name,
      u.role,
      u.phone,
      u.is_active
     FROM passkeys p
     INNER JOIN users u ON u.id = p.user_id
     WHERE p.credential_id = ?
       AND p.revoked_at IS NULL
     LIMIT 1`,
    [credentialId]
  );

  const record = rows[0];
  if (!record || !record.is_active) {
    return null;
  }

  const credentialID = decodeCredentialId(record.credential_id);
  if (!credentialID) {
    return null;
  }

  const credentialPublicKey = record.public_key ? Buffer.from(record.public_key, 'base64') : null;
  if (!credentialPublicKey) {
    return null;
  }

  const transports = parseTransports(record.transports);

  return {
    id: record.id,
    userId: record.user_id,
    authenticator: {
      credentialID,
      credentialPublicKey,
      counter: Number(record.counter) || 0,
      transports
    },
    user: {
      id: record.user_id,
      email: record.email,
      fullName: record.full_name,
      role: record.role,
      phone: record.phone
    }
  };
}

export async function verifyPasskeyAuthentication({
  credential,
  expectedChallenge,
  rpID,
  origin,
  expectedEmail
}) {
  if (!expectedChallenge) {
    const error = new Error('PASSKEY_CHALLENGE_MISSING');
    error.status = 400;
    throw error;
  }

  const credentialId = credential?.rawId || credential?.id;
  const passkey = await findPasskeyByCredentialId(credentialId);

  if (!passkey) {
    const error = new Error('PASSKEY_NOT_FOUND');
    error.status = 404;
    throw error;
  }

  if (expectedEmail && passkey.user.email !== expectedEmail) {
    const error = new Error('PASSKEY_USER_MISMATCH');
    error.status = 403;
    throw error;
  }

  const verification = await verifyAuthenticationResponse({
    response: credential,
    expectedChallenge,
    expectedOrigin: origin,
    expectedRPID: rpID,
    authenticator: passkey.authenticator,
    requireUserVerification: true
  });

  if (!verification.verified || !verification.authenticationInfo) {
    const error = new Error('PASSKEY_VERIFICATION_FAILED');
    error.status = 401;
    throw error;
  }

  const newCounter = verification.authenticationInfo.newCounter ?? passkey.authenticator.counter;

  await pool.query(
    `UPDATE passkeys
     SET counter = ?, last_used_at = NOW()
     WHERE id = ?`,
    [newCounter, passkey.id]
  );

  return {
    verified: true,
    user: passkey.user
  };
}
