export default function simpleCookieParser(req, res, next) {
  if (req.cookies) {
    return next();
  }

  const header = req.headers?.cookie;
  if (!header) {
    req.cookies = {};
    return next();
  }

  const parsedCookies = {};

  for (const rawCookie of header.split(';')) {
    const separatorIndex = rawCookie.indexOf('=');
    if (separatorIndex === -1) {
      continue;
    }

    const name = rawCookie.slice(0, separatorIndex).trim();
    if (!name) {
      continue;
    }

    const value = rawCookie.slice(separatorIndex + 1).trim();

    try {
      parsedCookies[name] = decodeURIComponent(value);
    } catch (error) {
      parsedCookies[name] = value;
    }
  }

  req.cookies = parsedCookies;
  next();
}
