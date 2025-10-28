import { Router } from 'express';
import { z } from 'zod';
import { createContactRequest } from '../services/contactService.js';
import { generateContractTemplate, createOffer, getOfferByCode } from '../services/offerService.js';

const router = Router();

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
      await createContactRequest(data);
      res.render('pages/contact-success', {
        title: 'Mesaj trimis cu succes',
        description: 'Solicitarea ta a fost inregistrata. Un consultant te va contacta in cel mai scurt timp.'
      });
    } catch (error) {
      next(error);
    }
  });

router
  .route('/oferta')
  .get((req, res) => {
    res.render('pages/offer', {
      title: 'Solicita o oferta personalizata pentru lucrarea de licenta',
      description:
        'Completeaza formularul pentru a primi o oferta si un contract personalizat pentru redactarea lucrarii tale de licenta.'
    });
  })
  .post(async (req, res, next) => {
    try {
      const schema = z.object({
        clientName: z.string().min(3),
        email: z.string().email(),
        phone: z.string().min(6),
        program: z.string().min(3),
        topic: z.string().min(5),
        deliveryDate: z.string().min(4),
        price: z.string().min(2),
        notes: z.string().optional()
      });
      const payload = schema.parse(req.body);
      const contractText = generateContractTemplate(payload);
      const { offerCode } = await createOffer({ ...payload, contractText });
      res.render('pages/offer-success', {
        title: 'Oferta generata',
        description: 'Am generat contractul personalizat pentru lucrarea ta.',
        offerCode,
        contractText
      });
    } catch (error) {
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
