import { logAdminAction } from '../services/adminLogService.js';

const TRACKED_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export function adminActionLogger(req, res, next) {
  const actor = req.session?.user;
  if (!actor || !['admin', 'superadmin'].includes(actor.role)) {
    return next();
  }
  if (!TRACKED_METHODS.has(req.method)) {
    return next();
  }

  const startedAt = Date.now();
  const details = {
    path: req.originalUrl,
    method: req.method,
    bodyKeys: Object.keys(req.body || {}).filter((key) => key !== '_csrf'),
    queryKeys: Object.keys(req.query || {})
  };

  res.on('finish', () => {
    if (req.skipAdminActionLog) {
      return;
    }
    const statusCode = res.statusCode;
    const durationMs = Date.now() - startedAt;
    const entryDetails = { ...details, statusCode, durationMs };
    logAdminAction({
      actor,
      action: `${req.method} ${req.originalUrl}`,
      details: entryDetails,
      statusCode,
      ipAddress: req.ip,
      userAgent: req.get?.('user-agent') || null
    }).catch((error) => {
      console.error('Nu s-a putut înregistra acțiunea administratorului', error);
    });
  });

  return next();
}
