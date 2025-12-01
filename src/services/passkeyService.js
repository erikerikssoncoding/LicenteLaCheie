import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse
} from '@simplewebauthn/server';
import pool from '../config/db.js';

export const PASSKEY_LIMIT_PER_USER = 3;

function sanitizeLabel(label) {
  if (!label) return 'Passkey securizat';
  const trimmed = label.toString().trim();
  return trimmed.length ? trimmed.slice(0, 150) : 'Passkey securizat';
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
  
  const activeCount = await countActivePasskeysForUser(user.id);
  if (activeCount >= PASSKEY_LIMIT_PER_USER) {
    const error = new Error('PASSKEY_LIMIT_REACHED');
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
    rpID,
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
  
  // FIX CRITIC: Folosim funcția de normalizare pentru a evita dubla codare
  const credentialIdEncoded = normalizeCredentialID(registrationInfo.credentialID);
  
  const credentialPublicKey = registrationInfo.credentialPublicKey;
  const credentialCounter = registrationInfo.counter ?? 0;
  const transports = registrationInfo.transports || response?.response?.transports || [];
  
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

export async function generatePasskeyAuthenticationOptions() {
  return generateAuthenticationOptions({
    rpID: 'academiadelicente.ro', // Asigură-te că e corect (sau localhost în dev)
    userVerification: 'preferred',
  });
}

export async function verifyPasskeyAuthentication({ response, expectedChallenge, rpID, origin }) {
  const credentialID = response.id; // Browserul trimite string Base64URL

  console.log('--- PASSKEY AUTH ---');
  console.log('Searching for ID:', credentialID);

  // Căutăm exact string-ul primit, fără conversii
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
    expectedChallenge,
    expectedOrigin: origin,
    expectedRPID: rpID,
    authenticator: {
      credentialID: passkey.credential_id, // Biblioteca știe să gestioneze string-ul base64url
      credentialPublicKey: Buffer.from(passkey.public_key, 'base64'),
      counter: passkey.counter,
      transports: passkey.transports ? JSON.parse(passkey.transports) : []
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
