import net from 'net';
import tls from 'tls';
import os from 'os';
import { promises as fs } from 'fs';
import crypto from 'crypto';
import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import { logMailEvent } from './notificationLogService.js';
import { createOneTimeLoginLink } from './loginLinkService.js';
import { addReply, getTicketByDisplayCode } from './ticketService.js';
import { findUserByEmail } from './userService.js';

const MAIL_HOST = process.env.MAIL_HOST || null;
const MAIL_PORT = Number(process.env.MAIL_PORT || 465);
const MAIL_SECURE = String(process.env.MAIL_SECURE || 'true').toLowerCase() !== 'false';
const MAIL_STARTTLS = String(process.env.MAIL_STARTTLS || 'false').toLowerCase() === 'true';
const MAIL_USER = process.env.MAIL_USER || null;
const MAIL_PASSWORD = process.env.MAIL_PASSWORD || null;
const MAIL_FROM = process.env.MAIL_FROM || null;
const MAIL_NOTIFICATIONS_TO = process.env.MAIL_NOTIFICATIONS_TO || null;
const MAIL_ALLOW_INVALID_CERTS = String(process.env.MAIL_ALLOW_INVALID_CERTS || 'false').toLowerCase() === 'true';
const MAIL_IMAP_HOST = process.env.MAIL_IMAP_HOST || null;
const MAIL_IMAP_PORT = Number(process.env.MAIL_IMAP_PORT || 993);
const MAIL_IMAP_SECURE = String(process.env.MAIL_IMAP_SECURE || 'true').toLowerCase() !== 'false';
const MAIL_IMAP_SENT_FOLDER = process.env.MAIL_IMAP_SENT_FOLDER || 'Sent';
const MAIL_IMAP_INBOX = process.env.MAIL_IMAP_INBOX || 'INBOX';
const MAIL_TICKET_SYNC_INTERVAL_MS = Math.max(60000, Number(process.env.MAIL_TICKET_SYNC_INTERVAL_MS || 300000));

const MAX_EMAIL_RECIPIENTS = 10;
const CLIENT_HOSTNAME = os.hostname();
const PUBLIC_WEB_BASE_URL = process.env.PUBLIC_WEB_BASE_URL || 'https://www.academiadelicente.ro';

let ticketSyncTimer = null;
let ticketSyncInProgress = false;

async function safeLogMailEvent(payload) {
  try {
    await logMailEvent(payload);
  } catch (error) {
    console.error('Nu s-a putut salva logul de notificare email:', error?.message || error);
  }
}

function normalizeAddressList(value) {
  if (!value) {
    return [];
  }
  if (Array.isArray(value)) {
    return value
      .filter(Boolean)
      .map((item) => String(item).trim())
      .filter((item) => item.length > 0)
      .slice(0, MAX_EMAIL_RECIPIENTS);
  }
  return String(value)
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
    .slice(0, MAX_EMAIL_RECIPIENTS);
}

function extractAddress(value) {
  if (!value) {
    return null;
  }
  const match = String(value).match(/<([^>]+)>/u);
  if (match) {
    return match[1].trim();
  }
  return String(value).trim();
}

function encodeHeader(value) {
  if (!value) {
    return '';
  }
  if (/^[\x00-\x7F]+$/u.test(value)) {
    return value;
  }
  const base64Value = Buffer.from(value, 'utf8').toString('base64');
  return `=?UTF-8?B?${base64Value}?=`;
}

function formatDateHeader(date = new Date()) {
  return date.toUTCString();
}

function chunkString(value, size = 76) {
  const chunks = [];
  for (let i = 0; i < value.length; i += size) {
    chunks.push(value.slice(i, i + size));
  }
  return chunks.join('\r\n');
}

function prepareAttachments(attachments = []) {
  return Promise.all(
    attachments.map(async (attachment) => {
      const buffer = attachment.content
        ? Buffer.isBuffer(attachment.content)
          ? attachment.content
          : Buffer.from(attachment.content)
        : await fs.readFile(attachment.path);
      const base64Content = chunkString(buffer.toString('base64'));
      const safeName = attachment.filename || attachment.originalname || 'fisier';
      return {
        filename: safeName.replace(/\r|\n/g, ''),
        contentType: attachment.contentType || attachment.mimetype || 'application/octet-stream',
        content: base64Content
      };
    })
  );
}

function buildMimeMessage({ from, to, subject, text, attachments }) {
  const headers = [
    `From: ${from}`,
    `To: ${Array.isArray(to) ? to.join(', ') : to}`,
    `Subject: ${encodeHeader(subject)}`,
    `Date: ${formatDateHeader()}`,
    'MIME-Version: 1.0'
  ];

  if (attachments.length === 0) {
    headers.push('Content-Type: text/plain; charset="utf-8"', 'Content-Transfer-Encoding: 8bit', '', text || '', '');
    return headers.join('\r\n');
  }

  const boundary = `----=_Licente_${crypto.randomBytes(6).toString('hex')}`;
  headers.push(`Content-Type: multipart/mixed; boundary="${boundary}"`, '');
  const lines = [...headers];
  lines.push(`--${boundary}`);
  lines.push('Content-Type: text/plain; charset="utf-8"');
  lines.push('Content-Transfer-Encoding: 8bit', '', text || '', '');
  attachments.forEach((attachment) => {
    lines.push(`--${boundary}`);
    lines.push(`Content-Type: ${attachment.contentType}; name="${attachment.filename}"`);
    lines.push('Content-Transfer-Encoding: base64');
    lines.push(`Content-Disposition: attachment; filename="${attachment.filename}"`, '', attachment.content, '');
  });
  lines.push(`--${boundary}--`, '');
  return lines.join('\r\n');
}

function buildPublicUrl(pathname = '/') {
  const base = PUBLIC_WEB_BASE_URL.replace(/\/$/, '');
  const safePath = pathname.startsWith('/') ? pathname : `/${pathname}`;
  return `${base}${safePath}`;
}

function dotStuff(value) {
  return value.replace(/(^|\r\n)\./g, '$1..');
}

function extractTicketCodeFromSubject(subject) {
  if (!subject) {
    return null;
  }
  const match = String(subject).match(/\[\s*Ticket\s*#([A-Z0-9]+)\s*\]/iu);
  return match ? match[1].toUpperCase() : null;
}

function normalizeEmail(value) {
  return value ? String(value).trim().toLowerCase() : null;
}

function canUserReplyToTicket(ticket, user) {
  if (!ticket || !user) {
    return false;
  }
  if (user.role === 'client') {
    return ticket.created_by === user.id;
  }
  if (user.role === 'redactor') {
    return ticket.project_id && ticket.assigned_editor_id === user.id;
  }
  if (user.role === 'admin' || user.role === 'superadmin') {
    if (!ticket.project_id) {
      return true;
    }
    return ticket.assigned_admin_id === user.id || ticket.assigned_editor_id === user.id;
  }
  return false;
}

function sanitizeHtmlToText(value) {
  if (!value) {
    return '';
  }
  return value
    .replace(/<\s*br\s*\/?>/giu, '\n')
    .replace(/<\s*\/p\s*>/giu, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function trimQuotedConversation(text) {
  if (!text) {
    return '';
  }
  const patterns = [
    /^On .+ wrote:/imu,
    /^De la:/imu,
    /^From:/imu,
    /^-----Original Message-----/imu
  ];
  const indexes = patterns
    .map((pattern) => text.search(pattern))
    .filter((index) => index >= 0);
  const cutoff = indexes.length ? Math.min(...indexes) : text.length;
  return text.slice(0, cutoff).trim();
}

class SmtpConnection {
  constructor(socket, tlsOptions) {
    this.socket = socket;
    this.tlsOptions = tlsOptions;
    this.pending = [];
    this.buffer = '';
    this.isClosed = false;
    this.backlog = [];
    this.socket.setEncoding('utf8');
    this.handleData = this.handleData.bind(this);
    this.handleError = this.handleError.bind(this);
    this.handleClose = this.handleClose.bind(this);
    this.socket.on('data', this.handleData);
    this.socket.on('error', this.handleError);
    this.socket.on('close', this.handleClose);
  }

  handleData(chunk) {
    this.buffer += chunk;
    this.processBuffer();
  }

  handleError(error) {
    this.rejectPending(error);
  }

  handleClose() {
    if (!this.isClosed) {
      this.rejectPending(new Error('SMTP connection closed unexpectedly'));
    }
  }

  rejectPending(error) {
    while (this.pending.length) {
      const item = this.pending.shift();
      item.reject(error);
    }
  }

  processBuffer() {
    while (true) {
      const newlineIndex = this.buffer.indexOf('\r\n');
      if (newlineIndex === -1) {
        return;
      }
      const line = this.buffer.slice(0, newlineIndex);
      this.buffer = this.buffer.slice(newlineIndex + 2);
      this.consumeLine(line);
    }
  }

  consumeLine(line) {
    if (!this.pending.length) {
      if (line) {
        this.backlog.push(line);
      }
      return;
    }
    const current = this.pending[0];
    current.lines.push(line);
    if (/^\d{3}-/.test(line)) {
      return;
    }
    if (/^\d{3} /.test(line)) {
      const code = Number(line.slice(0, 3));
      this.pending.shift();
      if (!current.expected.includes(code)) {
        current.reject(new Error(`SMTP error ${code}: ${line}`));
      } else {
        current.resolve({ code, lines: current.lines });
      }
    }
  }

  flushBacklog() {
    if (!this.pending.length || !this.backlog.length) {
      return;
    }
    const bufferedLines = [...this.backlog];
    this.backlog = [];
    bufferedLines.forEach((line) => this.consumeLine(line));
  }

  expect(expected) {
    return new Promise((resolve, reject) => {
      this.pending.push({ expected: Array.isArray(expected) ? expected : [expected], resolve, reject, lines: [] });
      this.flushBacklog();
    });
  }

  command(command, expected) {
    const promise = this.expect(expected);
    if (command !== null && command !== undefined) {
      this.socket.write(`${command}\r\n`);
    }
    return promise;
  }

  sendData(payload) {
    const promise = this.expect(250);
    const safePayload = dotStuff(payload.endsWith('\r\n') ? payload : `${payload}\r\n`);
    this.socket.write(`${safePayload}.\r\n`);
    return promise;
  }

  async upgradeToTls(host) {
    return new Promise((resolve, reject) => {
      const oldSocket = this.socket;
      oldSocket.off('data', this.handleData);
      oldSocket.off('error', this.handleError);
      oldSocket.off('close', this.handleClose);
      const tlsSocket = tls.connect({
        socket: oldSocket,
        servername: host,
        rejectUnauthorized: !MAIL_ALLOW_INVALID_CERTS,
        ...this.tlsOptions
      });
      tlsSocket.once('secureConnect', () => {
        this.socket = tlsSocket;
        this.socket.setEncoding('utf8');
        this.socket.on('data', this.handleData);
        this.socket.on('error', this.handleError);
        this.socket.on('close', this.handleClose);
        resolve();
      });
      tlsSocket.once('error', (error) => {
        reject(error);
      });
    });
  }

  close() {
    this.isClosed = true;
    this.socket.end();
  }
}

async function createConnection({ host, port, secure }) {
  return new Promise((resolve, reject) => {
    const onError = (error) => {
      reject(error);
    };
    if (secure) {
      const socket = tls.connect(
        {
          host,
          port,
          servername: host,
          rejectUnauthorized: !MAIL_ALLOW_INVALID_CERTS
        },
        () => {
          socket.off('error', onError);
          resolve(new SmtpConnection(socket));
        }
      );
      socket.once('error', onError);
    } else {
      const socket = net.connect({ host, port }, () => {
        socket.off('error', onError);
        resolve(new SmtpConnection(socket));
      });
      socket.once('error', onError);
    }
  });
}

export function isMailConfigured() {
  return Boolean(MAIL_HOST && MAIL_FROM && MAIL_USER && MAIL_PASSWORD);
}

function isImapConfigured() {
  return Boolean(MAIL_IMAP_HOST && MAIL_USER && MAIL_PASSWORD);
}

async function sendRawMail({ to, subject, text, attachments, eventType = 'generic', context = null }) {
  const recipients = normalizeAddressList(to);
  if (!isMailConfigured()) {
    console.info('Mail service is not configured. Skipping send.');
    await safeLogMailEvent({
      eventType,
      subject,
      recipients,
      status: 'skipped',
      errorMessage: 'MAIL_NOT_CONFIGURED',
      context
    });
    return false;
  }
  if (!recipients.length) {
    await safeLogMailEvent({ eventType, subject, recipients: [], status: 'skipped', errorMessage: 'NO_RECIPIENTS', context });
    return false;
  }
  const preparedAttachments = await prepareAttachments(attachments);
  const mimeMessage = buildMimeMessage({ from: MAIL_FROM, to: recipients, subject, text, attachments: preparedAttachments });
  const senderAddress = extractAddress(MAIL_FROM);
  const connection = await createConnection({ host: MAIL_HOST, port: MAIL_PORT, secure: MAIL_SECURE });
  try {
    await connection.expect(220);
    await connection.command(`EHLO ${CLIENT_HOSTNAME}`, 250);
    if (!MAIL_SECURE && MAIL_STARTTLS) {
      await connection.command('STARTTLS', 220);
      await connection.upgradeToTls(MAIL_HOST);
      await connection.command(`EHLO ${CLIENT_HOSTNAME}`, 250);
    }
    if (MAIL_USER && MAIL_PASSWORD) {
      await connection.command('AUTH LOGIN', 334);
      await connection.command(Buffer.from(MAIL_USER, 'utf8').toString('base64'), 334);
      await connection.command(Buffer.from(MAIL_PASSWORD, 'utf8').toString('base64'), 235);
    }
    await connection.command(`MAIL FROM:<${senderAddress}>`, 250);
    for (const recipient of recipients) {
      await connection.command(`RCPT TO:<${recipient}>`, [250, 251]);
    }
    await connection.command('DATA', 354);
    await connection.sendData(`${mimeMessage}\r\n`);
    await connection.command('QUIT', 221);
    await safeLogMailEvent({ eventType, subject, recipients, status: 'sent', context });

    if (isImapConfigured()) {
      const client = new ImapFlow({
        host: MAIL_IMAP_HOST,
        port: MAIL_IMAP_PORT,
        secure: MAIL_IMAP_SECURE,
        logger: false,
        tls: { rejectUnauthorized: !MAIL_ALLOW_INVALID_CERTS },
        auth: {
          user: MAIL_USER,
          pass: MAIL_PASSWORD
        }
      });
      try {
        await client.connect();
        await client.append(MAIL_IMAP_SENT_FOLDER, mimeMessage);
      } catch (imapError) {
        await safeLogMailEvent({
          eventType,
          subject,
          recipients,
          status: 'sent_but_not_saved',
          errorMessage: imapError?.message || 'UNKNOWN_IMAP_ERROR',
          context
        });
      } finally {
        try {
          await client.logout();
        } catch (logoutError) {
          console.error('Nu s-a putut inchide conexiunea IMAP:', logoutError?.message || logoutError);
        }
      }
    }
    return true;
  } catch (error) {
    await safeLogMailEvent({ eventType, subject, recipients, status: 'error', errorMessage: error.message, context });
    throw error;
  } finally {
    connection.close();
  }
}

function formatMetadata(clientMetadata) {
  if (!clientMetadata) {
    return '';
  }
  const segments = [];
  if (clientMetadata.ipAddress) {
    segments.push(`IP: ${clientMetadata.ipAddress}`);
  }
  if (clientMetadata.userAgent) {
    segments.push(`UA: ${clientMetadata.userAgent}`);
  }
  if (clientMetadata.referer) {
    segments.push(`Referer: ${clientMetadata.referer}`);
  }
  return segments.join('\n');
}

function getAdminNotificationRecipients(additional = []) {
  const adminRecipients = normalizeAddressList(MAIL_NOTIFICATIONS_TO) || [];
  if (!adminRecipients.length && MAIL_FROM) {
    adminRecipients.push(extractAddress(MAIL_FROM));
  }
  const extras = normalizeAddressList(additional);
  const merged = [...adminRecipients, ...extras];
  return [...new Set(merged.filter(Boolean))];
}

export async function sendOfferSubmissionEmails({
  payload,
  submissionEmail,
  attachments,
  clientMetadata,
  ticketId,
  offerCode
}) {
  if (!isMailConfigured()) {
    return;
  }
  const attachmentPayload = (attachments || []).map((file) => ({
    filename: file.originalname,
    contentType: file.mimetype,
    path: file.path
  }));
  const adminRecipients = getAdminNotificationRecipients();
  const adminText = [
    'A sosit o nouă solicitare de ofertă:',
    '',
    `Client: ${payload.clientName}`,
    `Email: ${submissionEmail}`,
    `Telefon: ${payload.phone}`,
    `Program de studii: ${payload.program}`,
    `Tip lucrare: ${payload.workType}`,
    `Tema: ${payload.topic}`,
    `Livrare dorită: ${payload.deliveryDate}`,
    '',
    `Ticket ID: #${ticketId}`,
    `Cod ofertă: ${offerCode}`,
    '',
    `Detalii suplimentare: ${payload.notes || 'nespecificate'}`,
    '',
    formatMetadata(clientMetadata) || 'Metadate indisponibile'
  ]
    .filter(Boolean)
    .join('\n');
  await sendRawMail({
    to: adminRecipients,
    subject: `Solicitare ofertă - ${payload.topic}`,
    text: adminText,
    attachments: attachmentPayload,
    eventType: 'offer_submission_admin',
    context: { ticketId, offerCode }
  });

  if (submissionEmail) {
    const clientText = [
      `Bună, ${payload.clientName}!`,
      '',
      'Am înregistrat solicitarea ta de ofertă și analizăm documentele primite.',
      'În cel mult 24 de ore vei primi în contul tău propunerea financiară și draftul de contract.',
      '',
      `Codul tău de referință este ${offerCode}, iar ticketul asociat are ID-ul #${ticketId}.`,
      '',
      'Îți mulțumim pentru încredere!',
      'Echipa Academia de Licențe'
    ].join('\n');
    await sendRawMail({
      to: submissionEmail,
      subject: 'Confirmare solicitare ofertă Academia de Licențe',
      text: clientText,
      attachments: [],
      eventType: 'offer_submission_client',
      context: { ticketId, offerCode, submissionEmail }
    });
  }
}

export async function sendContactSubmissionEmails({ payload, attachments, clientMetadata, submissionEmail }) {
  if (!isMailConfigured()) {
    return;
  }
  const attachmentPayload = (attachments || []).map((file) => ({
    filename: file.originalname,
    contentType: file.mimetype,
    path: file.path
  }));
  const adminRecipients = getAdminNotificationRecipients();
  const ipInfo = payload.ipAddress || clientMetadata?.ipAddress || 'nedisponibil';
  const adminText = [
    'Ai primit un mesaj nou prin formularul de contact:',
    '',
    `Nume: ${payload.fullName}`,
    `Email: ${payload.email}`,
    `Telefon: ${payload.phone}`,
    `IP sursă: ${ipInfo}`,
    '',
    'Mesaj:',
    payload.message,
    '',
    formatMetadata(clientMetadata) || 'Metadate suplimentare indisponibile'
  ].join('\n');
  await sendRawMail({
    to: adminRecipients,
    subject: `Mesaj nou din formularul de contact - ${payload.fullName}`,
    text: adminText,
    attachments: attachmentPayload,
    eventType: 'contact_submission_admin',
    context: { submissionEmail, ip: ipInfo }
  });

  if (submissionEmail) {
    const clientText = [
      `Bună, ${payload.fullName}!`,
      '',
      'Îți confirmăm că am primit mesajul transmis prin formularul nostru de contact.',
      'Un consultant de la Academia de Licențe îți va răspunde în cel mai scurt timp la datele menționate.',
      '',
      'Dacă ai documente suplimentare, răspunde la acest email pentru a le atașa.',
      '',
      'Îți mulțumim!',
      'Echipa Academia de Licențe'
    ].join('\n');
    await sendRawMail({
      to: submissionEmail,
      subject: 'Confirmare mesaj de contact Academia de Licențe',
      text: clientText,
      attachments: [],
      eventType: 'contact_submission_client',
      context: { submissionEmail }
    });
  }
}

export async function sendRegistrationCredentialsEmail({ fullName, email, password, userId = null }) {
  if (!isMailConfigured() || !email || !password) {
    return;
  }
  const normalizedEmail = String(email).toLowerCase();
  const safeName = fullName ? String(fullName).trim() : 'client';
  const loginLink =
    userId && typeof userId === 'number'
      ? buildPublicUrl(`/autentificare/link/${createOneTimeLoginLink({ userId }).token}`)
      : null;
  const clientText = [
    `Bună, ${safeName}!`,
    '',
    'Ți-am creat contul în Academia de Licențe.',
    'Poți accesa platforma folosind credențialele de mai jos:',
    `Email: ${normalizedEmail}`,
    `Parolă: ${password}`,
    '',
    loginLink ? `Buton de logare rapidă: ${loginLink}` : 'Intră în cont din pagina de autentificare.',
    'Din motive de securitate, te rugăm să schimbi parola după prima autentificare din Setările contului.',
    `Acces rapid la autentificare: ${buildPublicUrl('/autentificare')}`,
    '',
    'Îți mulțumim!',
    'Echipa Academia de Licențe'
  ].join('\n');

  await sendRawMail({
    to: normalizedEmail,
    subject: 'Datele tale de acces în Academia de Licențe',
    text: clientText,
    attachments: [],
    eventType: 'client_registration_credentials',
    context: { email: normalizedEmail, loginLink }
  });
}

export async function sendProjectStatusUpdateEmail({ project, statusInfo, notes = null }) {
  if (!isMailConfigured() || !project?.client_email) {
    return;
  }
  const statusLabel = statusInfo?.label || project.status || 'status proiect';
  const clientMessage = notes || statusInfo?.clientMessage || statusInfo?.description || null;
  const projectLink = buildPublicUrl(`/cont/proiecte/${project.id}`);
  const clientText = [
    `Bună, ${project.client_name || 'client'}!`,
    '',
    `Statusul proiectului tău (${project.project_code || project.title || 'fără titlu'}) este acum: ${statusLabel}.`,
    ...(clientMessage ? ['', clientMessage] : []),
    '',
    `Poți urmări evoluția și documentele aici: ${projectLink}`,
    'Dacă ai nevoie de clarificări, răspunde direct la acest email.',
    '',
    'Îți mulțumim!',
    'Echipa Academia de Licențe'
  ]
    .filter(Boolean)
    .join('\n');

  await sendRawMail({
    to: project.client_email,
    subject: `Actualizare proiect – ${statusLabel}`,
    text: clientText,
    attachments: [],
    eventType: 'project_status_client',
    context: { projectId: project.id, status: project.status, statusLabel }
  });
}

export async function sendOfferReadyEmail({ offer, ticket, client }) {
  if (!isMailConfigured() || !offer || !ticket) {
    return;
  }
  const recipient = client?.email || offer.email;
  if (!recipient) {
    return;
  }
  const amountLabel = offer.offer_amount ? `${Number(offer.offer_amount).toFixed(2)} RON` : 'calcul în curs';
  const expiresLabel = offer.expires_at ? new Date(offer.expires_at).toLocaleString('ro-RO') : null;
  const ticketLink = buildPublicUrl(`/cont/tichete/${ticket.id}`);
  const clientText = [
    `Bună, ${offer.client_name || client?.fullName || client?.full_name || 'client'}!`,
    '',
    'Ți-am pregătit oferta de preț și draftul de contract în contul tău.',
    `Valoare propusă: ${amountLabel}.`,
    expiresLabel ? `Oferta este valabilă până la: ${expiresLabel}.` : null,
    `Referință ticket: #${ticket.display_code}.`,
    '',
    `Vezi detaliile și răspunde direct din cont: ${ticketLink}`,
    'Poți accepta, trimite o contraofertă sau cere clarificări din același loc.',
    '',
    'Îți mulțumim!',
    'Echipa Academia de Licențe'
  ]
    .filter(Boolean)
    .join('\n');

  await sendRawMail({
    to: recipient,
    subject: `Oferta ta este gata – ticket #${ticket.display_code}`,
    text: clientText,
    attachments: [],
    eventType: 'offer_ready_client',
    context: { offerId: offer.id, ticketId: ticket.id }
  });
}

export async function sendContractStageEmail({ ticket, client, stage, contractNumber = null }) {
  if (!isMailConfigured() || !ticket) {
    return;
  }
  const recipient = client?.email || null;
  if (!recipient) {
    return;
  }
  const ticketLink = buildPublicUrl(`/cont/tichete/${ticket.id}#contract-draft`);
  const baseLines = [`Referință ticket: #${ticket.display_code}.`, `Acces rapid: ${ticketLink}`];

  let subject = `Actualizare contract – ticket #${ticket.display_code}`;
  let lead = 'Am actualizat etapa contractului tău.';
  if (stage === 'draft') {
    lead = 'Contractul este pregătit pentru semnare.';
    subject = `Contract de semnat – ticket #${ticket.display_code}`;
  } else if (stage === 'awaiting_admin') {
    lead = 'Am primit semnătura ta. Verificăm și semnăm documentul final.';
  } else if (stage === 'completed') {
    lead = 'Contractul a fost semnat de ambele părți.';
    subject = `Contract semnat – ticket #${ticket.display_code}`;
  }

  const clientText = [
    `Bună, ${client?.fullName || client?.full_name || 'client'}!`,
    '',
    lead,
    contractNumber ? `Număr contract: ${contractNumber}.` : null,
    ...baseLines,
    '',
    'Dacă ai întrebări, răspunde direct la acest email.',
    '',
    'Îți mulțumim!',
    'Echipa Academia de Licențe'
  ]
    .filter(Boolean)
    .join('\n');

  await sendRawMail({
    to: recipient,
    subject,
    text: clientText,
    attachments: [],
    eventType: `contract_stage_${stage || 'update'}`,
    context: { ticketId: ticket.id, stage, contractNumber }
  });
}

export async function sendTestMail({ recipient, actor = null } = {}) {
  if (!isMailConfigured()) {
    throw new Error('MAIL_NOT_CONFIGURED');
  }

  const normalizedRecipient = normalizeAddressList(recipient ? [recipient] : []).shift();
  if (!normalizedRecipient) {
    throw new Error('NO_RECIPIENT');
  }

  const actorName = actor?.fullName || actor?.full_name || 'administrator';
  const actorEmail = actor?.email || null;
  const testMessage = [
    'Salut!',
    '',
    'Acesta este un email de test trimis din panoul de administrare Academia de Licențe.',
    actorEmail ? `Solicitat de: ${actorName} (${actorEmail})` : `Solicitat de: ${actorName}`,
    `Host: ${CLIENT_HOSTNAME}`,
    '',
    'Dacă ai primit acest mesaj, configurarea SMTP din .env este funcțională.'
  ].join('\n');

  await sendRawMail({
    to: normalizedRecipient,
    subject: '[Licente] Test configurare email',
    text: testMessage,
    attachments: [],
    eventType: 'mail_test',
    context: { recipient: normalizedRecipient, actorId: actor?.id || null }
  });
}

function sanitizeEmailList(values = [], exclude = []) {
  const exclusions = new Set(exclude.map((item) => String(item || '').toLowerCase()).filter(Boolean));
  return [...new Set(values.map((item) => String(item || '').toLowerCase()).filter((item) => item && !exclusions.has(item)))];
}

export async function sendTicketCreatedNotification({ ticket, author, clientEmail, adminEmails = [], projectTitle = null }) {
  if (!ticket) {
    return;
  }
  const normalizedClientEmail = clientEmail ? String(clientEmail).toLowerCase() : null;
  const adminRecipients = sanitizeEmailList(getAdminNotificationRecipients(adminEmails), normalizedClientEmail ? [normalizedClientEmail] : []);
  const baseContext = { ticketId: ticket.id, displayCode: ticket.display_code, authorId: author?.id };
  if (adminRecipients.length) {
    const adminText = [
      'A fost deschis un ticket nou.',
      '',
      `Referinta: #${ticket.display_code}`,
      `Subiect: ${ticket.subject}`,
      projectTitle ? `Proiect: ${projectTitle}` : null,
      author?.fullName ? `Client: ${author.fullName} (${author.email || 'email indisponibil'})` : null,
      '',
      'Mesaj initial:',
      ticket.message || 'Mesaj indisponibil'
    ]
      .filter(Boolean)
      .join('\n');

    await sendRawMail({
      to: adminRecipients,
      subject: `[Ticket #${ticket.display_code}] Ticket nou: ${ticket.subject}`,
      text: adminText,
      attachments: [],
      eventType: 'ticket_created_admin',
      context: baseContext
    });
  }

  if (normalizedClientEmail) {
    const clientText = [
      `Bună, ${author?.fullName || 'client'}!`,
      '',
      'Am deschis un ticket nou pentru solicitarea ta.',
      `Referința ta este #${ticket.display_code}. Include acest cod în subiectul emailului pentru a menține firul conversației.`,
      '',
      `Subiect: ${ticket.subject}`,
      '',
      'Mesaj trimis:',
      ticket.message || 'Mesaj indisponibil',
      '',
      'Poți urmări discuția și din contul tău.',
      'Echipa Academia de Licențe'
    ].join('\n');

    await sendRawMail({
      to: normalizedClientEmail,
      subject: `Am deschis ticketul #${ticket.display_code} – ${ticket.subject}`,
      text: clientText,
      attachments: [],
      eventType: 'ticket_created_client',
      context: baseContext
    });
  }
}

export async function sendTicketReplyNotification({
  ticket,
  author,
  message,
  clientEmail,
  adminEmails = [],
  projectTitle = null
}) {
  if (!ticket || !author || !message) {
    return;
  }
  const normalizedClientEmail = clientEmail ? String(clientEmail).toLowerCase() : null;
  const senderEmail = author.email ? String(author.email).toLowerCase() : null;
  const baseContext = { ticketId: ticket.id, displayCode: ticket.display_code, authorId: author.id };

  const adminRecipients = sanitizeEmailList(getAdminNotificationRecipients(adminEmails), [senderEmail, normalizedClientEmail].filter(Boolean));
  const clientRecipients = normalizedClientEmail && senderEmail !== normalizedClientEmail ? [normalizedClientEmail] : [];
  const replySummary = message.length > 500 ? `${message.slice(0, 500)}…` : message;
  const isClientAuthor = author.role === 'client';

  if (adminRecipients.length) {
    const adminText = [
      isClientAuthor ? 'Clientul a trimis un raspuns intr-un ticket.' : 'Echipa a transmis un raspuns intr-un ticket.',
      '',
      `Referinta: #${ticket.display_code}`,
      `Subiect: ${ticket.subject}`,
      projectTitle ? `Proiect: ${projectTitle}` : null,
      author.fullName ? `Autor mesaj: ${author.fullName} (${author.email || 'email indisponibil'})` : null,
      '',
      'Mesaj:',
      replySummary
    ]
      .filter(Boolean)
      .join('\n');

    await sendRawMail({
      to: adminRecipients,
      subject: `[Ticket #${ticket.display_code}] Raspuns nou ${isClientAuthor ? 'de la client' : 'din echipa'}`,
      text: adminText,
      attachments: [],
      eventType: 'ticket_reply_admin',
      context: baseContext
    });
  }

  if (!isClientAuthor && clientRecipients.length) {
    const clientText = [
      `Ai primit un raspuns in ticketul #${ticket.display_code}.`,
      '',
      `Subiect: ${ticket.subject}`,
      '',
      'Mesaj nou:',
      replySummary,
      '',
      'Poti continua conversatia din contul tau sau raspunzand la acest email cu referinta ticketului.',
      'Echipa Academia de Licențe'
    ].join('\n');

    await sendRawMail({
      to: clientRecipients,
      subject: `[Ticket #${ticket.display_code}] Raspuns nou de la echipa`,
      text: clientText,
      attachments: [],
      eventType: 'ticket_reply_client',
      context: baseContext
    });
  }
}

async function extractMessageBodyFromSource(source) {
  if (!source) {
    return '';
  }
  const parsed = await simpleParser(source);
  const plainText = parsed.text?.trim() || sanitizeHtmlToText(parsed.html);
  return trimQuotedConversation(plainText);
}

export async function syncTicketRepliesFromInbox() {
  if (!isImapConfigured()) {
    return { processed: 0, skipped: 0, errors: ['IMAP_NOT_CONFIGURED'] };
  }

  const summary = { processed: 0, skipped: 0, errors: [] };
  const client = new ImapFlow({
    host: MAIL_IMAP_HOST,
    port: MAIL_IMAP_PORT,
    secure: MAIL_IMAP_SECURE,
    logger: false,
    tls: { rejectUnauthorized: !MAIL_ALLOW_INVALID_CERTS },
    auth: {
      user: MAIL_USER,
      pass: MAIL_PASSWORD
    }
  });

  try {
    await client.connect();
    const lock = await client.getMailboxLock(MAIL_IMAP_INBOX);

    try {
      for await (const message of client.fetch({ seen: false }, { envelope: true, uid: true, source: true })) {
        let shouldMarkSeen = false;
        try {
          const subject = message.envelope?.subject || '';
          const ticketCode = extractTicketCodeFromSubject(subject);
          const fromEnvelope = message.envelope?.from?.[0];
          const fromAddress = normalizeEmail(extractAddress(fromEnvelope?.address || fromEnvelope?.name));

          if (!ticketCode || !fromAddress) {
            summary.skipped += 1;
            shouldMarkSeen = true;
            continue;
          }

          const ticket = await getTicketByDisplayCode(ticketCode);
          const user = await findUserByEmail(fromAddress);

          if (!ticket || !user || !canUserReplyToTicket(ticket, user)) {
            summary.skipped += 1;
            shouldMarkSeen = true;
            continue;
          }

          const messageBody = await extractMessageBodyFromSource(message.source);
          if (!messageBody) {
            summary.skipped += 1;
            shouldMarkSeen = true;
            continue;
          }

          await addReply({ ticketId: ticket.id, userId: user.id, message: messageBody });
          summary.processed += 1;
          shouldMarkSeen = true;
        } catch (processingError) {
          summary.errors.push(processingError?.message || 'UNKNOWN_PROCESSING_ERROR');
        } finally {
          if (shouldMarkSeen) {
            try {
              await client.messageFlagsAdd(message.uid, ['\\Seen']);
            } catch (flagError) {
              summary.errors.push(flagError?.message || 'FLAG_UPDATE_FAILED');
            }
          }
        }
      }
    } finally {
      lock.release();
    }
  } catch (error) {
    summary.errors.push(error?.message || 'UNKNOWN_IMAP_SYNC_ERROR');
  } finally {
    try {
      await client.logout();
    } catch (logoutError) {
      summary.errors.push(logoutError?.message || 'LOGOUT_FAILED');
    }
  }

  return summary;
}

export function startTicketInboxSync() {
  if (!isImapConfigured()) {
    return false;
  }
  if (ticketSyncTimer) {
    return true;
  }

  const runSync = async () => {
    if (ticketSyncInProgress) {
      return;
    }
    ticketSyncInProgress = true;
    try {
      const result = await syncTicketRepliesFromInbox();
      if (result.errors.length) {
        console.error('Erori la sincronizarea raspunsurilor din inbox:', result.errors);
      }
    } catch (error) {
      console.error('Nu s-a putut sincroniza inbox-ul pentru tickete:', error);
    } finally {
      ticketSyncInProgress = false;
    }
  };

  runSync().catch((error) => console.error('Nu s-a putut porni sincronizarea initiala a ticketelor:', error));
  ticketSyncTimer = setInterval(runSync, MAIL_TICKET_SYNC_INTERVAL_MS);

  return true;
}
