import { Router } from 'express';
import { z } from 'zod';
import { createContactRequest } from '../services/contactService.js';
import {
  createOfferRequest,
  getOfferByCode,
  DEFAULT_OFFER_EXPIRATION_HOURS
} from '../services/offerService.js';
import { ensureClientAccount, updateUserProfile } from '../services/userService.js';
import { createTicket } from '../services/ticketService.js';

const router = Router();

const MINIMUM_DELIVERY_LEAD_DAYS = 14;

const OFFER_WORK_TYPES = [
  'lucrare de licenta',
  'lucrare de grad',
  'lucrare de disertatie',
  'lucrare de doctorat',
  'proiect'
];

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
      if (req.session?.user) {
        const user = req.session.user;
        if (user.fullName !== data.fullName || user.phone !== data.phone) {
          await updateUserProfile(user.id, { fullName: data.fullName, phone: data.phone });
          req.session.user.fullName = data.fullName;
          req.session.user.phone = data.phone;
        }
        await createTicket({
          projectId: null,
          userId: user.id,
          subject: `Solicitare contact - ${data.fullName}`,
          message: `Telefon: ${data.phone}\nEmail: ${user.email}\n\n${data.message}`,
          kind: 'support'
        });
        return res.render('pages/contact-success', {
          title: 'Ticket deschis cu succes',
          description: 'Am inregistrat solicitarea ta direct in cont. Echipa noastra iti va raspunde in cel mai scurt timp.'
        });
      }
      await createContactRequest(data);
      return res.render('pages/contact-success', {
        title: 'Mesaj trimis cu succes',
        description: 'Solicitarea ta a fost inregistrata. Un consultant te va contacta in cel mai scurt timp.'
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
  .get((req, res) => {
    res.render('pages/offer', {
      title: 'Solicita o oferta personalizata pentru lucrarea de licenta',
      description:
        'Completeaza formularul pentru a primi o oferta si un contract personalizat pentru redactarea lucrarii tale de licenta.',
      minDeliveryDate: formatDateForInput(getMinimumDeliveryDate())
    });
  })
  .post(async (req, res, next) => {
    try {
      const isAuthenticated = Boolean(req.session?.user);
      const schema = z.object({
        clientName: z.string().min(3),
        email: z.string().email(),
        phone: z.string().min(6),
        program: z.string().min(3),
        topic: z.string().min(5),
        workType: z.enum(OFFER_WORK_TYPES),
        deliveryDate: z
          .string()
          .regex(/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/u, 'Selecteaza o data de livrare valida (format AAAA-LL-ZZ).')
          .refine((value) => {
            const parsed = parseDateInput(value);
            if (!parsed) {
              return false;
            }
            const minimum = getMinimumDeliveryDate();
            return parsed >= minimum;
          }, `Data dorita de livrare trebuie sa fie la cel putin ${MINIMUM_DELIVERY_LEAD_DAYS} zile distanta de astazi.`),
        notes: z.string().optional(),
        acceptAccount: isAuthenticated ? z.any().optional() : z.literal('on')
      });
      const payload = schema.parse(req.body);
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
      const ticketId = await createTicket({
        projectId: null,
        userId,
        subject: `Solicitare oferta - ${payload.topic}`,
        message: `Tip lucrare: ${payload.workType}\nProgram de studiu: ${payload.program}\nLivrare dorita: ${
          payload.deliveryDate
        }\nDetalii suplimentare: ${payload.notes || 'nespecificate'}`,
        kind: 'offer'
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
      res.render('pages/offer-success', {
        title: 'Oferta generata',
        description:
          'Solicitarea ta a fost inregistrata. Vei primi oferta personalizata in contul tau Licente la Cheie.',
        offerCode,
        ticketId,
        generatedPassword,
        defaultExpiration: DEFAULT_OFFER_EXPIRATION_HOURS,
        submissionEmail
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        const errorMessage =
          error.errors?.[0]?.message ||
          'Verifica datele introduse si completeaza toate campurile obligatorii.';
        return res.status(400).render('pages/offer', {
          title: 'Solicita o oferta personalizata pentru lucrarea de licenta',
          description:
            'Completeaza formularul pentru a primi o oferta si un contract personalizat pentru redactarea lucrarii tale de licenta.',
          error: errorMessage,
          minDeliveryDate: formatDateForInput(getMinimumDeliveryDate())
        });
      }
      next(error);
    }
  });

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
