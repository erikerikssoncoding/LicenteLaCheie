import { Router } from 'express';
import { z } from 'zod';
import { createClient, findUserByEmail, validatePassword } from '../services/userService.js';
import { ensureAuthenticated } from '../middleware/auth.js';
import { collectClientMetadata } from '../utils/requestMetadata.js';
import { getSessionCookieClearOptions, SESSION_COOKIE_NAME } from '../config/session.js';
import {
  createTrustedDevice,
  getTrustedDeviceCookieClearOptions,
  getTrustedDeviceCookieOptions,
  readTrustedDeviceToken,
  revokeTrustedDeviceByToken,
  TRUSTED_DEVICE_COOKIE_NAME
} from '../services/trustedDeviceService.js';

const router = Router();

router.get('/autentificare', (req, res) => {
  if (req.session?.user) {
    return res.redirect('/cont');
  }
  res.render('pages/login', {
    title: 'Autentificare cont client si echipa',
    description: 'Acceseaza panoul tau personalizat pentru a urmari proiectele de licenta si comunicarile.'
  });
});

router.post('/autentificare', async (req, res, next) => {
  try {
    const schema = z.object({
      email: z.string().email(),
      password: z.string().min(6),
      rememberDevice: z.enum(['on', '1', 'true']).optional()
    });
    const { email, password, rememberDevice } = schema.parse(req.body);
    const user = await findUserByEmail(email.toLowerCase());
    if (!user || !user.is_active) {
      return res.status(401).render('pages/login', {
        title: 'Autentificare cont client si echipa',
        description: 'Contul este inactiv sau datele nu sunt valide.',
        error: 'Contul tau este inactiv sau credentialele sunt invalide.'
      });
    }
    const isValid = await validatePassword(user, password);
    if (!isValid) {
      return res.status(401).render('pages/login', {
        title: 'Autentificare cont client si echipa',
        description: 'Email sau parola invalide.',
        error: 'Email sau parola invalide.'
      });
    }
    req.session.user = {
      id: user.id,
      email: user.email,
      fullName: user.full_name,
      role: user.role,
      phone: user.phone
    };
    if (rememberDevice) {
      const metadata = collectClientMetadata(req);
      const { token } = await createTrustedDevice({ userId: user.id, metadata });
      res.cookie(TRUSTED_DEVICE_COOKIE_NAME, token, getTrustedDeviceCookieOptions());
    } else {
      res.clearCookie(TRUSTED_DEVICE_COOKIE_NAME, getTrustedDeviceCookieClearOptions());
    }
    return res.redirect('/cont');
  } catch (error) {
    next(error);
  }
});

router.get('/inregistrare', (req, res) => {
  res.render('pages/register', {
    title: 'Creeaza cont pentru lucrari de licenta',
    description: 'Inregistreaza-te pentru a gestiona solicitarile, contractele si comunicarile cu echipa noastra.'
  });
});

router.post('/inregistrare', async (req, res, next) => {
  try {
    const schema = z
      .object({
        fullName: z.string().min(3),
        email: z.string().email(),
        phone: z.string().min(6),
        password: z.string().min(8),
        confirmPassword: z.string().min(8)
      })
      .refine((data) => data.password === data.confirmPassword, {
        message: 'Parolele nu coincid',
        path: ['confirmPassword']
      });
    const payload = schema.parse(req.body);
    const existing = await findUserByEmail(payload.email.toLowerCase());
    if (existing) {
      return res.status(409).render('pages/register', {
        title: 'Creeaza cont pentru lucrari de licenta',
        description: 'Emailul exista deja in platforma.',
        error: 'Emailul este deja folosit.'
      });
    }
    await createClient(payload);
    return res.render('pages/register-success', {
      title: 'Cont creat cu succes',
      description: 'Contul tau a fost creat. Te poti autentifica pentru a gestiona proiectele.'
    });
  } catch (error) {
    next(error);
  }
});

router.post('/deconectare', ensureAuthenticated, async (req, res, next) => {
  try {
    const trustedToken = readTrustedDeviceToken(req);
    if (trustedToken) {
      await revokeTrustedDeviceByToken(trustedToken);
    }
    req.session.destroy(() => {
      res.clearCookie(SESSION_COOKIE_NAME, getSessionCookieClearOptions());
      res.clearCookie(TRUSTED_DEVICE_COOKIE_NAME, getTrustedDeviceCookieClearOptions());
      res.redirect('/');
    });
  } catch (error) {
    next(error);
  }
});

export default router;
