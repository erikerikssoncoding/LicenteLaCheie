import pool from '../config/db.js';
import { nanoid } from 'nanoid';

export async function createOffer({
  clientName,
  email,
  phone,
  program,
  topic,
  deliveryDate,
  price,
  notes,
  contractText
}) {
  const offerCode = nanoid(10).toUpperCase();
  const [result] = await pool.query(
    `INSERT INTO offers (offer_code, client_name, email, phone, program, topic, delivery_date, price, notes, contract_text)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [offerCode, clientName, email, phone, program, topic, deliveryDate, price, notes, contractText]
  );
  return { id: result.insertId, offerCode };
}

export async function getOfferByCode(code) {
  const [rows] = await pool.query('SELECT * FROM offers WHERE offer_code = ?', [code]);
  return rows[0] || null;
}

export function generateContractTemplate({
  clientName,
  program,
  topic,
  deliveryDate,
  price
}) {
  const today = new Date().toISOString().split('T')[0];
  return `CONTRACT DE PRESTARI SERVICII\n\nIncheiat astazi ${today} intre:\n\n1. Dtoro Services SRL, cu sediul in Bucuresti, denumit in continuare "Prestator";\n2. ${clientName}, inscris la programul ${program}, denumit in continuare "Beneficiar".\n\nArt.1 Obiectul contractului\nPrestatorul se obliga sa redacteze si sa ofere consultanta pentru lucrarea de licenta cu tema "${topic}".\n\nArt.2 Durata contractului\nLucrarea se va livra pana la data de ${deliveryDate}.\n\nArt.3 Pretul si modalitatea de plata\nValoarea serviciilor este de ${price} EUR si include redactarea, reviziile si asistenta pana la sustinere.\n\nArt.4 Confidentialitate\nPrestatorul garanteaza confidentialitatea tuturor informatiilor furnizate de Beneficiar.\n\nArt.5 Drepturile si obligatiile partilor\nPrestatorul va furniza materiale originale, iar Beneficiarul va oferi informatiile necesare la timp.\n\nArt.6 Semnatura partilor\nPrestator: ______________________\nBeneficiar: ______________________\n\nContractul poate fi semnat electronic prin platforma dtoro.icu.`;
}
