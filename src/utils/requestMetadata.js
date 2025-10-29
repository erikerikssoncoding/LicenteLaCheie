import crypto from 'crypto';

function extractHeader(req, name) {
  const value = req.get ? req.get(name) : req.headers?.[name.toLowerCase()];
  if (!value) {
    return null;
  }
  if (Array.isArray(value)) {
    return value.join(', ');
  }
  return String(value);
}

function extractForwardedFor(req) {
  const header = req.headers?.['x-forwarded-for'];
  if (!header) {
    return { primary: null, chain: [] };
  }
  const values = Array.isArray(header) ? header : String(header).split(',');
  const chain = values
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
  if (chain.length === 0) {
    return { primary: null, chain: [] };
  }
  return { primary: chain[0], chain };
}

function extractIp(req, forwardedPrimary) {
  if (forwardedPrimary) {
    return forwardedPrimary;
  }
  const directIp =
    req.ip ||
    req.connection?.remoteAddress ||
    req.socket?.remoteAddress ||
    req.connection?.socket?.remoteAddress ||
    null;
  if (!directIp) {
    return null;
  }
  return directIp.startsWith('::ffff:') ? directIp.slice(7) : directIp;
}

function buildClientHints(req) {
  const hints = [
    ['sec-ch-ua', extractHeader(req, 'sec-ch-ua')],
    ['sec-ch-ua-mobile', extractHeader(req, 'sec-ch-ua-mobile')],
    ['sec-ch-ua-platform', extractHeader(req, 'sec-ch-ua-platform')],
    ['sec-ch-ua-model', extractHeader(req, 'sec-ch-ua-model')]
  ].filter(([, value]) => Boolean(value));
  if (!hints.length) {
    return null;
  }
  return hints.map(([key, value]) => `${key}=${value}`).join('; ');
}

export function collectClientMetadata(req) {
  const forwarded = extractForwardedFor(req);
  const ipAddress = extractIp(req, forwarded.primary);
  const userAgent = extractHeader(req, 'user-agent');
  const acceptLanguage = extractHeader(req, 'accept-language');
  const referer = extractHeader(req, 'referer') || extractHeader(req, 'referrer');
  const sessionId = req.sessionID || req.session?.id || null;
  const providedFingerprint = extractHeader(req, 'x-client-fingerprint');
  const clientHints = buildClientHints(req);

  const fingerprintSeed = [
    providedFingerprint,
    sessionId,
    userAgent,
    acceptLanguage,
    clientHints,
    ipAddress
  ].filter(Boolean);
  const fingerprint = fingerprintSeed.length
    ? crypto.createHash('sha256').update(fingerprintSeed.join('||')).digest('hex')
    : null;

  const extraData = {
    providedFingerprint: providedFingerprint || null,
    forwardedChain: forwarded.chain && forwarded.chain.length > 1 ? forwarded.chain : null,
    xRealIp: extractHeader(req, 'x-real-ip'),
    cfConnectingIp: extractHeader(req, 'cf-connecting-ip'),
    requestId: extractHeader(req, 'x-request-id'),
    timezone: extractHeader(req, 'x-timezone'),
    host: extractHeader(req, 'host')
  };

  Object.keys(extraData).forEach((key) => {
    if (extraData[key] === null || extraData[key] === undefined || extraData[key] === '') {
      delete extraData[key];
    }
  });

  return {
    fingerprint,
    ipAddress,
    forwardedFor: forwarded.chain.length ? forwarded.chain.join(', ') : null,
    userAgent,
    acceptLanguage,
    sessionId,
    referer,
    clientHints,
    extraData: Object.keys(extraData).length ? extraData : null
  };
}
