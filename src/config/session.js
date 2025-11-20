import session from 'express-session';
import MySQLStoreFactory from 'express-mysql-session';
import dotenv from 'dotenv';

dotenv.config();

const MySQLStore = MySQLStoreFactory(session);

const sessionSecret = process.env.SESSION_SECRET;

if (!sessionSecret) {
  throw new Error('SESSION_SECRET nu este setat. Configurati o valoare puternica in mediul de rulare.');
}

const sessionStore = new MySQLStore({
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'licentelacheie',
  clearExpired: true,
  checkExpirationInterval: 900000,
  expiration: 86400000,
  createDatabaseTable: true,
  schema: {
    tableName: 'sessions',
    columnNames: {
      session_id: 'session_id',
      expires: 'expires',
      data: 'data'
    }
  }
});

const SESSION_COOKIE_DOMAIN = process.env.APP_COOKIE_DOMAIN || null;
export const SESSION_COOKIE_NAME = process.env.SESSION_COOKIE_NAME || 'licentelacheie.sid';

const BASE_SESSION_COOKIE_OPTIONS = Object.freeze({
  httpOnly: true,
  sameSite: 'lax',
  secure: process.env.NODE_ENV === 'production',
  maxAge: 1000 * 60 * 60 * 24,
  path: '/',
  ...(SESSION_COOKIE_DOMAIN ? { domain: SESSION_COOKIE_DOMAIN } : {})
});

export function getSessionCookieOptions() {
  return { ...BASE_SESSION_COOKIE_OPTIONS };
}

export function getSessionCookieClearOptions() {
  const options = getSessionCookieOptions();
  delete options.maxAge;
  options.expires = new Date(0);
  return options;
}

export default session({
  secret: sessionSecret,
  name: SESSION_COOKIE_NAME,
  resave: false,
  saveUninitialized: false,
  store: sessionStore,
  cookie: getSessionCookieOptions()
});
