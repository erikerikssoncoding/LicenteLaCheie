import pool from '../config/db.js';

function normalizeRow(row) {
  if (!row) {
    return { paidUntil: null };
  }
  const paidUntil = row.paid_until ? new Date(row.paid_until) : null;
  return { paidUntil };
}

export async function getLicenseStatus() {
  const [rows] = await pool.query('SELECT paid_until FROM license_status WHERE id = 1');
  const row = rows[0] || null;
  return normalizeRow(row);
}

export async function setLicensePaidUntil(paidUntil) {
  await pool.query('INSERT INTO license_status (id, paid_until) VALUES (1, ?) ON DUPLICATE KEY UPDATE paid_until = VALUES(paid_until)', [
    paidUntil
  ]);
  return getLicenseStatus();
}
