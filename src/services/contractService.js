import pool from '../config/db.js';
import { encryptObject, decryptObject } from '../utils/encryption.js';
import { nanoid } from 'nanoid';

const CONTRACT_DOWNLOAD_TTL_MS = 10 * 60 * 1000;
const contractDownloadTokens = new Map();

function purgeExpiredTokens() {
  const now = Date.now();
  for (const [token, entry] of contractDownloadTokens.entries()) {
    if (entry.expiresAt <= now) {
      contractDownloadTokens.delete(token);
    }
  }
}

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
  const priceLabel = offer?.offer_amount
    ? `${Number(offer.offer_amount).toFixed(2)} RON`
    : 'valoarea se stabilește conform ofertei';
  const beneficiaryName = escapeHtml(clientData.fullName || offer?.client_name || '');
  const beneficiaryAddress = escapeHtml(clientData.address || '');
  const beneficiaryId = `${escapeHtml(clientData.idType || '')} ${escapeHtml(clientData.idSeries || '')} ${escapeHtml(
    clientData.idNumber || ''
  )}`.trim();
  const program = escapeHtml(offer?.program || 'programul comunicat');
  const topic = escapeHtml(offer?.topic || 'tema stabilita de parti');

  const beneficiaryNameDisplay = beneficiaryName || '______________________';
  const beneficiaryAddressDisplay = beneficiaryAddress || '______________________';
  const beneficiaryIdDisplay = beneficiaryId || '______________________';
  const programLabel = program || 'programul stabilit de părți';
  const topicLabel = topic || 'tema comunicată de beneficiar';
  const contractStartLabel = today;
  const contractEndLabel = deliveryDate || 'data stabilită de comun acord';
  const finalSigningDate = contractDate ? formatDate(contractDate) : today;

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
        <h2>I. Părțile contractante</h2>
        <ol>
          <li><strong>Furnizor</strong>: S.C. FREELANCE WRITTERS S.R.L., cu sediul aflat pe bd. Pipera, nr. 1/I, construcția C2, et. 7, biroul nr. 10, compartiment 12, Voluntari, județul Ilfov, nr. Reg. Comerțului: J23/4460/2023, Cod Identificare Fiscală: RO48455074, IBAN: RO75 BACX 0000 0023 1716 3000, UNICREDIT BANK.</li>
          <li><strong>Beneficiar</strong>: ${beneficiaryNameDisplay}, domiciliat la ${beneficiaryAddressDisplay}, identificat cu ${beneficiaryIdDisplay}.</li>
        </ol>
        <h2>II. Obiectul contractului</h2>
        <p><strong>2.1.</strong> Furnizorul se obligă să asigure beneficiarului, servicii de consultanță și management de specialitate.</p>
        <p><strong>2.2.</strong> Furnizorul cesionează pe întreaga durată de protecție legală către beneficiar drepturile patrimoniale de autor privind operele de creație, în orice teritoriu, potrivit art. 28 din Legea nr. 8/1996. În urma cesiunii, beneficiarul va avea următoarele drepturi: dreptul de a reproduce integral sau parțial, direct ori indirect, temporar sau permanent, prin orice mijloace și sub orice formă conținuturile; dreptul de a distribui conținuturile; dreptul de a importa sau a exporta în vederea comercializării a copiilor realizate după conținuturi; dreptul de a închiria conținuturile; dreptul de a împrumuta conținuturile; dreptul de a comunica public direct sau indirect, opera, prin orice mijloace, inclusiv prin punerea scrierilor publicistice la dispoziția publicului, astfel încât să poată fi accesate în orice loc și în orice moment ales, în mod individual, de către public (Internet, inclusiv poștă electronică, TV, rețele de telefonie mobilă, precum și orice alt mijloc pe care beneficiarul îl va considera de cuviință); dreptul de a radiodifuza conținuturile; dreptul de a retransmite prin cablu conținuturile; dreptul de a realiza opere derivate.</p>
        <p><strong>2.3.</strong> Caracterul exclusiv al cesiunii rezultă din: transferul integral al drepturilor patrimoniale, pe durata completă de protecție legală, pe orice teritoriu și în toate formele de exploatare. Acest tip de cesiune este exclusivă, ceea ce înseamnă că doar beneficiarul are dreptul să utilizeze operele respective, iar furnizorul nu mai poate exercita aceste drepturi, nici personal, nici prin cesiuni către terți.</p>
        <p class="mt-3"><em>Detalii proiect:</em> Program – ${programLabel}; Tema – ${topicLabel}.</p>
        <h2>III. Prețul și modalități de plată</h2>
        <p><strong>3.1.</strong> Beneficiarul se obligă să plătească furnizorului prețul de ${priceLabel}.</p>
        <p><strong>3.2.</strong> Pentru serviciile prestate, Furnizorul este îndreptățită la perceperea comisionului cu titlul de preț pentru exercitarea mandatului său prin prestarea serviciilor sale. În măsura în care beneficiarul a primit un fișier atașat în conformitate cu comanda plasată pe site, se va considera că serviciul pe care s-a obligat să îl presteze a fost îndeplinit și acceptat de beneficiar. Fișierele atașate pentru descărcare oferite beneficiarului nu pot fi retrase o dată ce au fost trimise, iar în măsura în care sunt funcționale se va considera că Furnizorul și-a îndeplinit toate obligațiile față de beneficiar.</p>
        <p><strong>3.3.</strong> La semnarea prezentului contract, Beneficiarul se angajează să achite suma negociată pentru prestarea serviciilor prevăzute de acest contract. Plata se va face prin transfer bancar, iar dovada plății va fi trimisă Furnizorului în cel mai scurt timp posibil.</p>
        <p><strong>3.4.</strong> În ziua confirmării plății, Furnizorul se va obliga să transmită Beneficiarului propunerea de cuprins pentru documentul solicitat.</p>
        <p><strong>3.5.</strong> După finalizarea documentului, acesta va fi livrat Beneficiarului în format PDF.</p>
        <p><strong>3.6.</strong> Beneficiarul va semna un acord prin care confirmă că este mulțumit de documentul livrat.</p>
        <p><strong>3.7.</strong> În cazul în care Beneficiarul nu este mulțumit de documentul livrat, acesta va formula modificările necesare, iar Furnizorul va efectua modificările și va livra versiunea actualizată a documentului.</p>
        <p><strong>3.8.</strong> După semnarea acordului, Furnizorul va livra documentul final în format .docx.</p>
        <p><strong>3.9.</strong> După livrarea documentului complet (în format PDF și .docx), părțile vor semna un proces-verbal de predare-primire, confirmând astfel livrarea documentului în conformitate cu termenii contractului.</p>
        <h2>IV. Durata contractului</h2>
        <p><strong>4.1.</strong> Valabilitatea contractului este de la ${contractStartLabel} până la ${contractEndLabel}.</p>
        <p><strong>4.2.</strong> Livrarea documentației va fi însoțită de raportul antiplagiat.</p>
        <h2>V. Obligațiile părților</h2>
        <h3>5.1. Obligațiile Furnizorului</h3>
        <ol>
          <li>Să asigure beneficiarului, consultații de specialitate la un standard de performanță ridicat și să livreze conținutul achitat în format editabil.</li>
          <li>Să respecte instrucțiunile date de beneficiar în ceea ce privește urmărirea obiectivelor stabilite.</li>
          <li>Să nu se angajeze sau să nu negocieze în scopul de a se angaja într-o activitate, cu deosebire de consultanță, în conflict cu interesele beneficiarului.</li>
          <li>Să predea lucrarea/lucrările convenită(e) la timp și în bune condiții, pentru confirmarea din partea beneficiarului, folosind materialul bibliografic și materialele auxiliare puse la dispoziție de către beneficiar.</li>
          <li>Să facă dovada prin documente autentice a verificărilor antiplagiat.</li>
          <li>Să întocmească modificări gratuite si nelimitate ca și număr, în cadrul lucrării, pe tot parcursul perioadei de redactare, la solicitarea beneficiarului.</li>
          <li>Să întocmească modificări gratuite și nelimitate ca și număr, în cadrul lucrării, la cererea beneficiarului, după perioada încheierii prezentului contract, dacă beneficiarul va solicita întocmirea modificărilor.</li>
          <li>Să trimită beneficiarului eventualele modificări solicitate de acesta, în una sau maxim două zile calendaristice de la data când beneficiarul a solicitat modificările.</li>
          <li>Din momentul notificării cu privire la încheierea tranzacției prin plata avansată de către beneficiar, furnizorul are obligația de a stabili împreună cu beneficiarul detaliile de execuție, să înștiințeze beneficiarul asupra termenului de livrare și începe procesul de documentare și redactare propriu zisă a comenzii.</li>
          <li>În situația în care consultatul nu livrează proiectul la termenul menționat, se obligă să restituie suma plătită de beneficiar.</li>
        </ol>
        <h3>5.2. Obligațiile Beneficiarului</h3>
        <ol>
          <li>Să pună la dispoziția furnizorului datele, informațiile și documentele necesare îndeplinirii obligațiilor asumate de acesta.</li>
          <li>Să plătească remunerația stabilită, în condițiile și la termenele stabilite prin prezentul contract.</li>
        </ol>
        <h2>VI. Forța majoră</h2>
        <p><strong>6.1.</strong> Niciuna dintre părțile contractante nu răspunde de neexecutarea la termen sau/și de executarea în mod necorespunzător - total sau parțial - a oricărei obligații care îi revine în baza prezentului contract, dacă neexecutarea sau/și executarea necorespunzătoare a obligației respective a fost cauzată de forța majoră, așa cum este definită de lege.</p>
        <p><strong>6.2.</strong> Partea care invocă forța majoră este obligată să notifice celeilalte părți, în termen de 15 zile, producerea evenimentului și să ia toate măsurile posibile în vederea limitării consecințelor lui.</p>
        <p><strong>6.3.</strong> Dacă în termen de 15 zile de la producere, evenimentul respectiv nu încetează, părțile au dreptul să-și notifice încetarea de plin drept a prezentului contract, fără ca vreuna dintre ele să pretindă daune-interese.</p>
        <h2>VII. Notificări</h2>
        <p><strong>7.1.</strong> În accepțiunea părților contractante, orice notificare adresată de una dintre acestea celeilalte este valabil îndeplinită dacă va fi transmisă la adresa/sediul prevăzut în partea introductivă a prezentului contract.</p>
        <p><strong>7.2.</strong> În cazul în care notificare se face pe cale poștală, ea va fi transmisă prin scrisoare recomandată, cu confirmare de primire (A.R.) și se consideră primită de destinatar la data menționată de oficiul poștal primitor pe această confirmare.</p>
        <p><strong>7.3.</strong> Dacă confirmarea se trimite prin telex sau telefax, ea se consideră primită în prima zi lucrătoare după cea în care a fost expediată.</p>
        <p><strong>7.4.</strong> Notificările verbale nu se iau în considerare de niciuna dintre părți, dacă nu sunt confirmate, prin intermediul uneia dintre modalitățile prevăzute la alineatele precedente.</p>
        <h2>VIII. Litigii</h2>
        <p><strong>8.1.</strong> Părțile au convenit ca toate neînțelegerile privind validitatea prezentului contract sau rezultate din interpretarea, executarea sau încetarea acestuia să fie rezolvate, pe cale amiabilă de reprezentanții lor.</p>
        <p><strong>8.2.</strong> În cazul în care nu este posibilă rezolvarea litigiilor pe cale amiabilă părțile se vor adresa instanțelor judecătorești competente.</p>
        <h2>IX. Clauza de confidențialitate</h2>
        <p><strong>9.1.</strong> Părțile se obligă să păstreze confidențialitatea datelor, informațiilor și documentelor pe care le vor deține ca urmare a executării clauzelor prezentului contract.</p>
        <h2>X. Încetarea contractului</h2>
        <p><strong>10.1.</strong> Prezentul contract de consultanță încetează în următoarele situații:</p>
        <ol>
          <li>La expirarea duratei / împlinirea termenului pentru care a fost încheiat.</li>
          <li>În urma notificării scrise a uneia dintre părți.</li>
          <li>Furnizorul sau beneficiarul nu-și respectă una dintre obligațiile pe care și le-a asumat prin prezentul contract.</li>
        </ol>
        <p><strong>10.2.</strong> Partea care invocă o clauză de încetare a prevederilor prezentului contract o va notifica celeilalte părți, cu cel puțin 15 zile înainte de data la care încetarea urmează să-și producă efectele.</p>
        <h2>XI. Clauze finale</h2>
        <p><strong>11.1.</strong> Modificarea prezentului contract se face numai prin act adițional încheiat între părțile contractante.</p>
        <p><strong>11.2.</strong> Prezentul contract a fost încheiat într-un număr de 2 exemplare, astăzi ${finalSigningDate}.</p>
      </article>
      <footer class="contract-document__signatures">
        <div class="signature-block">
          <p><strong>Furnizor</strong></p>
          <div class="signature-box">${adminSignatureHtml}</div>
          <p class="signature-name">S.C. FREELANCE WRITTERS S.R.L.</p>
        </div>
        <div class="signature-block">
          <p><strong>Beneficiar</strong></p>
          <div class="signature-box">${clientSignatureHtml}</div>
          <p class="signature-name">${beneficiaryNameDisplay}</p>
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

export function createContractDownloadToken({ ticketId, userId }) {
  purgeExpiredTokens();
  const token = nanoid(48);
  const expiresAt = Date.now() + CONTRACT_DOWNLOAD_TTL_MS;
  contractDownloadTokens.set(token, { ticketId, userId, expiresAt });
  return { token, expiresAt };
}

export function consumeContractDownloadToken({ token, ticketId, userId }) {
  purgeExpiredTokens();
  const entry = contractDownloadTokens.get(token);
  if (!entry) {
    return null;
  }
  contractDownloadTokens.delete(token);
  if (entry.ticketId !== ticketId || entry.userId !== userId) {
    return null;
  }
  if (entry.expiresAt <= Date.now()) {
    return null;
  }
  return entry;
}

