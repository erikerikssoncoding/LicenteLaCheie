export function ensureAuthenticated(req, res, next) {
  if (req.session?.user) {
    return next();
  }
  return res.redirect('/autentificare');
}

export function ensureRole(...roles) {
  return (req, res, next) => {
    if (!req.session?.user) {
      return res.redirect('/autentificare');
    }
    if (!roles.includes(req.session.user.role)) {
      return res.status(403).render('pages/403', {
        title: 'Acces interzis',
        description: 'Nu aveti permisiuni suficiente pentru aceasta resursa.',
        user: req.session.user
      });
    }
    return next();
  };
}

export function injectUser(req, res, next) {
  res.locals.currentUser = req.session?.user || null;
  res.locals.csrfToken = req.csrfToken ? req.csrfToken() : null;
  res.locals.request = req;
  next();
}
