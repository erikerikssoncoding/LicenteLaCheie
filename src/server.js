import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import helmet from 'helmet';
import compression from 'compression';
import morgan from 'morgan';
import csrf from 'csurf';
import dotenv from 'dotenv';
import { promises as fs } from 'fs';
import sessionMiddleware from './config/session.js';
import publicRoutes from './routes/public.js';
import authRoutes from './routes/auth.js';
import dashboardRoutes from './routes/dashboard.js';
import { injectUser } from './middleware/auth.js';
import { initializeSecurityState, getSecurityState } from './utils/securityState.js';
import { initializeLicenseState } from './utils/licenseState.js';
import { CONTACT_ATTACHMENT_ROOT, OFFER_ATTACHMENT_ROOT, PROJECT_UPLOAD_ROOT } from './utils/fileStorage.js';

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

app.set('trust proxy', 1);
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');

const baseHelmet = helmet({ contentSecurityPolicy: false });
const cspMiddleware = helmet.contentSecurityPolicy({
  useDefaults: true,
  directives: {
    "img-src": ["'self'", 'data:', 'https://images.unsplash.com', 'https://i.ytimg.com'],
    "script-src": ["'self'", 'https://cdn.jsdelivr.net'],
    "style-src": ["'self'", 'https://cdn.jsdelivr.net', "'unsafe-inline'"],
    "connect-src": ["'self'"],
    "frame-src": ["'self'", 'https://www.youtube-nocookie.com']
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
app.use(sessionMiddleware);
app.use(csrf());
app.use(injectUser);

app.use((req, res, next) => {
  const proto = req.headers['x-forwarded-proto'];
  if (getSecurityState().enforce_https && proto && proto !== 'https') {
    return res.redirect(301, `https://${req.headers.host}${req.originalUrl}`);
  }
  return next();
});

app.use('/', publicRoutes);
app.use('/', authRoutes);
app.use('/', dashboardRoutes);

app.use((req, res) => {
  res.status(404).render('pages/404', {
    title: 'Pagina nu a fost gasita',
    description: 'Pagina cautata nu exista sau a fost mutata.'
  });
});

app.use((err, req, res, next) => {
  console.error(err);
  if (err.code === 'EBADCSRFTOKEN') {
    return res.status(403).render('pages/403', {
      title: 'Sesiune expirata',
      description: 'Formularul a expirat. Te rugam sa reincerci.',
      request: req
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
  console.log(`Licente la Cheie pornit pe portul ${port}`);
});
