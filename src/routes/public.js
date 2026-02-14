import { Router } from 'express';
import { promises as fs } from 'fs';
import path from 'path';
import { createRequire } from 'module';
import multer from 'multer';
import { z } from 'zod';
import { createContactRequest } from '../services/contactService.js';
import {
  createOfferRequest,
  getOfferByCode,
  DEFAULT_OFFER_EXPIRATION_HOURS
} from '../services/offerService.js';
import { ensureClientAccount, updateUserProfile } from '../services/userService.js';
import { createTicket, saveTicketAttachments } from '../services/ticketService.js';
import {
  sendContactSubmissionEmails,
  sendOfferSubmissionEmails,
  sendTicketCreatedNotification
} from '../services/mailService.js';
import { sanitizeContractHtml } from '../services/contractService.js';
import { collectClientMetadata } from '../utils/requestMetadata.js';
import { TICKET_ALLOWED_MIME_TYPES, TICKET_ATTACHMENT_MAX_FILES, TICKET_ATTACHMENT_MAX_SIZE } from '../constants/attachmentRules.js';
import { CONTACT_ATTACHMENT_ROOT, OFFER_ATTACHMENT_ROOT, buildStoredFileName } from '../utils/fileStorage.js';
import csrfProtection from '../middleware/csrfProtection.js';

const require = createRequire(import.meta.url);
const phonePrefixData = require('../../public/data/phone-prefixes.json');

const router = Router();

const MINIMUM_DELIVERY_LEAD_DAYS = 14;
const CONTACT_ATTACHMENT_MAX_SIZE = 5 * 1024 * 1024; // 5 MB
const CONTACT_ALLOWED_MIME_TYPES = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain',
  'image/jpeg',
  'image/png'
]);
const PHONE_PREFIXES = (phonePrefixData.default ?? phonePrefixData)
  .map((entry) => ({
    emoji: entry.emoji,
    country: entry.country,
    code: typeof entry.code === 'string' ? entry.code.replace(/[^+\d]/g, '') : ''
  }))
  .filter((entry) => entry.code && entry.code.startsWith('+'));
const PHONE_PREFIX_CODES = PHONE_PREFIXES.map((entry) => entry.code).sort((a, b) => b.length - a.length);
const INTERNATIONAL_PHONE_PATTERN = /^\+[1-9][0-9]{5,14}$/u;
const OFFER_PAGE_TITLE = 'Solicită o ofertă personalizată pentru lucrarea ta';
const OFFER_PAGE_DESCRIPTION =
  'Completează formularul, iar platforma va genera un draft de contract pentru redactarea, corectura și pregătirea lucrării tale.';

export const OFFER_WORK_TYPES = [
  'lucrare de licență',
  'lucrare de grad',
  'lucrare de disertație',
  'lucrare de doctorat',
  'proiect'
];

const offerAttachmentStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, OFFER_ATTACHMENT_ROOT),
  filename: (req, file, cb) => cb(null, buildStoredFileName(file.originalname))
});

const offerAttachmentUpload = multer({
  storage: offerAttachmentStorage,
  limits: { fileSize: TICKET_ATTACHMENT_MAX_SIZE, files: TICKET_ATTACHMENT_MAX_FILES },
  fileFilter: (req, file, cb) => {
    if (TICKET_ALLOWED_MIME_TYPES.has(file.mimetype)) {
      return cb(null, true);
    }
    const error = new Error('UNSUPPORTED_FILE_TYPE');
    return cb(error);
  }
});

const contactAttachmentStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, CONTACT_ATTACHMENT_ROOT),
  filename: (req, file, cb) => cb(null, buildStoredFileName(file.originalname))
});

const contactAttachmentUpload = multer({
  storage: contactAttachmentStorage,
  limits: { fileSize: CONTACT_ATTACHMENT_MAX_SIZE, files: 1 },
  fileFilter: (req, file, cb) => {
    if (CONTACT_ALLOWED_MIME_TYPES.has(file.mimetype)) {
      return cb(null, true);
    }
    const error = new Error('UNSUPPORTED_FILE_TYPE');
    return cb(error);
  }
});

const getMinimumDeliveryDate = () => {
  const today = new Date();
  const utcToday = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
  utcToday.setUTCDate(utcToday.getUTCDate() + MINIMUM_DELIVERY_LEAD_DAYS);
  return utcToday;
};

const formatDateForInput = (date) => {
  const year = date.getUTCFullYear();
  const month = `${date.getUTCMonth() + 1}`.padStart(2, '0');
  const day = `${date.getUTCDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const parseDateInput = (value) => {
  const [year, month, day] = value.split('-').map(Number);
  if (![year, month, day].every(Number.isFinite)) {
    return null;
  }
  return new Date(Date.UTC(year, month - 1, day));
};

const renderOfferPage = (res, extra = {}, status = 200) =>
  res.status(status).render('pages/offer', {
    title: OFFER_PAGE_TITLE,
    description: OFFER_PAGE_DESCRIPTION,
    minDeliveryDate: formatDateForInput(getMinimumDeliveryDate()),
    ...extra
  });

export const offerSubmissionSchema = z.object({
  clientName: z.string().trim().min(3, 'Introduce un nume complet valid.'),
  email: z.string().trim().email('Te rugăm să introduci o adresă de email validă.'),
  phone: z
    .string()
    .min(6)
    .transform((value) => sanitizePhoneValue(value))
    .refine((value) => isSupportedInternationalPhone(value), 'Introdu un număr de telefon internațional cu prefix valid.')
    .refine((value) => !hasInvalidRepetition(value), 'Numărul de telefon nu poate avea toate cifrele identice.'),
  program: z.string().trim().min(3, 'Programul de studii trebuie să aibă cel puțin 3 caractere.'),
  topic: z.string().trim().min(5, 'Tema lucrării trebuie să fie mai detaliată.'),
  workType: z.enum(OFFER_WORK_TYPES),
  deliveryDate: z
    .string()
    .regex(/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/u, 'Selectează o dată de livrare validă (format AAAA-LL-ZZ).')
    .refine((value) => {
      const parsed = parseDateInput(value);
      if (!parsed) {
        return false;
      }
      const minimum = getMinimumDeliveryDate();
      return parsed >= minimum;
    }, `Data dorită de livrare trebuie să fie la cel puțin ${MINIMUM_DELIVERY_LEAD_DAYS} zile distanță de astăzi.`),
  notes: z
    .string()
    .max(2000)
    .transform((value) => value.trim())
    .optional()
});

const renderContactPage = (res, extra = {}, status = 200) =>
  res.status(status).render('pages/contact', {
    ...CONTACT_PAGE_PROPS,
    ...extra
  });

const setResponseCsrfToken = (req, res) => {
  if (typeof req.csrfToken === 'function') {
    res.locals.csrfToken = req.csrfToken();
  }
};

async function cleanupOfferFiles(files = []) {
  await Promise.all(
    files.map((file) =>
      fs.unlink(file.path).catch(() => {
        return null;
      })
    )
  );
}

const cleanupContactAttachment = async (file) => {
  if (!file?.path) {
    return;
  }
  await fs.unlink(file.path).catch(() => null);
};

const formatAttachmentSummary = (files = []) => {
  if (!files.length) {
    return null;
  }
  return files
    .map((file) => `- ${file.originalname} (${(file.size / 1024).toFixed(1)} KB)`)
    .join('\n');
};

const mapUploadError = (error) => {
  if (!error) {
    return null;
  }
  if (error.code === 'LIMIT_FILE_SIZE') {
    return 'Fiecare fișier poate avea maximum 8MB.';
  }
  if (error.code === 'LIMIT_FILE_COUNT' || error.code === 'LIMIT_UNEXPECTED_FILE') {
    return 'Poți încărca cel mult 5 fișiere pentru evaluare.';
  }
  if (error.message === 'UNSUPPORTED_FILE_TYPE') {
    return 'Formatul fișierului nu este acceptat. Încarcă PDF, DOC(X), XLS(X), PPT(X), imagini sau arhive.';
  }
  return 'Încărcarea fișierului a eșuat. Reîncearcă sau contactează-ne pentru ajutor.';
};

async function moveContactAttachmentToOfferStorage(file) {
  if (!file?.path) {
    return null;
  }
  const targetPath = path.join(OFFER_ATTACHMENT_ROOT, file.filename);
  if (file.path === targetPath) {
    return file;
  }
  await fs.rename(file.path, targetPath);
  return {
    ...file,
    path: targetPath
  };
}

const mapContactUploadError = (error) => {
  if (!error) {
    return null;
  }
  if (error.code === 'LIMIT_FILE_SIZE') {
    return 'Fișierul poate avea cel mult 5MB.';
  }
  if (error.code === 'LIMIT_FILE_COUNT' || error.code === 'LIMIT_UNEXPECTED_FILE') {
    return 'Poți atașa un singur fișier la mesaj.';
  }
  if (error.message === 'UNSUPPORTED_FILE_TYPE') {
    return 'Acceptăm doar fișiere PDF, DOC/DOCX, JPG, PNG sau TXT.';
  }
  return 'Încărcarea fișierului a eșuat. Reîncearcă sau contactează-ne pentru ajutor.';
};

const CONTACT_PAGE_PROPS = {
  title: 'Contact Academia de Licențe',
  description:
    'Scrie-ne pentru a afla cum te putem ajuta cu redactarea lucrării de licență sau a proiectului tău academic.'
};

const sanitizePhoneValue = (value) => {
  if (typeof value !== 'string') {
    return '';
  }
  const trimmed = value.trim();
  const compact = trimmed.replace(/[\s().-]+/g, '');
  if (compact.startsWith('00')) {
    return `+${compact.slice(2)}`;
  }
  if (/^0[0-9]{9}$/u.test(compact)) {
    return `+4${compact}`;
  }
  return compact;
};

const hasInvalidRepetition = (value) => {
  const digits = value.replace(/\D/g, '').slice(-9);
  if (!digits || digits.length < 6) {
    return false;
  }
  return /^([0-9])\1+$/u.test(digits);
};

const hasSupportedPhonePrefix = (value) => {
  if (!value || !value.startsWith('+')) {
    return false;
  }
  return PHONE_PREFIX_CODES.some((prefix) => value.startsWith(prefix));
};

const isSupportedInternationalPhone = (value) =>
  INTERNATIONAL_PHONE_PATTERN.test(value) && hasSupportedPhonePrefix(value);

router.get('/', (req, res) => {
  res.render('pages/home', {
    title: 'Lucrări de licență premium redactate de experți',
    description:
      'Academia de Licențe oferă servicii profesionale de redactare, consultanță și verificare pentru lucrări de licență, disertații și proiecte academice.'
  });
});

router.get('/despre-noi', (req, res) => {
  res.render('pages/about', {
    title: 'Despre echipa noastră',
    description:
      'Află cum echipa Academia de Licențe îi ghidează pe studenți către finalizarea cu succes a lucrărilor de licență și a proiectelor de absolvire.'
  });
});

router.get('/servicii', (req, res) => {
  res.render('pages/services', {
    title: 'Servicii pentru lucrări de licență și proiecte academice',
    description:
      'Consultanță, redactare personalizată și verificări antiplagiat pentru lucrări de licență și disertații.'
  });
});

router.get('/termeni-si-conditii', (req, res) => {
  res.render('pages/terms', {
    title: 'Termeni și condiții - Academia de Licențe',
    description:
      'Aflați condițiile de utilizare ale platformei Academia de Licențe, responsabilitățile părților și regulile de furnizare a serviciilor.'
  });
});

router.get('/politica-confidentialitate', (req, res) => {
  res.render('pages/privacy', {
    title: 'Politica de confidentialitate - Academia de Licențe',
    description:
      'Informații despre modul în care colectăm, folosim și protejăm datele personale în platforma Academia de Licențe.'
  });
});

router.get('/politica-cookie', (req, res) => {
  res.render('pages/cookies', {
    title: 'Politica privind cookies - Academia de Licențe',
    description:
      'Detalii privind tipurile de cookie-uri folosite pe site-ul academiadelicențe.ro și opțiunile de control disponibile utilizatorilor.'
  });
});

router
  .route('/contact')
  .get(csrfProtection, (req, res) => {
    setResponseCsrfToken(req, res);
    res.render('pages/contact', CONTACT_PAGE_PROPS);
  })
  .post(contactAttachmentUpload.single('attachment'), csrfProtection, handleContactPost);

router
  .route('/oferta')
  .get(csrfProtection, (req, res) => {
    setResponseCsrfToken(req, res);
    return renderOfferPage(res);
  })
  .post(offerAttachmentUpload.array('attachments', TICKET_ATTACHMENT_MAX_FILES), csrfProtection, handleOfferPost);

router.use('/contact', async (err, req, res, next) => {
  if (req.method !== 'POST') {
    return next(err);
  }
  if (!(err instanceof multer.MulterError) && err?.message !== 'UNSUPPORTED_FILE_TYPE') {
    return next(err);
  }
  try {
    await cleanupContactAttachment(req.file);
    return csrfProtection(req, res, (csrfError) => {
      if (csrfError) {
        return next(csrfError);
      }
      setResponseCsrfToken(req, res);
      return renderContactPage(res, { error: mapContactUploadError(err) }, 400);
    });
  } catch (cleanupError) {
    return next(cleanupError);
  }
});

router.use('/oferta', async (err, req, res, next) => {
  if (req.method !== 'POST') {
    return next(err);
  }
  if (!(err instanceof multer.MulterError) && err?.message !== 'UNSUPPORTED_FILE_TYPE') {
    return next(err);
  }
  const attachments = Array.isArray(req.files) ? req.files : [];
  try {
    await cleanupOfferFiles(attachments);
    return csrfProtection(req, res, (csrfError) => {
      if (csrfError) {
        return next(csrfError);
      }
      setResponseCsrfToken(req, res);
      return renderOfferPage(res, { error: mapUploadError(err) }, 400);
    });
  } catch (cleanupError) {
    return next(cleanupError);
  }
});

async function handleContactPost(req, res, next) {
  try {
    setResponseCsrfToken(req, res);
    const schema = z.object({
      fullName: z.string().min(3, 'Numele trebuie să aibă minim 3 caractere'),
      email: z.string().email('Adresa de email nu este validă'),
      phone: z
        .string()
        .min(6, 'Numărul de telefon este invalid')
        .transform((value) => sanitizePhoneValue(value))
        .refine((value) => isSupportedInternationalPhone(value), 'Introdu un număr de telefon internațional cu prefix valid.')
        .refine((value) => !hasInvalidRepetition(value), 'Numărul de telefon nu poate avea toate cifrele identice.'),
      message: z.string().min(10, 'Mesajul trebuie să fie mai detaliat')
    });

    const data = schema.parse(req.body);
    const clientMetadata = collectClientMetadata(req);

    const attachment = req.file;
    let persistedAttachment = false;

    if (req.session?.user) {
      const user = req.session.user;
      if (user.fullName !== data.fullName || user.phone !== data.phone) {
        await updateUserProfile(user.id, { fullName: data.fullName, phone: data.phone });
        req.session.user.fullName = data.fullName;
        req.session.user.phone = data.phone;
      }

      const { id: ticketId, displayCode } = await createTicket({
        projectId: null,
        userId: user.id,
        subject: `Solicitare contact - ${data.fullName}`,
        message: `Telefon: ${data.phone}\nEmail: ${user.email}\n\n${data.message}`,
        kind: 'support',
        clientMetadata
      });

      const ticketPayload = {
        id: ticketId,
        display_code: displayCode,
        subject: `Solicitare contact - ${data.fullName}`,
        message: `Telefon: ${data.phone}\nEmail: ${user.email}\n\n${data.message}`
      };
      sendTicketCreatedNotification({
        ticket: ticketPayload,
        author: { id: user.id, fullName: user.fullName, email: user.email },
        clientEmail: user.email
      }).catch((error) => console.error('Nu s-a putut trimite notificarea de creare ticket (autentificat):', error));

      if (attachment) {
        const preparedAttachment = await moveContactAttachmentToOfferStorage(attachment);
        await saveTicketAttachments({
          ticketId,
          uploaderId: user.id,
          uploaderRole: user.role,
          origin: user.role === 'client' ? 'client' : 'staff',
          files: preparedAttachment ? [preparedAttachment] : []
        });
        persistedAttachment = Boolean(preparedAttachment);
      }

      return res.render('pages/contact-success', {
        title: 'Ticket deschis cu succes',
        description: 'Am înregistrat solicitarea ta direct în cont. Echipa noastră îți va răspunde în cel mai scurt timp.',
        ticketId,
        ticketDisplayCode: displayCode,
        submissionEmail: user.email
      });
    }

    const ensuredAccount = await ensureClientAccount({
      fullName: data.fullName,
      email: data.email,
      phone: data.phone
    });

    const messageBody = `Telefon: ${data.phone}\nEmail: ${data.email}\n\n${data.message}`;
    const { id: ticketId, displayCode } = await createTicket({
      projectId: null,
      userId: ensuredAccount.userId,
      subject: `Solicitare contact - ${data.fullName}`,
      message: messageBody,
      kind: 'support',
      clientMetadata
    });

    const ticketPayload = {
      id: ticketId,
      display_code: displayCode,
      subject: `Solicitare contact - ${data.fullName}`,
      message: messageBody
    };
    sendTicketCreatedNotification({
      ticket: ticketPayload,
      author: { id: ensuredAccount.userId, fullName: data.fullName, email: data.email },
      clientEmail: data.email
    }).catch((error) => console.error('Nu s-a putut trimite notificarea de creare ticket (guest):', error));

    if (attachment) {
      const preparedAttachment = await moveContactAttachmentToOfferStorage(attachment);
      await saveTicketAttachments({
        ticketId,
        uploaderId: ensuredAccount.userId,
        uploaderRole: 'client',
        origin: 'client',
        files: preparedAttachment ? [preparedAttachment] : []
      });
      persistedAttachment = Boolean(preparedAttachment);
    }

    await createContactRequest(data);

    const outboundAttachment = persistedAttachment ? await moveContactAttachmentToOfferStorage(attachment) : attachment;

    await sendContactSubmissionEmails({
      payload: data,
      attachments: outboundAttachment ? [outboundAttachment] : [],
      clientMetadata,
      submissionEmail: data.email
    }).catch((error) => console.error('Nu s-a putut trimite emailul de contact:', error));

    return res.render('pages/contact-success', {
      title: 'Mesaj trimis cu succes',
      description: 'Solicitarea ta a fost înregistrată. Un consultant te va contacta în cel mai scurt timp.',
      generatedPassword: ensuredAccount.generatedPassword,
      submissionEmail: data.email,
      ticketId,
      ticketDisplayCode: displayCode
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      const message = error.errors?.[0]?.message || 'Completează corect toate câmpurile.';
      return renderContactPage(
        res,
        {
          error: message,
          request: { body: req.body }
        },
        400
      );
    }
    return next(error);
  } finally {
    if (req.file && !persistedAttachment) {
      await cleanupContactAttachment(req.file);
    }
  }
}

async function handleOfferPost(req, res, next) {
  try {
    await handleOfferSubmission(req, res);
  } catch (error) {
    if (!(error instanceof z.ZodError)) {
      return next(error);
    }
    const attachments = Array.isArray(req.files) ? req.files : [];
    await cleanupOfferFiles(attachments);
    setResponseCsrfToken(req, res);
    const errorMessage =
      error.errors?.[0]?.message || 'Verifică datele introduse și completează toate câmpurile obligatorii.';
    return renderOfferPage(res, { error: errorMessage }, 400);
  }
  return null;
}

async function handleOfferSubmission(req, res) {
  setResponseCsrfToken(req, res);
  const isAuthenticated = Boolean(req.session?.user);
  const payload = offerSubmissionSchema.parse(req.body);
  const attachments = Array.isArray(req.files) ? req.files : [];
  let generatedPassword = null;
  let userId;
  let submissionEmail = payload.email.toLowerCase();
  if (isAuthenticated) {
    const user = req.session.user;
    userId = user.id;
    submissionEmail = user.email.toLowerCase();
    if (user.fullName !== payload.clientName || user.phone !== payload.phone) {
      await updateUserProfile(user.id, { fullName: payload.clientName, phone: payload.phone });
      req.session.user.fullName = payload.clientName;
      req.session.user.phone = payload.phone;
    }
  } else {
    const ensured = await ensureClientAccount({
      fullName: payload.clientName,
      email: payload.email,
      phone: payload.phone
    });
    userId = ensured.userId;
    generatedPassword = ensured.generatedPassword;
  }
  const clientMetadata = collectClientMetadata(req);
  const attachmentSummary = formatAttachmentSummary(attachments);
  const metadataLine = clientMetadata.ipAddress ? `IP client: ${clientMetadata.ipAddress}` : null;
  const messageSegments = [
    `Tip lucrare: ${payload.workType}`,
    `Program de studii: ${payload.program}`,
    `Livrare dorită: ${payload.deliveryDate}`,
    `Detalii suplimentare: ${payload.notes || 'nespecificate'}`,
    attachmentSummary ? `Atașamente încărcate:\n${attachmentSummary}` : null,
    metadataLine
  ].filter(Boolean);
  const { id: ticketId, displayCode } = await createTicket({
    projectId: null,
    userId,
    subject: `Solicitare oferta - ${payload.topic}`,
    message: messageSegments.join('\n\n'),
    kind: 'offer',
    clientMetadata
  });
  const ticketPayload = {
    id: ticketId,
    display_code: displayCode,
    subject: `Solicitare oferta - ${payload.topic}`,
    message: messageSegments.join('\n\n')
  };
  if (attachments.length) {
    const uploaderRole = isAuthenticated ? req.session.user.role : 'client';
    const origin = uploaderRole === 'client' ? 'client' : 'staff';
    await saveTicketAttachments({
      ticketId,
      uploaderId: userId,
      uploaderRole,
      origin,
      files: attachments
    });
  }
  const authorInfo = isAuthenticated
    ? { id: userId, fullName: req.session.user.fullName, email: submissionEmail }
    : { id: userId, fullName: payload.clientName, email: submissionEmail };
  sendTicketCreatedNotification({
    ticket: ticketPayload,
    author: authorInfo,
    clientEmail: submissionEmail
  }).catch((error) => console.error('Nu s-a putut trimite notificarea de creare ticket (oferta):', error));
  const { offerCode } = await createOfferRequest({
    clientName: payload.clientName,
    userId,
    email: submissionEmail,
    phone: payload.phone,
    program: payload.program,
    topic: payload.topic,
    workType: payload.workType,
    deliveryDate: payload.deliveryDate,
    notes: payload.notes,
    ticketId
  });
  sendOfferSubmissionEmails({
    payload,
    submissionEmail,
    attachments,
    clientMetadata,
    ticketId,
    offerCode
  }).catch((error) => {
    console.error('Nu s-a putut trimite notificarea prin email:', error);
  });
  res.render('pages/offer-success', {
    title: 'Solicitarea a fost trimisă',
    description: 'Solicitarea ta a fost înregistrată și ai primit un email de confirmare.',
    offerCode,
    ticketId,
    generatedPassword,
    defaultExpiration: DEFAULT_OFFER_EXPIRATION_HOURS,
    submissionEmail
  });
}

router.get('/contract/:code', async (req, res, next) => {
  try {
    const offer = await getOfferByCode(req.params.code);
    if (!offer) {
      return res.status(404).render('pages/404', {
        title: 'Contract inexistent',
        description: 'Codul introdus nu corespunde niciunui contract generat.'
      });
    }
    return res.render('pages/contract', {
      title: `Contract ${offer.offer_code}`,
      description: 'Contract personalizat pentru serviciile de redactare licență.',
      offer,
      sanitizedContractHtml: sanitizeContractHtml(offer.contract_text || '')
    });
  } catch (error) {
    next(error);
  }
});

export default router;
