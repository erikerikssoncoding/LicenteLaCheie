import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import pool from '../config/db.js';
import { clearTrustedDevicesForUser, listTrustedDevicesForUser } from './trustedDeviceService.js';
import { listPasskeysForUser } from './passkeyService.js';

export const ROLE_HIERARCHY = {
  client: 1,
  redactor: 2,
  admin: 3,
  superadmin: 4
};

export async function findUserByEmail(email) {
  const [rows] = await pool.query('SELECT * FROM users WHERE email = ?', [email]);
  return rows[0] || null;
}

export async function createClient({
  fullName,
  email,
  password,
  phone
}) {
  const passwordHash = await bcrypt.hash(password, 12);
  const [result] = await pool.query(
    `INSERT INTO users (full_name, email, password_hash, phone, role, is_active, must_reset_password)
     VALUES (?, ?, ?, ?, 'client', 1, 0)`,
    [fullName, email.toLowerCase(), passwordHash, phone]
  );
  return result.insertId;
}

export async function validatePassword(user, password) {
  if (!user) return false;
  return bcrypt.compare(password, user.password_hash);
}

export const PROTECTED_USER_ID = 1;

export async function listTeamMembers() {
  const [rows] = await pool.query(
    `SELECT id, full_name, email, role
     FROM users
     WHERE role IN ('redactor', 'admin', 'superadmin') AND is_active = 1
     ORDER BY role, full_name`
  );
  return rows;
}

export async function getUserById(id) {
  const [rows] = await pool.query('SELECT * FROM users WHERE id = ?', [id]);
  return rows[0] || null;
}

export async function updateUserLastSeen(userId) {
  if (!userId) {
    return;
  }
  await pool.query(
    `UPDATE users
     SET last_seen_at = NOW()
     WHERE id = ?
       AND (last_seen_at IS NULL OR last_seen_at < DATE_SUB(NOW(), INTERVAL 1 MINUTE))`,
    [userId]
  );
}

export async function listClients() {
  const [rows] = await pool.query(
    `SELECT id, full_name, email, phone, created_at
     FROM users WHERE role = 'client' AND is_active = 1 ORDER BY created_at DESC`
  );
  return rows;
}

export async function ensureClientAccount({ fullName, email, phone }) {
  const normalizedEmail = email.toLowerCase();
  const existing = await findUserByEmail(normalizedEmail);
  if (existing) {
    await pool.query(
      `UPDATE users SET full_name = ?, phone = ?, is_active = 1 WHERE id = ?`,
      [fullName, phone, existing.id]
    );
    return { userId: existing.id, generatedPassword: null };
  }
  const generatedPassword = crypto.randomBytes(6).toString('hex');
  const passwordHash = await bcrypt.hash(generatedPassword, 12);
  const [result] = await pool.query(
    `INSERT INTO users (full_name, email, password_hash, phone, role, is_active, must_reset_password)
     VALUES (?, ?, ?, ?, 'client', 1, 1)`,
    [fullName, normalizedEmail, passwordHash, phone]
  );
  return { userId: result.insertId, generatedPassword };
}

export async function updateUserProfile(userId, { fullName, phone }) {
  await pool.query(
    `UPDATE users SET full_name = ?, phone = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
    [fullName, phone, userId]
  );
}

export async function changeUserPassword(userId, currentPassword, newPassword) {
  const user = await getUserById(userId);
  if (!user) {
    throw new Error('USER_NOT_FOUND');
  }
  const matches = await validatePassword(user, currentPassword);
  if (!matches) {
    throw new Error('INVALID_PASSWORD');
  }
  const passwordHash = await bcrypt.hash(newPassword, 12);
  await pool.query(
    `UPDATE users SET password_hash = ?, must_reset_password = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
    [passwordHash, userId]
  );
}

export async function listUsers({ role, status, search, viewer } = {}) {
  const conditions = [];
  const params = [];
  if (!viewer || viewer.role !== 'superadmin') {
    conditions.push('id <> ?');
    params.push(PROTECTED_USER_ID);
  }
  if (role && role !== 'all') {
    conditions.push('role = ?');
    params.push(role);
  }
  if (status === 'active') {
    conditions.push('is_active = 1');
  } else if (status === 'inactive') {
    conditions.push('is_active = 0');
  }
  if (search) {
    conditions.push('(LOWER(full_name) LIKE ? OR LOWER(email) LIKE ?)');
    const term = `%${search.toLowerCase()}%`;
    params.push(term, term);
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const [rows] = await pool.query(
    `SELECT id, full_name, email, phone, role, is_active, must_reset_password, created_at, last_seen_at
     FROM users
     ${where}
     ORDER BY created_at DESC`,
    params
  );
  return rows.map((row) => ({ ...row, is_protected: row.id === PROTECTED_USER_ID }));
}

export async function createManagedUser({ fullName, email, phone, role }) {
  const allowedRoles = ['client', 'redactor', 'admin', 'superadmin'];
  if (!allowedRoles.includes(role)) {
    throw new Error('INVALID_ROLE');
  }
  const normalizedEmail = email.toLowerCase();
  const existing = await findUserByEmail(normalizedEmail);
  if (existing) {
    throw new Error('EMAIL_EXISTS');
  }
  const generatedPassword = crypto.randomBytes(6).toString('hex');
  const passwordHash = await bcrypt.hash(generatedPassword, 12);
  const [result] = await pool.query(
    `INSERT INTO users (full_name, email, password_hash, phone, role, is_active, must_reset_password)
     VALUES (?, ?, ?, ?, ?, 1, 1)`,
    [fullName, normalizedEmail, passwordHash, phone || null, role]
  );
  return { id: result.insertId, generatedPassword };
}

export async function updateUserRole({ actor, userId, role }) {
  if (userId === PROTECTED_USER_ID) {
    throw new Error('PROTECTED_USER');
  }
  const allowedRoles = ['client', 'redactor', 'admin', 'superadmin'];
  if (!allowedRoles.includes(role)) {
    throw new Error('INVALID_ROLE');
  }
  if (!actor) {
    throw new Error('UNAUTHORIZED');
  }
  const target = await getUserById(userId);
  if (!target) {
    throw new Error('USER_NOT_FOUND');
  }
  if (target.id === actor.id) {
    throw new Error('SELF_MODIFICATION');
  }
  if (target.id === PROTECTED_USER_ID) {
    throw new Error('PROTECTED_USER');
  }
  if (actor.id !== PROTECTED_USER_ID) {
    const actorLevel = ROLE_HIERARCHY[actor.role] || 0;
    const targetCurrentLevel = ROLE_HIERARCHY[target.role] || 0;
    const desiredLevel = ROLE_HIERARCHY[role] || 0;
    if (targetCurrentLevel >= actorLevel) {
      throw new Error('INSUFFICIENT_PRIVILEGES');
    }
    if (desiredLevel >= actorLevel) {
      throw new Error('INSUFFICIENT_PRIVILEGES');
    }
  }
  await pool.query(`UPDATE users SET role = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [role, userId]);
}

export async function forceChangeUserPassword({ actor, userId, newPassword }) {
  if (!actor) {
    throw new Error('UNAUTHORIZED');
  }
  if (userId === PROTECTED_USER_ID) {
    throw new Error('PROTECTED_USER');
  }
  if (actor.id === userId) {
    throw new Error('SELF_MODIFICATION');
  }
  const target = await getUserById(userId);
  if (!target) {
    throw new Error('USER_NOT_FOUND');
  }
  if (actor.role !== 'superadmin' && target.role === 'superadmin') {
    throw new Error('INSUFFICIENT_PRIVILEGES');
  }
  const actorLevel = ROLE_HIERARCHY[actor.role] || 0;
  const targetLevel = ROLE_HIERARCHY[target.role] || 0;
  if (targetLevel >= actorLevel) {
    throw new Error('INSUFFICIENT_PRIVILEGES');
  }
  const passwordHash = await bcrypt.hash(newPassword, 12);
  await pool.query(
    `UPDATE users SET password_hash = ?, must_reset_password = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
    [passwordHash, userId]
  );
}

export async function setUserActiveStatus({ actor, userId, isActive }) {
  if (userId === PROTECTED_USER_ID) {
    throw new Error('PROTECTED_USER');
  }
  if (!actor) {
    throw new Error('UNAUTHORIZED');
  }
  const target = await getUserById(userId);
  if (!target) {
    throw new Error('USER_NOT_FOUND');
  }
  if (target.id === actor.id) {
    throw new Error('SELF_MODIFICATION');
  }
  if (actor.role !== 'superadmin' && target.role === 'superadmin') {
    throw new Error('INSUFFICIENT_PRIVILEGES');
  }
  await pool.query(`UPDATE users SET is_active = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [isActive ? 1 : 0, userId]);
}

export async function getManagedUserProfile({ actor, userId }) {
  if (!actor) {
    throw new Error('UNAUTHORIZED');
  }
  const targetId = Number(userId);
  if (Number.isNaN(targetId)) {
    throw new Error('USER_NOT_FOUND');
  }
  const target = await getUserById(targetId);
  if (!target) {
    throw new Error('USER_NOT_FOUND');
  }
  const isProtected = target.id === PROTECTED_USER_ID;
  if (isProtected && actor.id !== PROTECTED_USER_ID) {
    throw new Error('PROTECTED_USER');
  }
  const actorLevel = ROLE_HIERARCHY[actor.role] || 0;
  const targetLevel = ROLE_HIERARCHY[target.role] || 0;
  if (actor.id !== PROTECTED_USER_ID && actor.id !== target.id && targetLevel > actorLevel) {
    throw new Error('INSUFFICIENT_PRIVILEGES');
  }
  const isSuperadminProfile = target.role === 'superadmin';
  const trustedDevices = isSuperadminProfile
    ? []
    : await listTrustedDevicesForUser(target.id, { includeRevoked: true, includeExpired: true });
  const passkeys = isSuperadminProfile ? [] : await listPasskeysForUser(target.id);
  const lastActiveDevice = trustedDevices.find((device) => device.lastUsedAt) || trustedDevices[0] || null;
  return {
    user: {
      id: target.id,
      fullName: target.full_name,
      email: target.email,
      phone: target.phone,
      role: target.role,
      isActive: Boolean(target.is_active),
      mustResetPassword: Boolean(target.must_reset_password),
      createdAt: target.created_at,
      updatedAt: target.updated_at,
      isProtected
    },
    trustedDevices,
    passkeys,
    securitySummary: isSuperadminProfile
      ? null
      : {
          lastKnownIp: lastActiveDevice ? lastActiveDevice.ipAddress : null,
          lastKnownUserAgent: lastActiveDevice ? lastActiveDevice.userAgent : null,
          lastKnownFingerprint: lastActiveDevice ? lastActiveDevice.fingerprint : null,
          lastActivityAt: target.last_seen_at || (lastActiveDevice ? lastActiveDevice.lastUsedAt : null),
          deviceCount: trustedDevices.length
        }
  };
}

export async function clearUserSecurityData({ actor, userId }) {
  if (!actor) {
    throw new Error('UNAUTHORIZED');
  }
  const targetId = Number(userId);
  if (Number.isNaN(targetId)) {
    throw new Error('USER_NOT_FOUND');
  }
  const target = await getUserById(targetId);
  if (!target) {
    throw new Error('USER_NOT_FOUND');
  }
  if (targetId === PROTECTED_USER_ID && actor.id !== PROTECTED_USER_ID) {
    throw new Error('PROTECTED_USER');
  }
  if (actor.role !== 'superadmin') {
    throw new Error('INSUFFICIENT_PRIVILEGES');
  }
  if (actor.id === targetId) {
    throw new Error('SELF_MODIFICATION');
  }
  const actorLevel = ROLE_HIERARCHY[actor.role] || 0;
  const targetLevel = ROLE_HIERARCHY[target.role] || 0;
  if (actor.id !== PROTECTED_USER_ID && targetLevel > actorLevel) {
    throw new Error('INSUFFICIENT_PRIVILEGES');
  }
  await clearTrustedDevicesForUser(targetId);
  await pool.query(`UPDATE users SET last_seen_at = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, [targetId]);
}

export async function updateManagedUserDetails({
  actor,
  userId,
  fullName,
  email,
  phone,
  role,
  mustResetPassword,
  isActive
}) {
  if (!actor) {
    throw new Error('UNAUTHORIZED');
  }
  const targetId = Number(userId);
  if (Number.isNaN(targetId)) {
    throw new Error('USER_NOT_FOUND');
  }
  if (targetId === PROTECTED_USER_ID && actor.id !== PROTECTED_USER_ID) {
    throw new Error('PROTECTED_USER');
  }
  if (actor.id === targetId) {
    throw new Error('SELF_MODIFICATION');
  }
  const target = await getUserById(targetId);
  if (!target) {
    throw new Error('USER_NOT_FOUND');
  }
  const allowedRoles = ['client', 'redactor', 'admin', 'superadmin'];
  if (!allowedRoles.includes(role)) {
    throw new Error('INVALID_ROLE');
  }
  const normalizedEmail = email.toLowerCase();
  const existing = await findUserByEmail(normalizedEmail);
  if (existing && existing.id !== targetId) {
    throw new Error('EMAIL_EXISTS');
  }
  const actorLevel = ROLE_HIERARCHY[actor.role] || 0;
  const targetLevel = ROLE_HIERARCHY[target.role] || 0;
  const desiredLevel = ROLE_HIERARCHY[role] || 0;
  const canManageTarget =
    actor.id === PROTECTED_USER_ID || (actor.role === 'superadmin' ? targetLevel <= actorLevel : targetLevel < actorLevel);
  const canAssignRole =
    actor.id === PROTECTED_USER_ID || (actor.role === 'superadmin' ? desiredLevel <= actorLevel : desiredLevel < actorLevel);
  if (!canManageTarget || !canAssignRole) {
    throw new Error('INSUFFICIENT_PRIVILEGES');
  }
  const nextStatus = typeof isActive === 'boolean' ? (isActive ? 1 : 0) : target.is_active;
  const nextMustReset =
    typeof mustResetPassword === 'boolean' ? (mustResetPassword ? 1 : 0) : target.must_reset_password;
  await pool.query(
    `UPDATE users
     SET full_name = ?,
         email = ?,
         phone = ?,
         role = ?,
         must_reset_password = ?,
         is_active = ?,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
    [fullName, normalizedEmail, phone || null, role, nextMustReset, nextStatus, targetId]
  );
  return true;
}
