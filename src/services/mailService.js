import net from 'net';
import tls from 'tls';
import os from 'os';
import { promises as fs } from 'fs';
import crypto from 'crypto';

const MAIL_HOST = process.env.MAIL_HOST || null;
const MAIL_PORT = Number(process.env.MAIL_PORT || 465);
const MAIL_SECURE = String(process.env.MAIL_SECURE || 'true').toLowerCase() !== 'false';
const MAIL_STARTTLS = String(process.env.MAIL_STARTTLS || 'false').toLowerCase() === 'true';
const MAIL_USER = process.env.MAIL_USER || null;
const MAIL_PASSWORD = process.env.MAIL_PASSWORD || null;
const MAIL_FROM = process.env.MAIL_FROM || null;
const MAIL_NOTIFICATIONS_TO = process.env.MAIL_NOTIFICATIONS_TO || null;
const MAIL_ALLOW_INVALID_CERTS = String(process.env.MAIL_ALLOW_INVALID_CERTS || 'false').toLowerCase() === 'true';

const MAX_EMAIL_RECIPIENTS = 10;
const CLIENT_HOSTNAME = os.hostname();

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

function dotStuff(value) {
  return value.replace(/(^|\r\n)\./g, '$1..');
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
  return Boolean(MAIL_HOST && MAIL_FROM);
}

async function sendRawMail({ to, subject, text, attachments }) {
  if (!isMailConfigured()) {
    console.info('Mail service is not configured. Skipping send.');
    return false;
  }
  const recipients = normalizeAddressList(to);
  if (!recipients.length) {
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
    return true;
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
  const adminRecipients = normalizeAddressList(MAIL_NOTIFICATIONS_TO) || [];
  if (!adminRecipients.length) {
    adminRecipients.push(extractAddress(MAIL_FROM));
  }
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
  await sendRawMail({ to: adminRecipients, subject: `Solicitare ofertă - ${payload.topic}`, text: adminText, attachments: attachmentPayload });

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
      'Echipa Licențe la Cheie'
    ].join('\n');
    await sendRawMail({ to: submissionEmail, subject: 'Confirmare solicitare ofertă Licențe la Cheie', text: clientText, attachments: [] });
  }
}
