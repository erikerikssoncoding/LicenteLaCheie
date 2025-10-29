import pool from '../config/db.js';
import { encryptObject, decryptObject } from '../utils/encryption.js';
import { nanoid } from 'nanoid';

function escapeHtml(value) {
  if (value === null || value === undefined) {
    return '';
  }
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatDate(date) {
  if (!date) {
    return '';
  }
  const instance = typeof date === 'string' || typeof date === 'number' ? new Date(date) : date;
  if (Number.isNaN(instance.getTime())) {
    return '';
  }
  return instance.toLocaleDateString('ro-RO');
}

function buildContractDraft({ offer, clientData, contractNumber, contractDate, clientSignature, adminSignature }) {
  const deliveryDate = offer?.delivery_date ? formatDate(offer.delivery_date) : '';
  const today = formatDate(new Date());
  const price = offer?.offer_amount ? `${Number(offer.offer_amount).toFixed(2)} EUR` : 'valoarea se stabileste conform ofertei';
  const beneficiaryName = escapeHtml(clientData.fullName || offer?.client_name || '');
  const beneficiaryAddress = escapeHtml(clientData.address || '');
  const beneficiaryId = `${escapeHtml(clientData.idType || '')} ${escapeHtml(clientData.idSeries || '')} ${escapeHtml(
    clientData.idNumber || ''
  )}`.trim();
  const program = escapeHtml(offer?.program || 'programul comunicat');
  const topic = escapeHtml(offer?.topic || 'tema stabilita de parti');

  const clientSignatureHtml = clientSignature
    ? `<img src="${clientSignature}" alt="Semnatura beneficiar" class="signature-image" />`
    : '<span class="signature-placeholder">______________________</span>';
  const adminSignatureHtml = adminSignature
    ? `<img src="${adminSignature}" alt="Semnatura prestator" class="signature-image" />`
    : '<span class="signature-placeholder">______________________</span>';

  const contractNumberLabel = contractNumber ? escapeHtml(contractNumber) : 'In curs de alocare';
  const contractDateLabel = contractDate ? formatDate(contractDate) : 'In curs de stabilire';

  return `
    <section class="contract-document">
      <header class="contract-document__header">
        <h1>Contract de prestari servicii</h1>
        <p><strong>Numar contract:</strong> ${contractNumberLabel}</p>
        <p><strong>Data contract:</strong> ${contractDateLabel}</p>
      </header>
      <article class="contract-document__body">
        <p>Prezentul contract a fost generat la data de ${today} intre:</p>
        <ol>
          <li>
            <strong>Prestator</strong>: Licente la Cheie Consulting SRL, cu sediul in Bucuresti, reprezentata legal de echipa Licente la Cheie.
          </li>
          <li>
            <strong>Beneficiar</strong>: ${beneficiaryName}, domiciliat la ${beneficiaryAddress}, identificat cu ${beneficiaryId}.
          </li>
        </ol>
        <h2>Articolul 1 – Obiect</h2>
        <p>Prestatorul se obliga sa ofere consultanta si suport complet pentru redactarea lucrarii de licenta la programul ${program}, cu tema "${topic}".</p>
        <h2>Articolul 2 – Durata</h2>
        <p>Serviciile se desfasoara pana la data de ${deliveryDate || 'data stabilita de comun acord'}.</p>
        <h2>Articolul 3 – Pretul si plata</h2>
        <p>Valoarea contractului este de ${price}, plata urmand a se efectua conform instructiunilor comunicate de Prestator.</p>
        <h2>Articolul 4 – Confidentialitate</h2>
        <p>Prestatorul garanteaza confidentialitatea informatiilor furnizate de Beneficiar pe toata durata colaborarii.</p>
        <h2>Articolul 5 – Drepturile si obligatiile partilor</h2>
        <ul>
          <li>Prestatorul livreaza materiale originale si suport personalizat;</li>
          <li>Beneficiarul ofera la timp informatiile necesare realizarii lucrarii;</li>
          <li>Partile convin ca orice modificare se face in scris, cu acordul ambelor parti.</li>
        </ul>
      </article>
      <footer class="contract-document__signatures">
        <div class="signature-block">
          <p><strong>Prestator</strong></p>
          <div class="signature-box">${adminSignatureHtml}</div>
          <p class="signature-name">Licente la Cheie Consulting SRL</p>
        </div>
        <div class="signature-block">
          <p><strong>Beneficiar</strong></p>
          <div class="signature-box">${clientSignatureHtml}</div>
          <p class="signature-name">${beneficiaryName}</p>
        </div>
      </footer>
    </section>
  `.trim();
}

export async function getContractDetailsByTicket(ticketId) {
  const [rows] = await pool.query(
    `SELECT id, ticket_id, offer_id, user_id, contract_stage, contract_draft, client_signature, client_signed_at,
            admin_signature, admin_signed_at, contract_number, contract_date, encrypted_payload, iv, auth_tag, updated_at
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
      contractStage: record.contract_stage,
      contractDraft: record.contract_draft,
      clientSignature: record.client_signature,
      clientSignedAt: record.client_signed_at,
      adminSignature: record.admin_signature,
      adminSignedAt: record.admin_signed_at,
      contractNumber: record.contract_number,
      contractDate: record.contract_date,
      updatedAt: record.updated_at,
      ...payload
    };
  } catch (error) {
    console.error('Nu s-au putut decripta datele contractului:', error);
    return null;
  }
}

export async function saveContractDetails({ ticketId, offerId, userId, data, draft }) {
  const encrypted = encryptObject(data);
  await pool.query(
    `INSERT INTO contract_signatures (ticket_id, offer_id, user_id, contract_stage, contract_draft, encrypted_payload, iv, auth_tag,
                                      client_signature, client_signed_at, admin_signature, admin_signed_at, contract_number, contract_date)
     VALUES (?, ?, ?, 'draft', ?, ?, ?, ?, NULL, NULL, NULL, NULL, NULL, NULL)
     ON DUPLICATE KEY UPDATE
       user_id = VALUES(user_id),
       contract_stage = 'draft',
       contract_draft = VALUES(contract_draft),
       encrypted_payload = VALUES(encrypted_payload),
       iv = VALUES(iv),
       auth_tag = VALUES(auth_tag),
       client_signature = NULL,
       client_signed_at = NULL,
       admin_signature = NULL,
       admin_signed_at = NULL,
       contract_number = NULL,
       contract_date = NULL,
       updated_at = CURRENT_TIMESTAMP`,
    [ticketId, offerId, userId, draft, encrypted.payload, encrypted.iv, encrypted.authTag]
  );
}

export async function generateDraftForContract({ offer, clientData }) {
  return buildContractDraft({ offer, clientData });
}

export async function applyClientSignature({ ticketId, signatureData, offer }) {
  const contract = await getContractDetailsByTicket(ticketId);
  if (!contract) {
    throw new Error('CONTRACT_NOT_FOUND');
  }
  if (contract.contractStage !== 'draft') {
    throw new Error('INVALID_CONTRACT_STAGE');
  }
  const draft = buildContractDraft({
    offer,
    clientData: contract,
    clientSignature: signatureData
  });
  await pool.query(
    `UPDATE contract_signatures
        SET client_signature = ?, client_signed_at = CURRENT_TIMESTAMP,
            contract_stage = 'awaiting_admin', contract_draft = ?
      WHERE ticket_id = ?`,
    [signatureData, draft, ticketId]
  );
  return draft;
}

export async function applyAdminSignature({ ticketId, signatureData, offer }) {
  const contract = await getContractDetailsByTicket(ticketId);
  if (!contract) {
    throw new Error('CONTRACT_NOT_FOUND');
  }
  if (contract.contractStage !== 'awaiting_admin') {
    throw new Error('INVALID_CONTRACT_STAGE');
  }
  const contractNumber = nanoid(6).toUpperCase();
  const signedAt = new Date();
  const draft = buildContractDraft({
    offer,
    clientData: contract,
    clientSignature: contract.clientSignature,
    adminSignature: signatureData,
    contractNumber,
    contractDate: signedAt
  });
  await pool.query(
    `UPDATE contract_signatures
        SET admin_signature = ?, admin_signed_at = ?,
            contract_stage = 'completed', contract_number = ?, contract_date = ?,
            contract_draft = ?
      WHERE ticket_id = ?`,
    [signatureData, signedAt, contractNumber, signedAt, draft, ticketId]
  );
  return { draft, contractNumber, contractDate: signedAt };
}

