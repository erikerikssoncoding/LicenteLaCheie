import pool from '../config/db.js';

export async function createContactRequest({ fullName, email, phone, message, ipAddress }) {
  await pool.query(
    `INSERT INTO contact_messages (full_name, email, phone, ip_address, message)
     VALUES (?, ?, ?, ?, ?)`,
    [fullName, email, phone, ipAddress || null, message]
  );
}

export async function listContactMessages() {
  const [rows] = await pool.query(
    `SELECT * FROM contact_messages ORDER BY created_at DESC`
  );
  return rows;
}
