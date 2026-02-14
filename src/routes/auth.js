import { Router } from 'express';
import { z } from 'zod';
import {
  createClient,
  findUserByEmail,
  getUserById,
  validatePassword,
  resetPasswordWithToken
} from '../services/userService.js';
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
import { sendRegistrationCredentialsEmail } from '../services/mailService.js';
import { consumeOneTimeLoginToken } from '../services/loginLinkService.js';
import { createPasswordResetToken, consumePasswordResetToken } from '../services/passwordResetService.js';
import { sendPasswordResetEmail } from '../services/mailService.js';
import { authRateLimiter } from '../middleware/rateLimit.js';

const router = Router();

function normalizePasskeyContext(req) {
  const rpID = process.env.PASSKEY_RP_ID || req.hostname || req.get('host') || 'localhost';
  const rpName = process.env.PASSKEY_RP_NAME || 'LicențeLaCheie';
  const host = req.get('host') || req.hostname || rpID;
  const protocol = req.protocol === 'https' ? 'https' : 'http';
  return {
    rpID,
    rpName,
    origin: `${protocol}://${host}`
  };
}

function buildSessionUser(user) {
  return {
    id: user.id,
    email: user.email,
    fullName: user.full_name || user.fullName,
    role: user.role,
    phone: user.phone
  };
}

function establishAuthenticatedSession(req, user) {
  return new Promise((resolve, reject) => {
    req.session.regenerate((error) => {
      if (error) {
        return reject(error);
      }
      req.session.user = buildSessionUser(user);
      resolve();
    });
  });
}

router.get('/autentificare', (req, res) => {
  if (req.session?.user) {
    return res.redirect('/cont');
  }
  const rawResetToken = req.query.resetToken || req.query.token || '';
  const resetToken = typeof rawResetToken === 'string' ? rawResetToken : '';
  res.render('pages/login', {
    title: 'Autentificare cont client și echipă',
    description: 'Accesează panoul tău personalizat pentru a urmări proiectele de licență și comunicările.',
    resetToken
  });
});

router.get('/autentificare/link/:token', async (req, res, next) => {
  try {
    const payload = await consumeOneTimeLoginToken(req.params.token);
    if (!payload) {
      return res.status(410).render('pages/login', {
        title: 'Autentificare cont client și echipă',
        description: 'Linkul de acces nu mai este disponibil.',
        error: 'Linkul de autentificare nu mai este valid. Te rugăm să folosești emailul și parola.'
      });
    }
    const user = await getUserById(payload.userId);
    if (!user || !user.is_active) {
      return res.status(410).render('pages/login', {
        title: 'Autentificare cont client și echipă',
        description: 'Contul asociat linkului nu mai este activ.',
        error: 'Contul este dezactivat sau inexistent.'
      });
    }
    await establishAuthenticatedSession(req, user);
    return res.redirect('/cont');
  } catch (error) {
    next(error);
  }
});

router.post('/autentificare', authRateLimiter, async (req, res, next) => {
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
    await establishAuthenticatedSession(req, user);

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

router.post('/autentificare/resetare', authRateLimiter, async (req, res, next) => {
  try {
    const schema = z.object({ email: z.string().email() });
    const { email } = schema.parse(req.body);
    const normalizedEmail = email.toLowerCase();
    const user = await findUserByEmail(normalizedEmail);
    const genericResponse = {
      success: true,
      message: 'Dacă există un cont activ, vei primi un email cu instrucțiuni de resetare.'
    };
    if (!user || !user.is_active) {
      return res.json(genericResponse);
    }
    const { token, expiresAt } = await createPasswordResetToken(user.id);
    await sendPasswordResetEmail({ user, token, expiresAt }).catch((error) =>
      console.error('Nu s-a putut trimite emailul de resetare:', error)
    );
    return res.json(genericResponse);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Te rugăm să introduci un email valid.' });
    }
    next(error);
  }
});

router.post('/autentificare/resetare/confirma', authRateLimiter, async (req, res, next) => {
  try {
    const schema = z.object({
      token: z.string().min(10),
      password: z.string().min(8)
    });
    const { token, password } = schema.parse(req.body);
    const payload = await consumePasswordResetToken(token);
    if (!payload) {
      return res.status(400).json({ error: 'Linkul de resetare nu mai este valid sau a expirat.' });
    }
    const user = await getUserById(payload.userId);
    if (!user || !user.is_active) {
      return res.status(400).json({ error: 'Contul nu este activ.' });
    }
    await resetPasswordWithToken({ userId: user.id, newPassword: password });
    return res.json({ success: true, message: 'Parola a fost actualizată. Te poți autentifica cu noua parolă.' });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Datele trimise nu sunt valide.' });
    }
    next(error);
  }
});

router.get('/autentificare/passkey/options', async (req, res, next) => {
  try {
    const passkeyContext = normalizePasskeyContext(req);
    const options = await generatePasskeyAuthenticationOptions({
      rpID: passkeyContext.rpID,
      rpName: passkeyContext.rpName
    });
    req.session.passkeyChallenge = options.challenge;
    res.json(options);
  } catch (error) {
    next(error);
  }
});

router.post('/autentificare/passkey/verify', authRateLimiter, async (req, res, next) => {
  try {
    const passkeyContext = normalizePasskeyContext(req);
    const expectedChallenge = req.session.passkeyChallenge;

    if (!expectedChallenge) {
      return res.status(400).json({ error: 'Sesiune expirată. Reîncarcă pagina.' });
    }

    const { verified, user } = await verifyPasskeyAuthentication({
      response: req.body,
      expectedChallenge,
      rpID: passkeyContext.rpID,
      origin: passkeyContext.origin
    });

    if (verified && user) {
      if (!user.is_active) {
        return res.status(401).json({ error: 'Contul este dezactivat.' });
      }

      await establishAuthenticatedSession(req, user);

      delete req.session.passkeyChallenge;

      return res.json({ success: true, redirect: '/cont' });
    }
  } catch (error) {
    console.error(error);
    res.status(400).json({ error: 'Autentificare eșuată.' });
  }
});

router.get('/inregistrare', (req, res) => {
  res.render('pages/register', {
    title: 'Creează cont pentru lucrări de licență',
    description: 'Înregistrează-te pentru a gestiona solicitările, contractele și comunicările cu echipa noastră.'
  });
});

router.post('/inregistrare', authRateLimiter, async (req, res, next) => {
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
    const userId = await createClient(payload);
    await sendRegistrationCredentialsEmail({
      fullName: payload.fullName,
      email: payload.email,
      password: payload.password,
      userId
    }).catch((error) => console.error('Nu s-a putut trimite emailul cu credențiale:', error));
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
