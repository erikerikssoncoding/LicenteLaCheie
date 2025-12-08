import net from 'net';
import tls from 'tls';
import os from 'os';
import { promises as fs } from 'fs';
import crypto from 'crypto';
import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import pool from '../config/db.js';
import { logMailEvent } from './notificationLogService.js';
import { createOneTimeLoginLink } from './loginLinkService.js';
import { addReply, getTicketByDisplayCode } from './ticketService.js';
import { PROTECTED_USER_ID, findUserByEmail, getUserById } from './userService.js';

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
const MAIL_IMAP_INBOX = process.env.MAIL_IMAP_INBOX || 'INBOX';
const MAIL_IMAP_SENT_FOLDER = process.env.MAIL_IMAP_SENT_FOLDER || 'Sent';
export const MAIL_IMAP_CLIENT_TIMEOUT_MS = Math.max(
  1000,
  Number(process.env.MAIL_IMAP_CLIENT_TIMEOUT_MS || 180000)
);
export const MAIL_IMAP_GREETING_TIMEOUT_MS = Math.max(
  1000,
  Number(process.env.MAIL_IMAP_GREETING_TIMEOUT_MS || 120000)
);
export const MAIL_IMAP_SOCKET_TIMEOUT_MS = Math.max(
  1000,
  Number(process.env.MAIL_IMAP_SOCKET_TIMEOUT_MS || 420000)
);
const MAIL_IMAP_KEEPALIVE_INTERVAL_MS = Math.max(
  30000,
  Number(process.env.MAIL_IMAP_KEEPALIVE_INTERVAL_MS || 60000)
);
const MAIL_TICKET_SYNC_INTERVAL_MS = Math.max(180000, Number(process.env.MAIL_TICKET_SYNC_INTERVAL_MS || 900000));
const MAILBOX_FETCH_LOOKBACK_MS = 24 * 60 * 60 * 1000;
const MAILBOX_TIMEZONE = process.env.TZ || 'Europe/Bucharest';
const MAILBOX_LOCALE = 'ro-RO';

const MAX_EMAIL_RECIPIENTS = 10;
const CLIENT_HOSTNAME = os.hostname();
const PUBLIC_WEB_BASE_URL = process.env.PUBLIC_WEB_BASE_URL || 'https://academiadelicente.ro';

let ticketSyncTimer = null;
let ticketSyncInitialTimer = null;
let ticketSyncInProgress = false;
let ticketSyncLastRunAt = null;
let ticketSyncLastResult = null;
let ticketSyncLastError = null;
let ticketSyncAbortRequested = false;
let ticketSyncAbortTimeout = null;
let currentTicketSyncClient = null;

function isSocketOrConnectionIssue(error) {
  if (!error) {
    return false;
  }

  const code = String(error.code || '').toUpperCase();
  const message = String(error.message || '').toLowerCase();
  const retryableCodes = ['ETIMEDOUT', 'ECONNRESET', 'ECONNREFUSED', 'EHOSTUNREACH', 'ENETUNREACH'];

  if (retryableCodes.includes(code)) {
    return true;
  }

  return (
    message.includes('socket timeout') ||
    message.includes('socket timed out') ||
    message.includes('read timeout') ||
    message.includes('greeting timeout') ||
    message.includes('connection closed unexpectedly') ||
    message.includes('client network socket disconnected') ||
    message.includes('unable to connect') ||
    message.includes('timed out while')
  );
}

function getBaseImapConfig() {
  return {
    host: MAIL_IMAP_HOST,
    port: MAIL_IMAP_PORT,
    secure: MAIL_IMAP_SECURE,
    logger: false,
    tls: { rejectUnauthorized: !MAIL_ALLOW_INVALID_CERTS },
    auth: {
      user: MAIL_USER,
      pass: MAIL_PASSWORD
    },
    clientTimeout: MAIL_IMAP_CLIENT_TIMEOUT_MS,
    greetingTimeout: MAIL_IMAP_GREETING_TIMEOUT_MS,
    socketTimeout: MAIL_IMAP_SOCKET_TIMEOUT_MS
  };
}

function getTicketSyncSafetyGapMs() {
  return Math.max(60 * 1000, Number(process.env.MAIL_TICKET_SYNC_SAFETY_GAP_MS || 5 * 60 * 1000));
}

function getTicketSyncAbortTimeoutMs() {
  return Math.max(1000, Number(process.env.MAIL_TICKET_SYNC_ABORT_TIMEOUT_MS || 5000));
}

function clearTicketSyncAbortTimeout() {
  if (ticketSyncAbortTimeout) {
    clearTimeout(ticketSyncAbortTimeout);
    ticketSyncAbortTimeout = null;
  }
}

function resetTicketSyncState() {
  ticketSyncInProgress = false;
  ticketSyncAbortRequested = false;
  currentTicketSyncClient = null;
  clearTicketSyncAbortTimeout();
}

function startImapKeepalive(client) {
  if (!client) {
    return () => {};
  }

  const interval = setInterval(async () => {
    if (!client.usable) {
      return;
    }

    try {
      await client.noop();
    } catch (error) {
      console.warn('IMAP keepalive failed:', error?.message || error);
    }
  }, MAIL_IMAP_KEEPALIVE_INTERVAL_MS);

  return () => clearInterval(interval);
}

async function getLastSuccessfulMailSync() {
  try {
    const [rows] = await pool.query('SELECT last_successful_sync FROM mail_sync_state WHERE id = 1 LIMIT 1');
    const lastSync = rows?.[0]?.last_successful_sync;
    return lastSync ? new Date(lastSync) : null;
  } catch (error) {
    if (error.code === 'ER_NO_SUCH_TABLE') {
      return null;
    }
    throw error;
  }
}

async function updateLastSuccessfulMailSync(date = new Date()) {
  try {
    await pool.query(
      `INSERT INTO mail_sync_state (id, last_successful_sync) VALUES (1, ?) ON DUPLICATE KEY UPDATE last_successful_sync = VALUES(last_successful_sync)`,
      [date]
    );
  } catch (error) {
    console.error('Nu s-a putut actualiza momentul ultimei sincronizari email:', error?.message || error);
  }
}

async function getMailboxFetchCriteria() {
  const fallbackSince = new Date(Date.now() - MAILBOX_FETCH_LOOKBACK_MS);
  try {
    const lastSuccess = await getLastSuccessfulMailSync();
    const since = lastSuccess ? new Date(lastSuccess) : fallbackSince;
    return { since };
  } catch (error) {
    console.error('Nu s-a putut obtine momentul ultimei sincronizari email:', error?.message || error);
    return { since: fallbackSince };
  }
}

function formatEnvelopeAddresses(addresses = []) {
  return (addresses || [])
    .map((entry) => {
      if (!entry) {
        return '';
      }
      const name = (entry.name || '').trim();
      const email = entry.address || '';
      if (name && email) {
        return `${name} <${email}>`;
      }
      return name || email;
    })
    .filter(Boolean)
    .join(', ');
}

function formatLocalizedDate(dateValue) {
  if (!dateValue) {
    return null;
  }

  const dateInstance = dateValue instanceof Date ? dateValue : new Date(dateValue);
  if (Number.isNaN(dateInstance.getTime())) {
    return null;
  }

  return dateInstance.toLocaleString(MAILBOX_LOCALE, {
    timeZone: MAILBOX_TIMEZONE,
    dateStyle: 'short',
    timeStyle: 'short'
  });
}

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

function buildMimeMessage({ from, to, subject, text, attachments, replyTo = null }) {
  const headers = [
    `From: ${from}`,
    `To: ${Array.isArray(to) ? to.join(', ') : to}`,
    `Subject: ${encodeHeader(subject)}`,
    `Date: ${formatDateHeader()}`,
    'MIME-Version: 1.0'
  ];

  if (replyTo) {
    headers.push(`Reply-To: ${replyTo}`);
  }

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

const DEFAULT_ADMIN_USER_ID = PROTECTED_USER_ID;

function isTeamUser(user) {
  if (!user) {
    return false;
  }
  return ['redactor', 'admin', 'superadmin'].includes(user.role);
}

async function getDefaultAdminUser() {
  const user = await getUserById(DEFAULT_ADMIN_USER_ID);
  return isTeamUser(user) ? user : null;
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
    /^Am .+ geschrieb:/imu,
    /^Le .+ écrit :/imu,
    /^Op .+ schreef/imu,
    /^W dniu .+ napisał/imu,
    /^De la:/imu,
    /^From:/imu,
    /^-----Original Message-----/imu,
    /^În data de .+ a scris:/imu,
    /^>*\s*[A-Za-z]+ \d{1,2}, \d{4} at .+ wrote:/imu,
    /^>*\s*\d{4}-\d{2}-\d{2} \d{1,2}:\d{2} .+:/imu,
    /^Replying to .+ on .+/imu
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

async function fetchRecentMailboxMessages(client, folderName, limit = 5) {
  const items = [];
  let error = null;
  const lock = await client.getMailboxLock(folderName);

  try {
    const totalMessages = client.mailbox?.exists || 0;
    if (!totalMessages) {
      return { items, error };
    }

    const startSeq = Math.max(1, totalMessages - limit + 1);
    for await (const message of client.fetch({ seq: `${startSeq}:${totalMessages}` }, { envelope: true, internalDate: true })) {
      const envelope = message.envelope || {};
      const dateValue = envelope.date || message.internalDate || null;
      const timestamp = dateValue ? new Date(dateValue).getTime() : null;
      items.push({
        subject: envelope.subject || '(fără subiect)',
        from: formatEnvelopeAddresses(envelope.from),
        to: formatEnvelopeAddresses(envelope.to),
        date: timestamp,
        formattedDate: formatLocalizedDate(dateValue)
      });
    }

    items.sort((a, b) => {
      const dateA = typeof a.date === 'number' ? a.date : 0;
      const dateB = typeof b.date === 'number' ? b.date : 0;
      return dateB - dateA;
    });
  } catch (mailboxError) {
    error = mailboxError?.message || 'UNKNOWN_IMAP_PREVIEW_ERROR';
  } finally {
    lock.release();
  }

  return { items, error };
}

async function sendRawMail({ to, subject, text, attachments, replyTo = null, eventType = 'generic', context = null }) {
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
  const mimeMessage = buildMimeMessage({
    from: MAIL_FROM,
    to: recipients,
    subject,
    text,
    attachments: preparedAttachments,
    replyTo
  });
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

export async function sendPasswordResetEmail({ user, token, expiresAt }) {
  if (!isMailConfigured() || !user?.email || !token) {
    return;
  }
  const normalizedEmail = String(user.email).toLowerCase();
  const resetLink = buildPublicUrl(`/autentificare?resetToken=${encodeURIComponent(token)}`);
  const expiresLabel = expiresAt ? new Date(expiresAt).toLocaleString('ro-RO') : null;
  const clientText = [
    `Bună, ${user.full_name || user.fullName || 'utilizator'}!`,
    '',
    'Am primit o cerere de resetare a parolei pentru contul tău din Academia de Licențe.',
    `Accesează linkul securizat pentru a seta o parolă nouă: ${resetLink}`,
    expiresLabel ? `Linkul expiră la: ${expiresLabel}.` : 'Linkul este valabil timp limitat.',
    '',
    'Dacă nu ai inițiat această solicitare, poți ignora mesajul și parola ta va rămâne neschimbată.',
    '',
    'Echipa Academia de Licențe'
  ].join('\n');

  await sendRawMail({
    to: normalizedEmail,
    subject: 'Instrucțiuni resetare parolă – Academia de Licențe',
    text: clientText,
    attachments: [],
    eventType: 'password_reset_request',
    context: { userId: user.id }
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
      replyTo: normalizedClientEmail,
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

  const adminRecipients = sanitizeEmailList(
    getAdminNotificationRecipients(adminEmails),
    normalizedClientEmail ? [normalizedClientEmail] : []
  );
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
      replyTo: isClientAuthor ? senderEmail : null,
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

async function processMailbox(client, folderName, handler, summary, searchCriteria = null) {
  const folderStats = { processed: 0, skipped: 0, errors: [] };
  
  // LOG NOU: Vedem când începe
  console.log(`[DEBUG IMAP] Încerc să deschid folderul: ${folderName}`);
  
  const lock = await client.getMailboxLock(folderName);
  const criteria = searchCriteria || { seen: false };

  // LOG NOU: Vedem criteriile de căutare
  console.log(`[DEBUG IMAP] Folder ${folderName} deschis. Caut mesaje cu criteriul:`, JSON.stringify(criteria));

  try {
    let messageCount = 0;
    for await (const message of client.fetch(criteria, { envelope: true, uid: true, source: true, headers: ['message-id'] })) {
      const fromEnvelope = message.envelope?.from?.[0];
      const fromAddress = fromEnvelope?.address || fromEnvelope?.name || 'necunoscut';
      console.log(
        `[DEBUG EMAIL] Se procesează mesajul UID=${message.uid} | From=${fromAddress} | Subiect=${message.envelope?.subject || ''} | Message-ID=${message.envelope?.messageId || 'N/A'}`
      );
      messageCount++;
      if (ticketSyncAbortRequested) {
        summary.errors.push('SYNC_ABORTED_BY_USER');
        folderStats.errors.push('SYNC_ABORTED_BY_USER');
        break;
      }
      
      // LOG NOU (doar primul mesaj, ca să nu umplem consola)
      if (messageCount === 1) console.log(`[DEBUG IMAP] ${folderName}: Am început să primesc mesaje...`);

      let shouldMarkSeen = false;
      try {
        const action = await handler(message);
        console.log(`[DEBUG IMAP] Rezultat procesare UID=${message.uid}: ${action}`);
        if (action === 'processed') {
          summary.processed += 1;
          folderStats.processed += 1;
        } else {
          summary.skipped += 1;
          folderStats.skipped += 1;
        }
        shouldMarkSeen = true;
      } catch (processingError) {
        const messageText = `${folderName}: ${processingError?.message || 'UNKNOWN_PROCESSING_ERROR'}`;
        summary.errors.push(messageText);
        folderStats.errors.push(messageText);
      } finally {
        if (shouldMarkSeen) {
          try {
            await client.messageFlagsAdd(message.uid, ['\\Seen']);
            console.log(`[DEBUG IMAP] Marcăm ca citit UID=${message.uid}`);
          } catch (flagError) {
            const flagMessage = `${folderName}: ${flagError?.message || 'FLAG_UPDATE_FAILED'}`;
            summary.errors.push(flagMessage);
            folderStats.errors.push(flagMessage);
          }
        }
      }
    }
    console.log(`[DEBUG IMAP] Finalizat ${folderName}. Total procesate: ${messageCount}`);
  } finally {
    lock.release();
  }

  summary.folders[folderName] = folderStats;
}

async function handleInboxMessage(message) {
  const subject = message.envelope?.subject || '';
  const ticketCode = extractTicketCodeFromSubject(subject);

  // Parsăm conținutul pentru a verifica prima linie
  const parsed = await simpleParser(message.source);
  const textContent = parsed.text || '';
  const firstLine = textContent.trim().split(/\r?\n/)[0] || '';

  if (
    firstLine.includes('A fost deschis un ticket nou') ||
    firstLine.includes('Echipa a transmis un raspuns intr-un ticket.')
  ) {
    console.log(`[DEBUG INBOX] Skipped - Automated system notification detected in body: ${subject}`);
    return 'skipped';
  }

  const fromEnvelope = message.envelope?.from?.[0];
  const fromAddress = normalizeEmail(extractAddress(fromEnvelope?.address || fromEnvelope?.name));
  const messageId = message.envelope?.messageId || null;

  if (!ticketCode || !fromAddress) {
    console.log(`[DEBUG INBOX] UID=${message.uid} Skipped - lipsă ticket code sau adresa expeditorului (${fromAddress || 'necunoscut'})`);
    return 'skipped';
  }

  const ticket = await getTicketByDisplayCode(ticketCode);
  const user = await findUserByEmail(fromAddress);

  if (!ticket || !user || !canUserReplyToTicket(ticket, user)) {
    console.log(
      `[DEBUG INBOX] UID=${message.uid} Skipped - ticket sau user invalid (ticket=${ticket?.id || 'N/A'}, user=${user?.id || 'N/A'})`
    );
    return 'skipped';
  }

  const messageBody = await extractMessageBodyFromSource(message.source);
  if (!messageBody) {
    console.log(`[DEBUG INBOX] UID=${message.uid} Skipped - corpul mesajului este gol`);
    return 'skipped';
  }

  const result = await addReply({ ticketId: ticket.id, userId: user.id, message: messageBody, messageId });
  return result?.skipped ? 'skipped' : 'processed';
}

async function handleSentMessage(message) {
  const subject = message.envelope?.subject || '';
  const ticketCode = extractTicketCodeFromSubject(subject);
  const fromEnvelope = message.envelope?.from?.[0];
  const fromAddress = normalizeEmail(extractAddress(fromEnvelope?.address || fromEnvelope?.name));
  const messageId = message.envelope?.messageId || null;

  console.log(`[DEBUG SENT] Procesare email: ${subject} | From: ${fromAddress} | TicketCode: ${ticketCode}`);

  if (!ticketCode) {
    console.log(`[DEBUG SENT] Sarit - Lipsa cod ticket: ${subject}`);
    return 'skipped';
  }

  const parsed = await simpleParser(message.source);
  const textContent = parsed.text || '';
  const firstLine = textContent.trim().split(/\r?\n/)[0] || '';

  if (
    firstLine.includes('A fost deschis un ticket nou') ||
    firstLine.includes('Echipa a transmis un raspuns intr-un ticket.')
  ) {
    console.log(`[DEBUG SENT] Skipped - Automated system notification detected in body: ${subject}`);
    return 'skipped';
  }

  const ticket = await getTicketByDisplayCode(ticketCode);
  if (!ticket) {
    console.log(`[DEBUG SENT] Sarit - Ticket invalid in DB: ${ticketCode}`);
    return 'skipped';
  }

  let user = fromAddress ? await findUserByEmail(fromAddress) : null;
  const fallbackAdmin = await getDefaultAdminUser();

  if (!isTeamUser(user)) {
    console.log(`[DEBUG SENT] Utilizatorul ${fromAddress} nu este team user; folosim fallback admin: ${fallbackAdmin?.email}`);
    user = fallbackAdmin;
  }

  if (!user) {
    console.log(`[DEBUG SENT] Sarit - Nu exista user asociat pentru ${fromAddress}`);
    return 'skipped';
  }

  const canReply = canUserReplyToTicket(ticket, user) || ['admin', 'superadmin'].includes(user.role);
  if (!canReply && fallbackAdmin && fallbackAdmin.id !== user.id) {
    console.log(`[DEBUG SENT] Utilizatorul ${fromAddress} nu poate raspunde; incercam fallback admin ${fallbackAdmin.email}`);
    user = fallbackAdmin;
  }

  if (!user || !isTeamUser(user)) {
    console.log(`[DEBUG SENT] Sarit - ${fromAddress} nu este utilizator de tip echipa.`);
    return 'skipped';
  }

  const messageBody = await extractMessageBodyFromSource(message.source);
  if (!messageBody) {
    console.log(`[DEBUG SENT] Sarit - Nu am putut extrage corpul mesajului pentru ${subject}`);
    return 'skipped';
  }

  const result = await addReply({ ticketId: ticket.id, userId: user.id, message: messageBody, messageId });
  return result?.skipped ? 'skipped' : 'processed';
}

async function runTicketSyncAttempt(searchCriteria) {
  const summary = { processed: 0, skipped: 0, errors: [], folders: {} };
  const client = new ImapFlow(getBaseImapConfig());
  let stopKeepalive = () => {};
  let shouldRetry = false;
  let fatalConnectionFailure = false;
  let attemptError = null;

  const handleError = (err) => {
    const errorMsg = `IMAP Background Error: ${err.message || err}`;
    console.error(errorMsg);
    summary.errors.push(errorMsg);

    if (isSocketOrConnectionIssue(err)) {
      shouldRetry = true;
      fatalConnectionFailure = true;
      stopKeepalive();
      try {
        client.close();
      } catch (closeError) {
        console.error('Nu s-a putut inchide clientul IMAP dupa eroare:', closeError?.message || closeError);
      }
    }

    attemptError = attemptError || err;
  };

  client.on('error', handleError);

  try {
    currentTicketSyncClient = client;
    await client.connect();
    stopKeepalive = startImapKeepalive(client);

    try {
      await processMailbox(client, MAIL_IMAP_INBOX, handleInboxMessage, summary, searchCriteria);
    } catch (inboxError) {
      const inboxMessage = `${MAIL_IMAP_INBOX}: ${inboxError?.message || 'UNKNOWN_IMAP_SYNC_ERROR'}`;
      summary.errors.push(inboxMessage);
      summary.folders[MAIL_IMAP_INBOX] = summary.folders[MAIL_IMAP_INBOX] || { processed: 0, skipped: 0, errors: [inboxMessage] };
    }

    try {
      await processMailbox(client, MAIL_IMAP_SENT_FOLDER, handleSentMessage, summary, searchCriteria);
    } catch (sentError) {
      const sentMessage = `${MAIL_IMAP_SENT_FOLDER}: ${sentError?.message || 'UNKNOWN_IMAP_SYNC_ERROR'}`;
      summary.errors.push(sentMessage);
      summary.folders[MAIL_IMAP_SENT_FOLDER] = summary.folders[MAIL_IMAP_SENT_FOLDER] || {
        processed: 0,
        skipped: 0,
        errors: [sentMessage]
      };
    }
  } catch (error) {
    attemptError = error;
    summary.errors.push(error?.message || 'UNKNOWN_IMAP_SYNC_ERROR');

    if (isSocketOrConnectionIssue(error)) {
      shouldRetry = true;
      fatalConnectionFailure = true;
    }
  } finally {
    stopKeepalive();
    clearTicketSyncAbortTimeout();
    currentTicketSyncClient = null;
    try {
      // Verificăm dacă suntem conectați înainte de logout pentru a evita alte erori
      if (client.usable) {
        await client.logout();
      } else {
        client.close();
      }
    } catch (logoutError) {
      // Ignorăm erorile la logout, nu sunt critice
    }
  }

  return { summary, shouldRetry, fatalConnectionFailure, error: attemptError };
}

export async function syncTicketRepliesFromInbox() {
  if (!isImapConfigured()) {
    return { processed: 0, skipped: 0, errors: ['IMAP_NOT_CONFIGURED'], folders: {} };
  }

  const searchCriteria = await getMailboxFetchCriteria();
  let lastError = null;
  let lastSummary = null;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const { summary, shouldRetry, fatalConnectionFailure, error } = await runTicketSyncAttempt(searchCriteria);
    lastSummary = summary;

    if (!shouldRetry) {
      return summary;
    }

    lastError = error || new Error('IMAP connection issue');

    if (attempt === 0 && fatalConnectionFailure) {
      console.warn('Probleme de conexiune IMAP detectate, incercam o noua conexiune...');
      continue;
    }

    const fatalError = lastError || new Error('IMAP connection failed after retry');
    fatalError.fatalConnectionFailure = true;
    fatalError.summary = lastSummary;
    throw fatalError;
  }

  const fatalError = lastError || new Error('IMAP connection failed after retry');
  fatalError.fatalConnectionFailure = true;
  fatalError.summary = lastSummary;
  throw fatalError;
}

export async function getRecentMailboxPreview(limit = 5) {
  const result = {
    inbox: [],
    sent: [],
    errors: [],
    fetchedAt: new Date().toISOString()
  };

  if (!isImapConfigured()) {
    result.errors.push('IMAP_NOT_CONFIGURED');
    return result;
  }

  const client = new ImapFlow(getBaseImapConfig());

  try {
    await client.connect();
    const inboxResult = await fetchRecentMailboxMessages(client, MAIL_IMAP_INBOX, limit);
    const sentResult = await fetchRecentMailboxMessages(client, MAIL_IMAP_SENT_FOLDER, limit);

    result.inbox = inboxResult.items;
    result.sent = sentResult.items;

    if (inboxResult.error) {
      result.errors.push(`${MAIL_IMAP_INBOX}: ${inboxResult.error}`);
    }
    if (sentResult.error) {
      result.errors.push(`${MAIL_IMAP_SENT_FOLDER}: ${sentResult.error}`);
    }
  } catch (error) {
    result.errors.push(error?.message || 'UNKNOWN_IMAP_PREVIEW_ERROR');
  } finally {
    try {
      await client.logout();
    } catch (logoutError) {
      result.errors.push(logoutError?.message || 'LOGOUT_FAILED');
    }
  }

  return result;
}

async function performTicketInboxSync() {
  if (ticketSyncInProgress) {
    return { skipped: true, reason: 'SYNC_IN_PROGRESS' };
  }

  ticketSyncInProgress = true;
  ticketSyncAbortRequested = false;
  const startedAt = new Date();
  let previousSync = null;
  let summary = null;
  let errorMessage = null;

  try {
    // 1. Luam data ultimei sincronizari REUSITE (ex: ieri)
    previousSync = await getLastSuccessfulMailSync();

    // ATENTIE: NU actualizam aici baza de date, pentru ca vrem sa folosim data veche pentru cautare!

    // 2. Rulam sincronizarea (va folosi previousSync prin getMailboxFetchCriteria)
    summary = await syncTicketRepliesFromInbox();

    // 3. Daca totul a mers bine, ABIA ACUM actualizam data in DB cu "acum"
    await updateLastSuccessfulMailSync(startedAt);

    // Daca au fost erori partiale (dar functia nu a crapat), putem decide sa revenim la data veche
    const hasSyncErrors = Boolean(summary?.errors?.length);
    if (hasSyncErrors) {
      const adjustedDate = new Date(startedAt.getTime() - getTicketSyncSafetyGapMs());
      console.warn('Sincronizare cu erori partiale; setam data ultimei sincronizari cu un gap de siguranta.');
      await updateLastSuccessfulMailSync(adjustedDate);
    }
  } catch (error) {
    errorMessage = error?.message || 'UNKNOWN_IMAP_SYNC_ERROR';
    console.error('Eroare la sincronizarea inbox-ului de tickete:', errorMessage);
    summary = summary || error?.summary || null;

    if (!error?.fatalConnectionFailure) {
      const fallbackDate = new Date(startedAt.getTime() - getTicketSyncSafetyGapMs());
      await updateLastSuccessfulMailSync(fallbackDate);
    } else {
      console.warn('Skip actualizarea ultimei sincronizari: conexiunea IMAP a esuat dupa retry.');
    }
  } finally {
    resetTicketSyncState();
    ticketSyncLastRunAt = startedAt;
    ticketSyncLastResult = summary;
    ticketSyncLastError = errorMessage;
  }

  return { startedAt, summary, error: errorMessage };
}

export async function getTicketInboxSyncState() {
  let persistedLastRunAt = null;

  try {
    persistedLastRunAt = await getLastSuccessfulMailSync();
  } catch (error) {
    console.error('Nu s-a putut obtine momentul ultimei sincronizari email:', error?.message || error);
  }

  return {
    configured: isImapConfigured(),
    timerActive: Boolean(ticketSyncTimer || ticketSyncInitialTimer),
    inProgress: ticketSyncInProgress,
    abortRequested: ticketSyncAbortRequested,
    lastRunAt: ticketSyncLastRunAt,
    lastSuccessfulRunAt: persistedLastRunAt,
    lastResult: ticketSyncLastResult,
    lastError: ticketSyncLastError,
    intervalMs: MAIL_TICKET_SYNC_INTERVAL_MS,
    lastKnownRunAt: ticketSyncLastRunAt || persistedLastRunAt
  };
}

export async function triggerTicketInboxSyncNow() {
  if (!isImapConfigured()) {
    return { started: false, reason: 'IMAP_NOT_CONFIGURED' };
  }

  if (ticketSyncInProgress) {
    return { started: false, reason: 'SYNC_IN_PROGRESS' };
  }

  performTicketInboxSync().catch((error) => {
    console.error('Eroare in sincronizarea manuala background:', error);
  });

  return { started: true, message: 'Sincronizarea a inceput in fundal.' };
}

export function startTicketInboxSync() {
  if (!isImapConfigured()) {
    return false;
  }
  if (ticketSyncTimer || ticketSyncInitialTimer) {
    return true;
  }

  const runSync = async () => {
    if (ticketSyncInProgress) {
      return;
    }
    const result = await performTicketInboxSync();
    if (result.error) {
      console.error('Nu s-a putut sincroniza inbox-ul pentru tickete:', result.error);
    }
    if (result.summary?.errors?.length) {
      console.error('Erori la sincronizarea raspunsurilor din inbox:', result.summary.errors);
    }
  };

  const initialDelayMs = Math.max(10 * 60 * 1000, MAIL_TICKET_SYNC_INTERVAL_MS);

  ticketSyncInitialTimer = setTimeout(() => {
    runSync()
      .catch((error) => console.error('Nu s-a putut porni sincronizarea initiala a ticketelor:', error))
      .finally(() => {
        ticketSyncTimer = setInterval(runSync, MAIL_TICKET_SYNC_INTERVAL_MS);
        ticketSyncInitialTimer = null;
      });
  }, initialDelayMs);

  return true;
}

export function stopTicketInboxSync() {
  const wasRunning = ticketSyncInProgress;

  if (ticketSyncTimer) {
    clearInterval(ticketSyncTimer);
    ticketSyncTimer = null;
  }

  if (ticketSyncInitialTimer) {
    clearTimeout(ticketSyncInitialTimer);
    ticketSyncInitialTimer = null;
  }

  if (ticketSyncInProgress) {
    ticketSyncAbortRequested = true;
    console.warn('Abort requested for ticket inbox sync; attempting to stop current run.');

    if (currentTicketSyncClient?.close) {
      Promise.resolve()
        .then(() => currentTicketSyncClient.close())
        .catch((error) =>
          console.error('Nu s-a putut inchide conexiunea IMAP dupa solicitarea de oprire:', error?.message || error)
        );
    }

    clearTicketSyncAbortTimeout();
    ticketSyncAbortTimeout = setTimeout(() => {
      if (ticketSyncInProgress) {
        console.warn('Ticket inbox sync did not stop gracefully. Forcing cleanup after abort timeout.');
        resetTicketSyncState();
      }
    }, getTicketSyncAbortTimeoutMs());
  } else {
    resetTicketSyncState();
  }

  return {
    timerStopped: Boolean(!ticketSyncTimer && !ticketSyncInitialTimer),
    abortRequested: ticketSyncAbortRequested,
    wasRunning
  };
}

// Test helpers
export function __setTicketSyncStateForTests({ inProgress = false, abortRequested = false, client = null } = {}) {
  ticketSyncInProgress = inProgress;
  ticketSyncAbortRequested = abortRequested;
  currentTicketSyncClient = client;
}

export function __resetTicketSyncStateForTests() {
  resetTicketSyncState();
}
