import { getUserById, updateUserLastSeen } from '../services/userService.js';
import { collectClientMetadata } from '../utils/requestMetadata.js';
import { getLicenseState } from '../utils/licenseState.js';
import {
  findTrustedDeviceByToken,
  getTrustedDeviceCookieClearOptions,
  getTrustedDeviceCookieOptions,
  readTrustedDeviceToken,
  revokeTrustedDeviceByToken,
  rotateTrustedDeviceToken,
  touchTrustedDevice,
  TRUSTED_DEVICE_COOKIE_NAME
} from '../services/trustedDeviceService.js';

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
    const existingSessionUserId = req.session?.user?.id || null;
    let trustedToken = readTrustedDeviceToken(req);
    let trustedDevice = null;
    let restoredFromTrustedDevice = false;
    if (trustedToken) {
      trustedDevice = await findTrustedDeviceByToken(trustedToken);
      if (!trustedDevice) {
        res.clearCookie(TRUSTED_DEVICE_COOKIE_NAME, getTrustedDeviceCookieClearOptions());
        trustedToken = null;
      }
    }

    let latestUser = null;

    if (!existingSessionUserId && trustedDevice) {
      latestUser = await getUserById(trustedDevice.user_id);
      if (!latestUser || !latestUser.is_active) {
        await revokeTrustedDeviceByToken(trustedToken);
        res.clearCookie(TRUSTED_DEVICE_COOKIE_NAME, getTrustedDeviceCookieClearOptions());
        trustedDevice = null;
      } else {
        req.session.user = {
          id: latestUser.id,
          email: latestUser.email,
          fullName: latestUser.full_name,
          role: latestUser.role,
          phone: latestUser.phone
        };
        restoredFromTrustedDevice = true;
        req.currentTrustedDeviceId = trustedDevice.id;
        const metadata = collectClientMetadata(req);
        const rotatedToken = await rotateTrustedDeviceToken(trustedDevice.id, metadata);
        if (rotatedToken) {
          trustedToken = rotatedToken;
          res.cookie(TRUSTED_DEVICE_COOKIE_NAME, rotatedToken, getTrustedDeviceCookieOptions());
        } else {
          await revokeTrustedDeviceByToken(trustedToken);
          res.clearCookie(TRUSTED_DEVICE_COOKIE_NAME, getTrustedDeviceCookieClearOptions());
          trustedDevice = null;
        }
      }
    }

    const sessionUserId = req.session?.user?.id || null;
    if (sessionUserId) {
      if (!latestUser || latestUser.id !== sessionUserId) {
        latestUser = await getUserById(sessionUserId);
      }
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

    if (req.session?.user && trustedDevice && trustedDevice.user_id !== req.session.user.id) {
      await revokeTrustedDeviceByToken(trustedToken);
      res.clearCookie(TRUSTED_DEVICE_COOKIE_NAME, getTrustedDeviceCookieClearOptions());
      trustedDevice = null;
    }

    if (req.session?.user && trustedDevice && req.session.user.id === trustedDevice.user_id) {
      req.currentTrustedDeviceId = trustedDevice.id;
      if (!restoredFromTrustedDevice) {
        const metadata = collectClientMetadata(req);
        await touchTrustedDevice(trustedDevice.id, metadata);
      }
    }

    if (req.session?.user) {
      await updateUserLastSeen(req.session.user.id);
    }

    const licenseState = getLicenseState();
    res.locals.currentTrustedDeviceId = req.currentTrustedDeviceId || null;
    res.locals.currentUser = req.session?.user || null;
    res.locals.csrfToken = req.csrfToken ? req.csrfToken() : null;
    res.locals.request = req;
    res.locals.licenseState = licenseState;
    const restrictedRoles = new Set(['admin', 'redactor']);
    const currentRole = req.session?.user?.role || null;
    res.locals.isLicenseRestricted = Boolean(currentRole && licenseState.isExpired && restrictedRoles.has(currentRole));
    next();
  } catch (error) {
    next(error);
  }
}
