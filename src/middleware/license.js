import { getLicenseState } from '../utils/licenseState.js';

const DEFAULT_RESTRICTED_ROLES = new Set(['admin', 'redactor']);

function shouldRenderJson(req) {
  const acceptHeader = req.headers.accept || '';
  return acceptHeader.includes('application/json') || req.xhr;
}

export function requireActiveLicense(options = {}) {
  const {
    roles = null,
    allowSuperadmin = true
  } = options;
  const rolesSet = roles ? new Set(roles) : DEFAULT_RESTRICTED_ROLES;
  return (req, res, next) => {
    const user = req.session?.user;
    if (!user) {
      return res.redirect('/autentificare');
    }
    if (allowSuperadmin && user.role === 'superadmin') {
      return next();
    }
    if (rolesSet && !rolesSet.has(user.role)) {
      return next();
    }
    const state = getLicenseState();
    if (!state.isExpired) {
      return next();
    }
    if (shouldRenderJson(req)) {
      return res.status(403).json({
        error: 'LICENSE_EXPIRED',
        message: 'Licenta platformei a expirat. Contacteaza superadministratorul pentru reinnoire.'
      });
    }
    return res.status(403).render('pages/license-expired', {
      title: 'Licenta expirata',
      description: 'Functionalitatea selectata este indisponibila pana la reinnoirea licentei.',
      licenseState: state,
      currentUser: user
    });
  };
}
