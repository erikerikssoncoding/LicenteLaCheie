import rateLimit from 'express-rate-limit';

const DEFAULT_WINDOW_MS = 15 * 60 * 1000;
const DEFAULT_MAX_ATTEMPTS = 8;
const GENERIC_ERROR_MESSAGE = 'Prea multe încercări. Te rugăm să încerci mai târziu.';

const authRateLimiter = rateLimit({
  windowMs: DEFAULT_WINDOW_MS,
  max: DEFAULT_MAX_ATTEMPTS,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: GENERIC_ERROR_MESSAGE },
  handler: (req, res) => {
    if (req.accepts('json') || req.is('application/json')) {
      return res.status(429).json({ error: GENERIC_ERROR_MESSAGE });
    }

    return res.status(429).send(GENERIC_ERROR_MESSAGE);
  }
});

export { authRateLimiter };
