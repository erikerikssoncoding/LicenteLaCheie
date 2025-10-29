import { getUserById } from '../services/userService.js';

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

export async function injectUser(req, res, next) {
  try {
    if (req.session?.user?.id) {
      const latestUser = await getUserById(req.session.user.id);
      if (!latestUser || !latestUser.is_active) {
        req.session.user = null;
      } else {
        req.session.user = {
          id: latestUser.id,
          email: latestUser.email,
          fullName: latestUser.full_name,
          role: latestUser.role,
          phone: latestUser.phone
        };
      }
    }
    res.locals.currentUser = req.session?.user || null;
    res.locals.csrfToken = req.csrfToken ? req.csrfToken() : null;
    res.locals.request = req;
    next();
  } catch (error) {
    next(error);
  }
}
