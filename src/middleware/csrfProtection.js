import csrf from 'csurf';
import dotenv from 'dotenv';

dotenv.config();

const APP_COOKIE_DOMAIN = process.env.APP_COOKIE_DOMAIN || null;
const CSRF_COOKIE_NAME = process.env.CSRF_COOKIE_NAME || 'academiadelicente.csrf';
const isProduction = process.env.NODE_ENV === 'production';

const csrfProtection = csrf({
  cookie: {
    key: CSRF_COOKIE_NAME,
    httpOnly: true,
    sameSite: 'lax',
    secure: isProduction,
    path: '/',
    ...(APP_COOKIE_DOMAIN ? { domain: APP_COOKIE_DOMAIN } : {})
  }
});

export default csrfProtection;
