import crypto from 'crypto';
import pool from '../config/db.js';

export const TRUSTED_DEVICE_COOKIE_NAME = 'licentelacheie.trust';
export const TRUSTED_DEVICE_MAX_AGE_MS = 1000 * 60 * 60 * 24 * 30; // 30 zile
const TRUSTED_DEVICE_EXPIRATION_DAYS = 30;
const TOKEN_BYTE_LENGTH = 48;

function hashToken(token) {
  return crypto.createHash('sha512').update(token).digest('hex');
}

function sanitizeText(value, maxLength) {
  if (!value) {
    return null;
  }
  const stringValue = String(value);
  if (stringValue.length <= maxLength) {
    return stringValue;
  }
  return stringValue.slice(0, maxLength);
}

function serializeExtraMetadata(extra) {
  if (!extra) {
    return null;
  }
  try {
    const json = JSON.stringify(extra);
    return json.length > 1000 ? json.slice(0, 1000) : json;
  } catch (error) {
    return null;
  }
}

function parseCookieHeader(header) {
  if (!header || typeof header !== 'string') {
    return {};
  }
  const pairs = header.split(';');
  return pairs.reduce((acc, pair) => {
    const index = pair.indexOf('=');
    if (index === -1) {
      return acc;
    }
    const key = pair.slice(0, index).trim();
    if (!key) {
      return acc;
    }
    const rawValue = pair.slice(index + 1).trim();
    try {
      acc[key] = decodeURIComponent(rawValue);
    } catch (error) {
      acc[key] = rawValue;
    }
    return acc;
  }, {});
}

export function readTrustedDeviceToken(req) {
  if (!req || !req.headers) {
    return null;
  }
  const cookies = parseCookieHeader(req.headers.cookie);
  const value = cookies[TRUSTED_DEVICE_COOKIE_NAME];
  if (!value || typeof value !== 'string' || value.length < 40) {
    return null;
  }
  return value;
}

export function getTrustedDeviceCookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: TRUSTED_DEVICE_MAX_AGE_MS,
    path: '/'
  };
}

export function getTrustedDeviceCookieClearOptions() {
  const options = getTrustedDeviceCookieOptions();
  delete options.maxAge;
  options.expires = new Date(0);
  return options;
}

export function generateTrustedDeviceToken() {
  return crypto.randomBytes(TOKEN_BYTE_LENGTH).toString('hex');
}

function buildMetadataPayload(metadata = {}) {
  return {
    userAgent: sanitizeText(metadata.userAgent, 1000),
    clientHints: sanitizeText(metadata.clientHints, 250),
    ipAddress: sanitizeText(metadata.ipAddress, 45),
    acceptLanguage: sanitizeText(metadata.acceptLanguage, 120),
    fingerprint: sanitizeText(metadata.fingerprint, 128),
    extraMetadata: serializeExtraMetadata(metadata.extraData)
  };
}

export async function createTrustedDevice({ userId, metadata, label }) {
  if (!userId) {
    throw new Error('USER_ID_REQUIRED');
  }
  const token = generateTrustedDeviceToken();
  const tokenHash = hashToken(token);
  const payload = buildMetadataPayload(metadata);
  const [result] = await pool.query(
    `INSERT INTO trusted_devices (
       user_id,
       token_hash,
       device_label,
       user_agent,
       client_hints,
       ip_address,
       accept_language,
       fingerprint,
       extra_metadata,
       created_at,
       last_used_at,
       expires_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW(), DATE_ADD(NOW(), INTERVAL ? DAY))`,
    [
      userId,
      tokenHash,
      label ? sanitizeText(label, 150) : null,
      payload.userAgent,
      payload.clientHints,
      payload.ipAddress,
      payload.acceptLanguage,
      payload.fingerprint,
      payload.extraMetadata,
      TRUSTED_DEVICE_EXPIRATION_DAYS
    ]
  );
  return { token, deviceId: result.insertId };
}

export async function findTrustedDeviceByToken(token) {
  if (!token) {
    return null;
  }
  const tokenHash = hashToken(token);
  const [rows] = await pool.query(
    `SELECT *
     FROM trusted_devices
     WHERE token_hash = ?
       AND revoked_at IS NULL
       AND expires_at > NOW()
     LIMIT 1`,
    [tokenHash]
  );
  return rows[0] || null;
}

export async function rotateTrustedDeviceToken(deviceId, metadata) {
  if (!deviceId) {
    return null;
  }
  const token = generateTrustedDeviceToken();
  const tokenHash = hashToken(token);
  const payload = buildMetadataPayload(metadata);
  const [result] = await pool.query(
    `UPDATE trusted_devices
     SET token_hash = ?,
         user_agent = ?,
         client_hints = ?,
         ip_address = ?,
         accept_language = ?,
         fingerprint = ?,
         extra_metadata = ?,
         last_used_at = NOW(),
         expires_at = DATE_ADD(NOW(), INTERVAL ? DAY)
     WHERE id = ?
       AND revoked_at IS NULL`,
    [
      tokenHash,
      payload.userAgent,
      payload.clientHints,
      payload.ipAddress,
      payload.acceptLanguage,
      payload.fingerprint,
      payload.extraMetadata,
      TRUSTED_DEVICE_EXPIRATION_DAYS,
      deviceId
    ]
  );
  if (result.affectedRows === 0) {
    return null;
  }
  return token;
}

export async function touchTrustedDevice(deviceId, metadata) {
  if (!deviceId) {
    return;
  }
  const payload = buildMetadataPayload(metadata);
  await pool.query(
    `UPDATE trusted_devices
     SET user_agent = ?,
         client_hints = ?,
         ip_address = ?,
         accept_language = ?,
         fingerprint = ?,
         extra_metadata = ?,
         last_used_at = NOW(),
         expires_at = DATE_ADD(NOW(), INTERVAL ? DAY)
     WHERE id = ?
       AND revoked_at IS NULL`,
    [
      payload.userAgent,
      payload.clientHints,
      payload.ipAddress,
      payload.acceptLanguage,
      payload.fingerprint,
      payload.extraMetadata,
      TRUSTED_DEVICE_EXPIRATION_DAYS,
      deviceId
    ]
  );
}

export async function revokeTrustedDevice({ userId, deviceId }) {
  if (!userId || !deviceId) {
    return false;
  }
  const [result] = await pool.query(
    `UPDATE trusted_devices
     SET revoked_at = NOW()
     WHERE user_id = ?
       AND id = ?
       AND revoked_at IS NULL`,
    [userId, deviceId]
  );
  return result.affectedRows > 0;
}

export async function revokeTrustedDevicesExcept({ userId, exceptDeviceId = null }) {
  if (!userId) {
    return 0;
  }
  const conditions = ['user_id = ?', 'revoked_at IS NULL'];
  const params = [userId];
  if (exceptDeviceId) {
    conditions.push('id <> ?');
    params.push(exceptDeviceId);
  }
  const [result] = await pool.query(
    `UPDATE trusted_devices
     SET revoked_at = NOW()
     WHERE ${conditions.join(' AND ')}`,
    params
  );
  return result.affectedRows || 0;
}

export async function listTrustedDevicesForUser(userId) {
  if (!userId) {
    return [];
  }
  const [rows] = await pool.query(
    `SELECT id,
            device_label,
            user_agent,
            client_hints,
            ip_address,
            accept_language,
            fingerprint,
            extra_metadata,
            created_at,
            last_used_at,
            expires_at
     FROM trusted_devices
     WHERE user_id = ?
       AND revoked_at IS NULL
     ORDER BY last_used_at DESC, created_at DESC`,
    [userId]
  );
  return rows.map((row) => ({
    id: row.id,
    label: row.device_label,
    userAgent: row.user_agent,
    clientHints: row.client_hints,
    ipAddress: row.ip_address,
    acceptLanguage: row.accept_language,
    fingerprint: row.fingerprint,
    extraMetadata: row.extra_metadata,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
    expiresAt: row.expires_at
  }));
}

export async function revokeTrustedDeviceByToken(token) {
  if (!token) {
    return false;
  }
  const tokenHash = hashToken(token);
  const [result] = await pool.query(
    `UPDATE trusted_devices
     SET revoked_at = NOW()
     WHERE token_hash = ?
       AND revoked_at IS NULL`,
    [tokenHash]
  );
  return result.affectedRows > 0;
}
