import pool from '../config/db.js';
import { nanoid } from 'nanoid';

export const MIN_OFFER_EXPIRATION_HOURS = 12;
export const DEFAULT_OFFER_EXPIRATION_HOURS = 24;

export async function createOfferRequest({
  clientName,
  userId,
  email,
  phone,
  program,
  topic,
  deliveryDate,
  notes,
  ticketId
}) {
  const offerCode = nanoid(10).toUpperCase();
  const [result] = await pool.query(
    `INSERT INTO offers (offer_code, client_name, user_id, email, phone, program, topic, delivery_date, offer_amount, notes, contract_text, status, ticket_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, '', 'pending', ?)`,
    [
      offerCode,
      clientName,
      userId,
      email,
      phone,
      program,
      topic,
      deliveryDate,
      notes || null,
      ticketId
    ]
  );
  return { id: result.insertId, offerCode };
}

export async function getOfferById(id) {
  const [rows] = await pool.query('SELECT * FROM offers WHERE id = ?', [id]);
  const offer = rows[0] || null;
  if (!offer) return null;
  await enforceOfferDeadlines(offer);
  return getOfferByIdWithoutChecks(id);
}

async function getOfferByIdWithoutChecks(id) {
  const [rows] = await pool.query('SELECT * FROM offers WHERE id = ?', [id]);
  return rows[0] || null;
}

export async function getOfferByTicketId(ticketId) {
  const [rows] = await pool.query('SELECT * FROM offers WHERE ticket_id = ?', [ticketId]);
  const offer = rows[0] || null;
  if (!offer) return null;
  await enforceOfferDeadlines(offer);
  return getOfferByIdWithoutChecks(offer.id);
}

export async function getOfferByCode(code) {
  const [rows] = await pool.query('SELECT * FROM offers WHERE offer_code = ?', [code]);
  const offer = rows[0] || null;
  if (!offer) return null;
  await enforceOfferDeadlines(offer);
  return getOfferByIdWithoutChecks(offer.id);
}

export function generateContractTemplate({
  clientName,
  program,
  topic,
  deliveryDate,
  price
}) {
  const today = new Date().toISOString().split('T')[0];
  const valueText = price ? `${price} EUR` : 'valoarea va fi stabilita conform ofertei transmise';
  return `CONTRACT DE PRESTARI SERVICII\n\nIncheiat astazi ${today} intre:\n\n1. Licente la Cheie Consulting SRL, cu sediul in Bucuresti, denumit in continuare "Prestator";\n2. ${clientName}, inscris la programul ${program}, denumit in continuare "Beneficiar".\n\nArt.1 Obiectul contractului\nPrestatorul se obliga sa redacteze si sa ofere consultanta pentru lucrarea de licenta cu tema "${topic}".\n\nArt.2 Durata contractului\nLucrarea se va livra pana la data de ${deliveryDate}.\n\nArt.3 Pretul si modalitatea de plata\nValoarea serviciilor este de ${valueText}.\n\nArt.4 Confidentialitate\nPrestatorul garanteaza confidentialitatea tuturor informatiilor furnizate de Beneficiar.\n\nArt.5 Drepturile si obligatiile partilor\nPrestatorul va furniza materiale originale, iar Beneficiarul va oferi informatiile necesare la timp.\n\nArt.6 Semnatura partilor\nPrestator: ______________________\nBeneficiar: ______________________\n\nContractul poate fi semnat electronic prin platforma licentelacheie.ro.`;
}

export async function attachOfferDetails(offerId, { amount, expiresInHours, notes, program, topic, deliveryDate, clientName }) {
  const offer = await getOfferById(offerId);
  if (!offer) {
    throw new Error('OFFER_NOT_FOUND');
  }
  if (offer.offer_amount !== null) {
    throw new Error('OFFER_LOCKED');
  }
  const hours = Math.max(Number(expiresInHours || DEFAULT_OFFER_EXPIRATION_HOURS), MIN_OFFER_EXPIRATION_HOURS);
  const expiresAt = new Date(Date.now() + hours * 60 * 60 * 1000);
  const contractText = generateContractTemplate({ clientName, program, topic, deliveryDate, price: amount });
  await pool.query(
    `UPDATE offers
       SET offer_amount = ?, status = 'sent', expires_at = ?, notes = ?, contract_text = ?, counter_amount = NULL,
           counter_expires_at = NULL, decision_at = NULL, last_notified_at = NULL
     WHERE id = ?`,
    [amount, expiresAt, notes || null, contractText, offerId]
  );
  return getOfferById(offerId);
}

export async function acceptOffer(offerId) {
  await pool.query(
    `UPDATE offers SET status = 'accepted', decision_at = CURRENT_TIMESTAMP WHERE id = ?`,
    [offerId]
  );
  return getOfferById(offerId);
}

export async function refuseOffer(offerId) {
  await pool.query(
    `UPDATE offers SET status = 'refused', decision_at = CURRENT_TIMESTAMP, counter_amount = NULL, counter_expires_at = NULL WHERE id = ?`,
    [offerId]
  );
  return getOfferById(offerId);
}

export async function requestCounterOffer(offerId) {
  const expiresAt = new Date(Date.now() + 30 * 60 * 1000);
  await pool.query(
    `UPDATE offers SET status = 'counter_pending', counter_expires_at = ?, counter_amount = NULL, decision_at = NULL WHERE id = ?`,
    [expiresAt, offerId]
  );
  return getOfferById(offerId);
}

export async function submitCounterOffer(offerId, amount) {
  const offer = await getOfferById(offerId);
  if (!offer || offer.status !== 'counter_pending') {
    throw new Error('INVALID_STATE');
  }
  if (!offer.offer_amount) {
    throw new Error('MISSING_BASE_AMOUNT');
  }
  const minimum = Number(offer.offer_amount) * 0.85;
  if (amount < minimum) {
    throw new Error('COUNTER_TOO_LOW');
  }
  await pool.query(
    `UPDATE offers SET status = 'counter_submitted', counter_amount = ?, counter_expires_at = NULL, decision_at = CURRENT_TIMESTAMP WHERE id = ?`,
    [amount, offerId]
  );
  return getOfferById(offerId);
}

export async function acceptCounterOffer(offerId) {
  const offer = await getOfferById(offerId);
  if (!offer || offer.status !== 'counter_submitted') {
    throw new Error('INVALID_STATE');
  }
  const finalAmount = Number(offer.counter_amount || offer.offer_amount || 0);
  if (!finalAmount) {
    throw new Error('MISSING_BASE_AMOUNT');
  }
  const contractText = generateContractTemplate({
    clientName: offer.client_name,
    program: offer.program,
    topic: offer.topic,
    deliveryDate: offer.delivery_date,
    price: finalAmount
  });
  await pool.query(
    `UPDATE offers
       SET status = 'accepted', offer_amount = ?, contract_text = ?, decision_at = CURRENT_TIMESTAMP,
           counter_expires_at = NULL
     WHERE id = ?`,
    [finalAmount, contractText, offerId]
  );
  return getOfferById(offerId);
}

export async function declineCounterOffer(offerId) {
  const offer = await getOfferById(offerId);
  if (!offer || offer.status !== 'counter_submitted') {
    throw new Error('INVALID_STATE');
  }
  await pool.query(
    `UPDATE offers SET status = 'refused', counter_amount = NULL, counter_expires_at = NULL, decision_at = CURRENT_TIMESTAMP WHERE id = ?`,
    [offerId]
  );
  return getOfferById(offerId);
}

export async function listOffersForUser(user) {
  if (user.role === 'client') {
    const [rows] = await pool.query(
      `SELECT o.*, t.status AS ticket_status
       FROM offers o
       LEFT JOIN tickets t ON t.id = o.ticket_id
       WHERE o.user_id = ?
       ORDER BY o.created_at DESC`,
      [user.id]
    );
    return rows;
  }

  if (user.role === 'admin') {
    const [rows] = await pool.query(
      `SELECT o.*, t.status AS ticket_status, u.full_name AS client_name_full
       FROM offers o
       LEFT JOIN tickets t ON t.id = o.ticket_id
       LEFT JOIN users u ON u.id = o.user_id
       LEFT JOIN projects p ON p.id = t.project_id
       WHERE (p.assigned_admin_id = ? OR p.assigned_admin_id IS NULL)
       ORDER BY o.created_at DESC`,
      [user.id]
    );
    return rows;
  }

  const [rows] = await pool.query(
    `SELECT o.*, t.status AS ticket_status, u.full_name AS client_name_full
     FROM offers o
     LEFT JOIN tickets t ON t.id = o.ticket_id
     LEFT JOIN users u ON u.id = o.user_id
     ORDER BY o.created_at DESC`
  );
  return rows;
}

export async function listPendingOffersForAdmin(adminId) {
  if (!adminId) {
    const [rows] = await pool.query(
      `SELECT o.*, u.full_name AS client_name_full
       FROM offers o
       LEFT JOIN users u ON u.id = o.user_id
       WHERE o.status IN ('pending', 'counter_submitted')
       ORDER BY o.created_at DESC`
    );
    return rows;
  }

  const [rows] = await pool.query(
    `SELECT o.*, u.full_name AS client_name_full
     FROM offers o
     LEFT JOIN tickets t ON t.id = o.ticket_id
     LEFT JOIN projects p ON p.id = t.project_id
     LEFT JOIN users u ON u.id = o.user_id
     WHERE o.status IN ('pending', 'counter_submitted')
       AND (p.assigned_admin_id = ? OR p.assigned_admin_id IS NULL)
     ORDER BY o.created_at DESC`,
    [adminId]
  );
  return rows;
}

export async function listExpiringOffers(hours = 24) {
  const [rows] = await pool.query(
    `SELECT * FROM offers WHERE status = 'sent' AND expires_at <= DATE_ADD(NOW(), INTERVAL ? HOUR)`,
    [hours]
  );
  return rows;
}

async function enforceOfferDeadlines(offer) {
  const now = new Date();
  if (offer.status === 'sent' && offer.expires_at && new Date(offer.expires_at) <= now) {
    await pool.query(
      `UPDATE offers SET status = 'expired', decision_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'sent'`,
      [offer.id]
    );
  }
  if (offer.status === 'counter_pending' && offer.counter_expires_at && new Date(offer.counter_expires_at) <= now) {
    await pool.query(
      `UPDATE offers SET status = 'refused', decision_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'counter_pending'`,
      [offer.id]
    );
  }
}
