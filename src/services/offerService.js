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
  workType,
  deliveryDate,
  notes,
  ticketId
}) {
  const offerCode = nanoid(10).toUpperCase();
  const [result] = await pool.query(
    `INSERT INTO offers (offer_code, client_name, user_id, email, phone, program, topic, work_type, delivery_date, offer_amount, notes, contract_text, status, ticket_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, '', 'pending', ?)`,
    [
      offerCode,
      clientName,
      userId,
      email,
      phone,
      program,
      topic,
      workType,
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

function formatDate(value) {
  if (!value) {
    return '________';
  }
  const dateInstance = typeof value === 'string' || typeof value === 'number' ? new Date(value) : value;
  if (Number.isNaN(dateInstance.getTime())) {
    return '________';
  }
  return dateInstance.toLocaleDateString('ro-RO');
}

function formatPrice(value) {
  if (value === null || value === undefined || value === '') {
    return '________';
  }
  const numeric = Number(value);
  if (Number.isNaN(numeric)) {
    return String(value);
  }
  return `${numeric.toFixed(2)} RON`;
}

export function generateContractTemplate({
  clientName,
  program,
  topic,
  workType,
  deliveryDate,
  price
}) {
  const today = formatDate(new Date());
  const delivery = formatDate(deliveryDate);
  const amount = formatPrice(price);

  const clientSegments = [];
  if (clientName) {
    clientSegments.push(`Nume: ${clientName}`);
  }
  if (workType) {
    clientSegments.push(`Tip lucrare: ${workType}`);
  }
  if (program) {
    clientSegments.push(`Program: ${program}`);
  }
  if (topic) {
    clientSegments.push(`Tema: ${topic}`);
  }
  const clientDetails = clientSegments.length
    ? clientSegments.join(', ')
    : 'Datele clientului vor fi completate in etapa de semnare';

  const lines = [
    'CONTRACT DE PRESTĂRI SERVICII',
    '',
    'I. PĂRȚILE CONTRACTANTE',
    '1. S.C. FREELANCE WRITTERS S.R.L., cu sediul aflat pe bd. Pipera, nr. 1/I, construcția C2, et. 7, biroul nr. 10, compartiment 12, Voluntari, județul Ilfov, nr. Reg. Comerțului: J23/4460/2023, Cod Identificare Fiscală: RO48455074, IBAN: RO75 BACX 0000 0023 1716 3000, UNICREDIT BANK, în calitate de FURNIZOR',
    `2. ${clientDetails}, în calitate de BENEFICIAR.`,
    '',
    'II. OBIECTUL CONTRACTULUI',
    '2.1. Furnizorul se obligă să asigure beneficiarului, servicii de consultanță și management de specialitate.',
    '2.2. Furnizorul cesionează pe întreaga durată de protecție legală către beneficiar drepturile patrimoniale de autor privind operele de creație, în orice teritoriu, potrivit art. 28 din Legea nr. 8/1996. În urma cesiunii, beneficiarul va avea următoarele drepturi: dreptul de a reproduce integral sau parțial, direct ori indirect, temporar sau permanent, prin orice mijloace și sub orice formă conținuturile; dreptul de a distribui conținuturile; dreptul de a importa sau a exporta în vederea comercializării a copiilor realizate după conținuturi; dreptul de a închiria conținuturile; dreptul de a împrumuta conținuturile; dreptul de a comunica public direct sau indirect, opera, prin orice mijloace, inclusiv prin punerea scrierilor publicistice la dispoziția publicului, astfel încât să poată fi accesate în orice loc și în orice moment ales, în mod individual, de către public (Internet, inclusiv poștă electronică, TV, rețele de telefonie mobilă, precum și orice alt mijloc pe care beneficiarul îl va considera de cuviință); dreptul de a radiodifuza conținuturile; dreptul de a retransmite prin cablu conținuturile; dreptul de a realiza opere derivate.',
    '2.3. Caracterul exclusiv al cesiunii rezultă din: transferul integral al drepturilor patrimoniale, pe durata completă de protecție legală, pe orice teritoriu și în toate formele de exploatare. Acest tip de cesiune este exclusivă, ceea ce înseamnă că doar beneficiarul are dreptul să utilizeze operele respective, iar furnizorul nu mai poate exercita aceste drepturi, nici personal, nici prin cesiuni către terți.',
    '',
    'III. PREȚUL ȘI MODALITĂȚI DE PLATĂ',
    `3.1. Beneficiarul se obligă să plătească furnizorului prețul de ${amount}.`,
    '3.2. Pentru serviciile prestate, Furnizorul este îndreptățită la perceperea comisionului cu titlul de preț pentru exercitarea mandatului său prin prestarea serviciilor sale. În măsura în care beneficiarul a primit un fișier atașat în conformitate cu comanda plasată pe site, se va considera că serviciul pe care s-a obligat să îl presteze a fost îndeplinit și acceptat de beneficiar. Fișierele atașate pentru descărcare oferite beneficiarului nu pot fi retrase o dată ce au fost trimise, iar în măsura în care sunt funcționale se va considera că Furnizorul și-a îndeplinit toate obligațiile față de beneficiar.',
    '3.3. La semnarea prezentului contract, Beneficiarul se angajează să achite suma negociată pentru prestarea serviciilor prevăzute de acest contract. Plata se va face prin transfer bancar, iar dovada plății va fi trimisă Furnizorului în cel mai scurt timp posibil.',
    '3.4. În ziua confirmării plății, Furnizorul se va obliga să transmită Beneficiarului propunerea de cuprins pentru documentul solicitat.',
    '3.5. După finalizarea documentului, acesta va fi livrat Beneficiarului în format PDF.',
    '3.6. Beneficiarul va semna un acord prin care confirmă că este mulțumit de documentul livrat.',
    '3.7. În cazul în care Beneficiarul nu este mulțumit de documentul livrat, acesta va formula modificările necesare, iar Furnizorul va efectua modificările și va livra versiunea actualizată a documentului.',
    '3.8. După semnarea acordului, Furnizorul va livra documentul final în format .docx.',
    '3.9. După livrarea documentului complet (în format PDF și .docx), părțile vor semna un proces-verbal de predare-primire, confirmând astfel livrarea documentului în conformitate cu termenii contractului.',
    '',
    'IV. DURATA CONTRACTULUI',
    `4.1. Valabilitatea contractului este de la ${today} până la ${delivery}.`,
    '4.2. Livrarea documentației va fi însoțită de raportul antiplagiat.',
    '',
    'V. OBLIGAȚIILE PĂRȚILOR',
    '5.1. Furnizorul se obligă:',
    '1. Să asigure beneficiarului, consultații de specialitate la un standard de performanță ridicat și să livreze conținutul achitat în format editabil.',
    '2. Să respecte instrucțiunile date de beneficiar în ceea ce privește urmărirea obiectivelor stabilite.',
    '3. Să nu se angajeze sau să nu negocieze în scopul de a se angaja într-o activitate, cu deosebire de consultanță, în conflict cu interesele beneficiarului.',
    '4. Să predea lucrarea/lucrările convenită(e) la timp și în bune condiții, pentru confirmarea din partea beneficiarului, folosind materialul bibliografic și materialele auxiliare puse la dispoziție de către beneficiar.',
    '5. Să facă dovada prin documente autentice a verificărilor antiplagiat.',
    '6. Să întocmească modificări gratuite si nelimitate ca și număr, în cadrul lucrării, pe tot parcursul perioadei de redactare, la solicitarea beneficiarului.',
    '7. Să întocmească modificări gratuite și nelimitate ca și număr, în cadrul lucrării, la cererea beneficiarului, după perioada încheierii prezentului contract, dacă beneficiarul va solicita întocmirea modificărilor.',
    '8. Să trimită beneficiarului eventualele modificări solicitate de acesta, în una sau maxim două zile calendaristice de la data când beneficiarul a solicitat modificările.',
    '9. Din momentul notificării cu privire la încheierea tranzacției prin plata avansată de către beneficiar, furnizorul are obligația de a stabili împreună cu beneficiarul detaliile de execuție, să înștiințeze beneficiarul asupra termenului de livrare și începe procesul de documentare și redactare propriu zisă a comenzii.',
    '10. În situația în care consultatul nu livrează proiectul la termenul menționat, se obligă să restituie suma plătită de beneficiar.',
    '5.2. Beneficiarul se obligă:',
    '1. Să pună la dispoziția furnizorului datele, informațiile și documentele necesare îndeplinirii obligațiilor asumate de acesta.',
    '2. Să plătească remunerația stabilită, în condițiile și la termenele stabilite prin prezentul contract.',
    '',
    'VI. FORȚA MAJORĂ',
    '6.1. Niciuna dintre părțile contractante nu răspunde de neexecutarea la termen sau/și de executarea în mod necorespunzător - total sau parțial - a oricărei obligații care îi revine în baza prezentului contract, dacă neexecutarea sau/și executarea necorespunzătoare a obligației respective a fost cauzată de forța majoră, așa cum este definită de lege.',
    '6.2. Partea care invocă forța majoră este obligată să notifice celeilalte părți, în termen de 15 zile, producerea evenimentului și să ia toate măsurile posibile în vederea limitării consecințelor lui.',
    '6.3. Dacă în termen de 15 zile de la producere, evenimentul respectiv nu încetează, părțile au dreptul să-și notifice încetarea de plin drept a prezentului contract, fără ca vreuna dintre ele să pretindă daune-interese.',
    '',
    'VII. NOTIFICĂRI',
    '7.1. În accepțiunea părților contractante, orice notificare adresată de una dintre acestea celeilalte este valabil îndeplinită dacă va fi transmisă la adresa/sediul prevăzut în partea introductivă a prezentului contract.',
    '7.2. În cazul în care notificare se face pe cale poștală, ea va fi transmisă prin scrisoare recomandată, cu confirmare de primire (A.R.) și se consideră primită de destinatar la data menționată de oficiul poștal primitor pe această confirmare.',
    '7.3. Dacă confirmarea se trimite prin telex sau telefax, ea se consideră primită în prima zi lucrătoare după cea în care a fost expediată.',
    '7.4. Notificările verbale nu se iau în considerare de niciuna dintre părți, dacă nu sunt confirmate, prin intermediul uneia dintre modalitățile prevăzute la alineatele precedente.',
    '',
    'VIII. LITIGII',
    '8.1. Părțile au convenit ca toate neînțelegerile privind validitatea prezentului contract sau rezultate din interpretarea, executarea sau încetarea acestuia să fie rezolvate, pe cale amiabilă de reprezentanții lor.',
    '8.2. În cazul în care nu este posibilă rezolvarea litigiilor pe cale amiabilă părțile se vor adresa instanțelor judecătorești competente.',
    '',
    'IX. CLAUZA DE CONFIDENȚIALITATE',
    '9.1. Părțile se obligă să păstreze confidențialitatea datelor, informațiilor și documentelor pe care le vor deține ca urmare a executării clauzelor prezentului contract.',
    '',
    'X. ÎNCETAREA CONTRACTULUI',
    '10.1. Prezentul contract de consultanță încetează în următoarele situații:',
    '1. La expirarea duratei / împlinirea termenului pentru care a fost încheiat.',
    '2. În urma notificării scrise a uneia dintre părți.',
    '3. Furnizorul sau beneficiarul nu-și respectă una dintre obligațiile pe care și le-a asumat prin prezentul contract.',
    '10.2. Partea care invocă o clauză de încetare a prevederilor prezentului contract o va notifica celeilalte părți, cu cel puțin 15 zile înainte de data la care încetarea urmează să-și producă efectele.',
    '',
    'XI. CLAUZE FINALE',
    '11.1. Modificarea prezentului contract se face numai prin act adițional încheiat între părțile contractante.',
    `11.2. Prezentul contract a fost încheiat într-un număr de 2 exemplare, astăzi ${today}.`,
  ];
  return lines.join('\n');
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
  const contractText = generateContractTemplate({
    clientName,
    program,
    topic,
    workType: offer.work_type,
    deliveryDate,
    price: amount
  });
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
    workType: offer.work_type,
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

export async function updateOfferContractText(offerId, contractText) {
  await pool.query(`UPDATE offers SET contract_text = ? WHERE id = ?`, [contractText, offerId]);
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
      `SELECT o.*, t.status AS ticket_status, t.display_code AS ticket_display_code
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
      `SELECT o.*, t.status AS ticket_status, t.display_code AS ticket_display_code, u.full_name AS client_name_full
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
    `SELECT o.*, t.status AS ticket_status, t.display_code AS ticket_display_code, u.full_name AS client_name_full
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
      `SELECT o.*, u.full_name AS client_name_full, t.display_code AS ticket_display_code
       FROM offers o
       LEFT JOIN users u ON u.id = o.user_id
       LEFT JOIN tickets t ON t.id = o.ticket_id
       WHERE o.status IN ('pending', 'counter_submitted')
       ORDER BY o.created_at DESC`
    );
    return rows;
  }

  const [rows] = await pool.query(
    `SELECT o.*, u.full_name AS client_name_full, t.display_code AS ticket_display_code
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
