import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import helmet from 'helmet';
import compression from 'compression';
import morgan from 'morgan';
import dotenv from 'dotenv';
import { promises as fs } from 'fs';
import sessionMiddleware from './config/session.js';
import publicRoutes from './routes/public.js';
import authRoutes from './routes/auth.js';
import dashboardRoutes from './routes/dashboard.js';
import { injectUser } from './middleware/auth.js';
import { startTicketInboxSync } from './services/mailService.js';
import simpleCookieParser from './middleware/simpleCookieParser.js';
import csrfProtection from './middleware/csrfProtection.js';
import { initializeSecurityState, getSecurityState } from './utils/securityState.js';
import { initializeLicenseState } from './utils/licenseState.js';
import { CONTACT_ATTACHMENT_ROOT, OFFER_ATTACHMENT_ROOT, PROJECT_UPLOAD_ROOT } from './utils/fileStorage.js';
import { DATE_TIME_TIMEZONE, formatDate, formatDateTime } from './utils/dateFormatter.js';

dotenv.config();

process.env.TZ = 'Europe/Bucharest';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

await initializeSecurityState();
await initializeLicenseState();
await Promise.all([
  fs.mkdir(PROJECT_UPLOAD_ROOT, { recursive: true }),
  fs.mkdir(OFFER_ATTACHMENT_ROOT, { recursive: true }),
  fs.mkdir(CONTACT_ATTACHMENT_ROOT, { recursive: true })
]);

const app = express();
const multipartCsrfBypassPaths = new Set(['/contact', '/oferta']);

app.set('trust proxy', 1);
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');
app.locals.formatDateTime = formatDateTime;
app.locals.formatDate = formatDate;
app.locals.appTimezone = DATE_TIME_TIMEZONE;

const baseHelmet = helmet({ contentSecurityPolicy: false });
const cspMiddleware = helmet.contentSecurityPolicy({
  useDefaults: true,
  directives: {
    "default-src": ["'self'"],
    "script-src": [
      "'self'",
      "'unsafe-inline'", // Permite scriptul din pagina HTML pentru buton
      "'unsafe-eval'",   // Necesar uneori pentru biblioteci complexe
      "https://cdn.jsdelivr.net",
      "https://www.googletagmanager.com",
      "https://www.google-analytics.com",
      "https://challenges.cloudflare.com", // Pentru Cloudflare
      "https://ajax.cloudflare.com"
    ],
    "script-src-elem": [ // Directivă specifică pentru scripturi <script>
      "'self'",
      "'unsafe-inline'",
      "https://cdn.jsdelivr.net",
      "https://www.googletagmanager.com",
      "https://www.google-analytics.com",
      "https://challenges.cloudflare.com",
      "https://ajax.cloudflare.com"
    ],
    "style-src": [
      "'self'",
      "'unsafe-inline'",
      "https://cdn.jsdelivr.net",
      "https://fonts.googleapis.com"
    ],
    "font-src": [
      "'self'",
      "data:",
      "https://fonts.gstatic.com",
      "https://cdn.jsdelivr.net"
    ],
    "img-src": [
      "'self'",
      "data:",
      "https://images.unsplash.com",
      "https://www.googletagmanager.com",
      "https://www.google-analytics.com"
    ],
    "connect-src": [
      "'self'",
      "https://www.google-analytics.com",
      "https://region1.google-analytics.com", // Aici era blocat Analytics în log-uri
      "https://cdn.jsdelivr.net",
      "https://cloudflare.com"
    ],
    "frame-src": [
      "'self'",
      "https://challenges.cloudflare.com"
    ],
    "upgrade-insecure-requests": []
  }
});

app.use((req, res, next) => baseHelmet(req, res, next));
app.use((req, res, next) => {
  if (!getSecurityState().csp) {
    return next();
  }
  return cspMiddleware(req, res, next);
});
app.use(compression());
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(morgan('combined'));
app.use(express.static(path.join(__dirname, '../public')));
app.use(simpleCookieParser);
app.use(sessionMiddleware);
app.use((req, res, next) => {
  if (req.method === 'POST' && multipartCsrfBypassPaths.has(req.path)) {
    return next();
  }
  return csrfProtection(req, res, next);
});
app.use(injectUser);

app.use((req, res, next) => {
  const forwardedProto = req.headers['x-forwarded-proto'];
  const proto = forwardedProto || req.protocol;

/*  if (getSecurityState().enforce_https && proto !== 'https') {
    return res.redirect(301, `https://${req.headers.host}${req.originalUrl}`);
  }*/

  return next();
});

app.use('/', publicRoutes);
app.use('/', authRoutes);
app.use('/', dashboardRoutes);

startTicketInboxSync();

app.use((req, res) => {
  res.status(404).render('pages/404', {
    title: 'Pagina nu a fost gasita',
    description: 'Pagina cautata nu exista sau a fost mutata.'
  });
});

app.use((err, req, res, next) => {
  // MODIFICARE: Logare sigură pentru a preveni "TypeError: Cannot read properties of undefined"
  try {
    console.error('--- Eroare Aplicație ---');
    console.error(err.message || 'Eroare fără mesaj');
    if (err.stack) console.error(err.stack);
  } catch (logError) {
    console.error('Eroare critică la afișarea erorii:', logError);
  }

  if (err.code === 'EBADCSRFTOKEN') {
    return res.status(403).render('pages/403', {
      title: 'Sesiune expirata',
      description: 'Formularul a expirat. Te rugam sa reincerci.',
      request: req,
      currentUser: req.session && req.session.user ? req.session.user : null
    });
  }
  const status = err.status || 500;
  const debugEnabled = getSecurityState().debug_mode;
  res.status(status).render('pages/500', {
    title: 'Eroare interna',
    description: 'A intervenit o problema neasteptata. Echipa tehnica a fost notificata.',
    debugDetails: debugEnabled
      ? {
          message: err.message,
          stack: err.stack
        }
      : null
  });
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Academia de Licențe pornit pe portul ${port}`);
});
