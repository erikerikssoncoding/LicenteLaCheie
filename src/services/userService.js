import bcrypt from 'bcryptjs';
import pool from '../config/db.js';

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
    `INSERT INTO users (full_name, email, password_hash, phone, role)
     VALUES (?, ?, ?, ?, 'client')`,
    [fullName, email.toLowerCase(), passwordHash, phone]
  );
  return result.insertId;
}

export async function validatePassword(user, password) {
  if (!user) return false;
  return bcrypt.compare(password, user.password_hash);
}

export async function listEditorsAndAdmins() {
  const [rows] = await pool.query(
    `SELECT id, full_name, email, role
     FROM users
     WHERE role IN ('editor', 'admin', 'superadmin')
     ORDER BY role, full_name`
  );
  return rows;
}

export async function getUserById(id) {
  const [rows] = await pool.query('SELECT * FROM users WHERE id = ?', [id]);
  return rows[0] || null;
}

export async function listClients() {
  const [rows] = await pool.query(
    `SELECT id, full_name, email, phone, created_at
     FROM users WHERE role = 'client' ORDER BY created_at DESC`
  );
  return rows;
}
