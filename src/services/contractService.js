import pool from '../config/db.js';
import { encryptObject, decryptObject } from '../utils/encryption.js';

export async function getContractDetailsByTicket(ticketId) {
  const [rows] = await pool.query(
    `SELECT id, ticket_id, offer_id, user_id, encrypted_payload, iv, auth_tag, updated_at
     FROM contract_signatures
     WHERE ticket_id = ?`,
    [ticketId]
  );
  const record = rows[0];
  if (!record) {
    return null;
  }
  try {
    const payload = decryptObject({
      payload: record.encrypted_payload,
      iv: record.iv,
      authTag: record.auth_tag
    });
    return {
      id: record.id,
      offerId: record.offer_id,
      ticketId: record.ticket_id,
      userId: record.user_id,
      updatedAt: record.updated_at,
      ...payload
    };
  } catch (error) {
    console.error('Nu s-au putut decripta datele contractului:', error);
    return null;
  }
}

export async function saveContractDetails({ ticketId, offerId, userId, data }) {
  const encrypted = encryptObject(data);
  await pool.query(
    `INSERT INTO contract_signatures (ticket_id, offer_id, user_id, encrypted_payload, iv, auth_tag)
     VALUES (?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       user_id = VALUES(user_id),
       encrypted_payload = VALUES(encrypted_payload),
       iv = VALUES(iv),
       auth_tag = VALUES(auth_tag),
       updated_at = CURRENT_TIMESTAMP`,
    [ticketId, offerId, userId, encrypted.payload, encrypted.iv, encrypted.authTag]
  );
}
