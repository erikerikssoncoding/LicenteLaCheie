import pool from '../config/db.js';

export async function createContactRequest({ fullName, email, phone, message }) {
  await pool.query(
    `INSERT INTO contact_messages (full_name, email, phone, message)
     VALUES (?, ?, ?, ?)`,
    [fullName, email, phone, message]
  );
}

export async function listContactMessages() {
  const [rows] = await pool.query(
    `SELECT * FROM contact_messages ORDER BY created_at DESC`
  );
  return rows;
}
