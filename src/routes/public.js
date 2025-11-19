import { Router } from 'express';
import { promises as fs } from 'fs';
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
import { sendOfferSubmissionEmails } from '../services/mailService.js';
import { collectClientMetadata } from '../utils/requestMetadata.js';
import { OFFER_ATTACHMENT_ROOT, buildStoredFileName } from '../utils/fileStorage.js';

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
const PHONE_PATTERN = /^(?:\+?40|0)[23789][0-9]{8}$/u;
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

async function cleanupOfferFiles(files = []) {
  await Promise.all(
    files.map((file) =>
      fs.unlink(file.path).catch(() => {
        return null;
      })
    )
  );
}

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

const sanitizePhoneValue = (value) => value.replace(/\s+/g, '');

const hasInvalidRepetition = (value) => {
  const digits = value.replace(/\D/g, '').slice(-9);
  if (!digits || digits.length < 6) {
    return false;
  }
  return /^([0-9])\1+$/u.test(digits);
};

router.get('/', (req, res) => {
  res.render('pages/home', {
    title: 'Lucrari de licenta premium redactate de experti',
    description:
      'Licente la Cheie ofera servicii profesionale de redactare, consultanta si verificare pentru lucrari de licenta, dizertatii si proiecte academice.'
  });
});

router.get('/despre-noi', (req, res) => {
  res.render('pages/about', {
    title: 'Despre echipa noastra',
    description:
      'Afla cum echipa Licente la Cheie ii ghideaza pe studenti catre finalizarea cu succes a lucrarilor de licenta si a proiectelor de absolvire.'
  });
});

router.get('/servicii', (req, res) => {
  res.render('pages/services', {
    title: 'Servicii pentru lucrari de licenta si proiecte academice',
    description:
      'Consultanta, redactare personalizata si verificari antiplagiat pentru lucrari de licenta si disertatii.'
  });
});

router
  .route('/contact')
  .get((req, res) => {
    res.render('pages/contact', {
      title: 'Contact Licente la Cheie',
      description:
        'Scrie-ne pentru a afla cum te putem ajuta cu redactarea lucrarii de licenta sau a proiectului tau academic.'
    });
  })
  .post(async (req, res, next) => {
    try {
      const schema = z.object({
        fullName: z.string().min(3),
        email: z.string().email(),
        phone: z.string().min(6),
        message: z.string().min(10)
      });
      const data = schema.parse(req.body);
      const clientMetadata = collectClientMetadata(req);
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
          description: 'Am inregistrat solicitarea ta direct in cont. Echipa noastra iti va raspunde in cel mai scurt timp.',
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
      return res.render('pages/contact-success', {
        title: 'Mesaj trimis cu succes',
        description: 'Solicitarea ta a fost inregistrata. Un consultant te va contacta in cel mai scurt timp.',
        generatedPassword: ensuredAccount.generatedPassword,
        submissionEmail: data.email,
        ticketId,
        ticketDisplayCode: displayCode
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).render('pages/contact', {
          title: 'Contact Licente la Cheie',
          description:
            'Scrie-ne pentru a afla cum te putem ajuta cu redactarea lucrarii de licenta sau a proiectului tau academic.',
          error: 'Completeaza corect toate campurile pentru a trimite mesajul.'
        });
      }
      next(error);
    }
  });

router
  .route('/oferta')
  .get((req, res) => renderOfferPage(res))
  .post((req, res, next) => {
    offerAttachmentUpload.array('attachments', OFFER_ATTACHMENT_MAX_FILES)(req, res, async (uploadError) => {
      if (uploadError) {
        const attachments = Array.isArray(req.files) ? req.files : [];
        await cleanupOfferFiles(attachments);
        return renderOfferPage(res, { error: mapUploadError(uploadError) }, 400);
      }
      try {
        await handleOfferSubmission(req, res);
      } catch (error) {
        if (!(error instanceof z.ZodError)) {
          return next(error);
        }
        const attachments = Array.isArray(req.files) ? req.files : [];
        await cleanupOfferFiles(attachments);
        const errorMessage =
          error.errors?.[0]?.message || 'Verifică datele introduse și completează toate câmpurile obligatorii.';
        return renderOfferPage(res, { error: errorMessage }, 400);
      }
    });
  });

async function handleOfferSubmission(req, res) {
  const isAuthenticated = Boolean(req.session?.user);
  const schema = z.object({
    clientName: z.string().trim().min(3, 'Introduce un nume complet valid.'),
    email: z.string().trim().email('Te rugăm să introduci o adresă de email validă.'),
    phone: z
      .string()
      .min(6)
      .transform((value) => sanitizePhoneValue(value))
      .regex(PHONE_PATTERN, 'Introdu un număr de telefon din România cu prefix valid.')
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
