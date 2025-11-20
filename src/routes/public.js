import { Router } from 'express';
import { promises as fs } from 'fs';
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
import { createTicket } from '../services/ticketService.js';
import { sendContactSubmissionEmails, sendOfferSubmissionEmails } from '../services/mailService.js';
import { collectClientMetadata } from '../utils/requestMetadata.js';
import { CONTACT_ATTACHMENT_ROOT, OFFER_ATTACHMENT_ROOT, buildStoredFileName } from '../utils/fileStorage.js';
import csrfProtection from '../middleware/csrfProtection.js';

const require = createRequire(import.meta.url);
const phonePrefixData = require('../../public/data/phone-prefixes.json');

const router = Router();

const MINIMUM_DELIVERY_LEAD_DAYS = 14;
const OFFER_ATTACHMENT_MAX_FILES = 5;
const OFFER_ATTACHMENT_MAX_SIZE = 8 * 1024 * 1024; // 8 MB
const OFFER_ALLOWED_MIME_TYPES = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/zip',
  'application/x-zip-compressed',
  'application/x-rar-compressed',
  'application/x-7z-compressed',
  'text/plain',
  'text/csv',
  'application/json',
  'image/jpeg',
  'image/png'
]);
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
  'Completează formularul iar platforma va genera un draft de contract pentru redactarea, corectura și pregătirea lucrării tale.';

const OFFER_WORK_TYPES = [
  'lucrare de licenta',
  'lucrare de grad',
  'lucrare de disertatie',
  'lucrare de doctorat',
  'proiect'
];

const offerAttachmentStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, OFFER_ATTACHMENT_ROOT),
  filename: (req, file, cb) => cb(null, buildStoredFileName(file.originalname))
});

const offerAttachmentUpload = multer({
  storage: offerAttachmentStorage,
  limits: { fileSize: OFFER_ATTACHMENT_MAX_SIZE, files: OFFER_ATTACHMENT_MAX_FILES },
  fileFilter: (req, file, cb) => {
    if (OFFER_ALLOWED_MIME_TYPES.has(file.mimetype)) {
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
    'Scrie-ne pentru a afla cum te putem ajuta cu redactarea lucrarii de licenta sau a proiectului tau academic.'
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
    title: 'Lucrari de licenta premium redactate de experti',
    description:
      'Academia de Licențe ofera servicii profesionale de redactare, consultanta si verificare pentru lucrari de licenta, dizertatii si proiecte academice.'
  });
});

router.get('/despre-noi', (req, res) => {
  res.render('pages/about', {
    title: 'Despre echipa noastra',
    description:
      'Afla cum echipa Academia de Licențe ii ghideaza pe studenti catre finalizarea cu succes a lucrarilor de licenta si a proiectelor de absolvire.'
  });
});

router.get('/servicii', (req, res) => {
  res.render('pages/services', {
    title: 'Servicii pentru lucrari de licenta si proiecte academice',
    description:
      'Consultanta, redactare personalizata si verificari antiplagiat pentru lucrari de licenta si disertatii.'
  });
});

router.get('/termeni-si-conditii', (req, res) => {
  res.render('pages/terms', {
    title: 'Termeni si conditii - Academia de Licente',
    description:
      'Aflati conditiile de utilizare ale platformei Academia de Licente, responsabilitatile partilor si regulile de furnizare a serviciilor.'
  });
});

router.get('/politica-confidentialitate', (req, res) => {
  res.render('pages/privacy', {
    title: 'Politica de confidentialitate - Academia de Licente',
    description:
      'Informatii despre modul in care colectam, folosim si protejam datele personale in platforma Academia de Licente.'
  });
});

router.get('/politica-cookie', (req, res) => {
  res.render('pages/cookies', {
    title: 'Politica privind cookies - Academia de Licente',
    description:
      'Detalii privind tipurile de cookie-uri folosite pe site-ul academiadelicente.ro si optiunile de control disponibile utilizatorilor.'
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
  .post(offerAttachmentUpload.array('attachments', OFFER_ATTACHMENT_MAX_FILES), csrfProtection, handleOfferPost);

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

    await createContactRequest(data);

    await sendContactSubmissionEmails({
      payload: data,
      attachments: attachment ? [attachment] : [],
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
    if (req.file) {
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
  const schema = z.object({
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
      .optional(),
    acceptAccount: isAuthenticated ? z.any().optional() : z.literal('on')
  });
  const payload = schema.parse(req.body);
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
  const { id: ticketId } = await createTicket({
    projectId: null,
    userId,
    subject: `Solicitare oferta - ${payload.topic}`,
    message: messageSegments.join('\n\n'),
    kind: 'offer',
    clientMetadata
  });
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
      description: 'Contract personalizat pentru serviciile de redactare licenta.',
      offer
    });
  } catch (error) {
    next(error);
  }
});

export default router;
