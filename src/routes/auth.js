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
import {
  generatePasskeyAuthenticationOptions,
  verifyPasskeyAuthentication
} from '../services/passkeyService.js';

const router = Router();

router.get('/autentificare', (req, res) => {
  if (req.session?.user) {
    return res.redirect('/cont');
  }
  res.render('pages/login', {
    title: 'Autentificare cont client și echipă',
    description: 'Accesează panoul tău personalizat pentru a urmări proiectele de licență și comunicările.'
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
        title: 'Autentificare cont client și echipă',
        description: 'Contul este inactiv sau datele nu sunt valide.',
        error: 'Contul tău este inactiv sau credențialele sunt invalide.'
      });
    }
    const isValid = await validatePassword(user, password);
    if (!isValid) {
      return res.status(401).render('pages/login', {
        title: 'Autentificare cont client și echipă',
        description: 'Email sau parolă invalide.',
        error: 'Email sau parolă invalide.'
      });
    }
    req.session.user = {
      id: user.id,
      email: user.email,
      fullName: user.full_name,
      role: user.role,
      phone: user.phone
    };

    const metadata = collectClientMetadata(req);
    const { token } = await createTrustedDevice({
      userId: user.id,
      metadata,
      label: rememberDevice ? null : 'Conectare fără memorare'
    });

    if (rememberDevice && user.role !== 'superadmin') {
      res.cookie(TRUSTED_DEVICE_COOKIE_NAME, token, getTrustedDeviceCookieOptions());
    } else {
      await revokeTrustedDeviceByToken(token);
      res.clearCookie(TRUSTED_DEVICE_COOKIE_NAME, getTrustedDeviceCookieClearOptions());
    }
    return res.redirect('/cont');
  } catch (error) {
    next(error);
  }
});

router.post('/autentificare/passkey', async (req, res, next) => {
  try {
    const schema = z.object({
      credential: z.any(),
      rememberDevice: z.enum(['on', '1', 'true']).optional(),
      email: z.string().email().optional()
    });
    const { credential, rememberDevice, email } = schema.parse(req.body);

    const expectedChallenge = req.session.passkeyLoginChallenge;
    const expectedEmail =
      typeof req.session.passkeyLoginEmail === 'string' ? req.session.passkeyLoginEmail : email || null;
    const rpID = (req.headers.host || 'localhost').split(':')[0];
    const origin = `${req.protocol}://${req.get('host')}`;

    const result = await verifyPasskeyAuthentication({
      credential,
      expectedChallenge,
      rpID,
      origin,
      expectedEmail
    });

    req.session.passkeyLoginChallenge = null;
    req.session.passkeyLoginEmail = null;

    req.session.user = result.user;

    const metadata = collectClientMetadata(req);
    const { token: deviceToken } = await createTrustedDevice({
      userId: result.user.id,
      metadata,
      label: 'Autentificare cu Passkey'
    });

    if (rememberDevice && result.user.role !== 'superadmin') {
      res.cookie(TRUSTED_DEVICE_COOKIE_NAME, deviceToken, getTrustedDeviceCookieOptions());
    } else {
      await revokeTrustedDeviceByToken(deviceToken);
      res.clearCookie(TRUSTED_DEVICE_COOKIE_NAME, getTrustedDeviceCookieClearOptions());
    }

    return res.json({ ok: true, redirect: '/cont' });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'INVALID_PASSKEY_PAYLOAD' });
    }
    if (
      error.message === 'PASSKEY_CHALLENGE_MISSING' ||
      error.message === 'PASSKEY_VERIFICATION_FAILED'
    ) {
      return res.status(401).json({ error: error.message });
    }
    if (error.message === 'PASSKEY_NOT_FOUND') {
      return res.status(404).json({ error: error.message });
    }
    if (error.message === 'PASSKEY_USER_MISMATCH') {
      return res.status(403).json({ error: error.message });
    }
    next(error);
  } finally {
    req.session.passkeyLoginChallenge = null;
    req.session.passkeyLoginEmail = null;
  }
});

router.post('/autentificare/passkey/options', async (req, res, next) => {
  try {
    const schema = z.object({ email: z.string().email().optional() });
    const data = schema.parse(req.body || {});

    const rpID = (req.headers.host || 'localhost').split(':')[0];
    const options = await generatePasskeyAuthenticationOptions({ rpID, userEmail: data.email });

    req.session.passkeyLoginChallenge = options.challenge;
    req.session.passkeyLoginEmail = data.email || null;

    res.json(options);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'INVALID_PASSKEY_PAYLOAD' });
    }
    next(error);
  }
});

router.get('/inregistrare', (req, res) => {
  res.render('pages/register', {
    title: 'Creează cont pentru lucrări de licență',
    description: 'Înregistrează-te pentru a gestiona solicitările, contractele și comunicările cu echipa noastră.'
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
        title: 'Creează cont pentru lucrări de licență',
        description: 'Emailul există deja în platformă.',
        error: 'Emailul este deja folosit.'
      });
    }
    await createClient(payload);
    return res.render('pages/register-success', {
      title: 'Cont creat cu succes',
      description: 'Contul tău a fost creat. Te poți autentifica pentru a gestiona proiectele.'
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
