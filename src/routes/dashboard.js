import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import { promises as fs } from 'fs';
import { z } from 'zod';
import { ensureAuthenticated, ensureRole } from '../middleware/auth.js';
import { requireActiveLicense } from '../middleware/license.js';
import {
  listProjectsForUser,
  updateProjectStatus,
  getProjectById,
  assignProject,
  createProject,
  getClientProjectHighlights,
  getRedactorProjectHighlights,
  getAdminProjectHighlights,
  getProjectTimelineEntries,
  getProjectTimelineLastRead,
  markProjectTimelineRead,
  addProjectComment,
  createProjectFromTicket,
  listProjectFiles,
  createProjectFile,
  getProjectFileById,
  softDeleteProjectFile,
  countProjectFilesByOrigin,
  listDocumentRequests,
  createDocumentRequest,
  closeDocumentRequest,
  getDocumentRequestById,
  hasOpenDocumentRequests,
  finalizeProjectConversation,
  ensureProjectCompletionFinalized,
  isProjectConversationLocked,
  getProjectCompletionDeadline,
  PROJECT_COMPLETION_LOCK_HOURS
} from '../services/projectService.js';
import {
  listTicketsForUser,
  createTicket,
  getTicketWithReplies,
  getTicketById,
  getTicketTimelineEntries,
  getTicketTimelineLastRead,
  markTicketTimelineRead,
  addReply,
  listMergeCandidates,
  mergeTickets,
  updateTicketStatus,
  listPendingSupportTicketsForAdmin,
  listPendingSupportTicketsForRedactor,
  listRecentTicketRepliesForUser,
  markTicketAsContract,
  addTicketLog
} from '../services/ticketService.js';
import {
  listTeamMembers,
  listClients,
  getUserById,
  updateUserProfile,
  changeUserPassword,
  listUsers,
  createManagedUser,
  updateUserRole,
  setUserActiveStatus,
  PROTECTED_USER_ID,
  ROLE_HIERARCHY,
  forceChangeUserPassword,
  getManagedUserProfile,
  updateManagedUserDetails,
  clearUserSecurityData
} from '../services/userService.js';
import { listSecuritySettings, updateSecuritySetting } from '../services/securityService.js';
import {
  getTrustedDeviceCookieClearOptions,
  listTrustedDevicesForUser,
  revokeTrustedDevice,
  revokeTrustedDevicesExcept,
  TRUSTED_DEVICE_COOKIE_NAME
} from '../services/trustedDeviceService.js';
import {
  createPasskey,
  listPasskeysForUser,
  revokePasskey,
  PASSKEY_LIMIT_PER_USER
} from '../services/passkeyService.js';
import { sendTicketCreatedNotification, sendTicketReplyNotification } from '../services/mailService.js';
import { listRecentMailEvents } from '../services/notificationLogService.js';
import { refreshSecurityState } from '../utils/securityState.js';
import { getLicenseState, updateLicensePaidUntil } from '../utils/licenseState.js';
import {
  PROJECT_STATUSES,
  PROJECT_FLOW_STATUSES,
  getProjectStatusById,
  getNextProjectStatusId,
  getPreviousProjectStatusId,
  buildProjectStatusDictionary,
  isValidProjectStatus
} from '../utils/projectStatuses.js';
import {
  getOfferByTicketId,
  attachOfferDetails,
  acceptOffer,
  refuseOffer,
  requestCounterOffer,
  submitCounterOffer,
  listOffersForUser,
  listPendingOffersForAdmin,
  MIN_OFFER_EXPIRATION_HOURS,
  acceptCounterOffer,
  declineCounterOffer,
  updateOfferContractText
} from '../services/offerService.js';
import {
  getContractDetailsByTicket,
  saveContractDetails,
  generateDraftForContract,
  applyClientSignature,
  applyAdminSignature,
  createContractDownloadToken,
  consumeContractDownloadToken,
  listContractsForUser
} from '../services/contractService.js';
import { isValidCNP } from '../utils/validators.js';
import { createPdfBufferFromHtml } from '../utils/pdf.js';
import { ensureProjectStoragePath, buildStoredFileName, resolveStoredFilePath } from '../utils/fileStorage.js';
import { collectClientMetadata } from '../utils/requestMetadata.js';

const router = Router();
const TIMELINE_PAGE_SIZE = 10;
const PROJECT_TIMELINE_PAGE_SIZE = 10;
const CLIENT_MAX_PROJECT_FILES = 10;
const STAFF_MAX_PROJECT_FILES = 30;
const CLIENT_MAX_FILE_SIZE = 5 * 1024 * 1024;
const STAFF_MAX_FILE_SIZE = 30 * 1024 * 1024;
const ALLOWED_PROJECT_FILE_EXTENSIONS = new Set(['.pdf', '.docx', '.jpg', '.jpeg', '.png']);
const DOCS_VALIDATED_FLOW_INDEX = PROJECT_FLOW_STATUSES.findIndex((status) => status.id === 'docs_validated');

function buildFieldErrorsFromZod(error) {
  if (!(error instanceof z.ZodError)) {
    return {};
  }
  return error.errors.reduce((acc, issue) => {
    const fieldName = Array.isArray(issue.path) && issue.path.length ? issue.path[0] : null;
    if (!fieldName || acc[fieldName]) {
      return acc;
    }
    acc[fieldName] = issue.message;
    return acc;
  }, {});
}

const PROJECT_FORM_DEFAULTS = {
  title: '',
  description: '',
  degreeLevel: '',
  deadline: '',
  clientId: '',
  assignedAdminId: '',
  assignedRedactorId: ''
};

async function renderProjectCreatePage(res, { formData = {}, formErrors = {} } = {}, status = 200) {
  const [clients, team] = await Promise.all([listClients(), listTeamMembers()]);
  return res.status(status).render('pages/project-create', {
    title: 'Creaza proiect nou',
    description: 'Inregistreaza o lucrare de licenta si aloca echipa.',
    clients,
    team,
    formData: { ...PROJECT_FORM_DEFAULTS, ...formData },
    formErrors
  });
}

function resolveUserManagementRedirect(returnTo, fallback = '/cont/utilizatori') {
  if (typeof returnTo !== 'string' || !returnTo.startsWith('/')) {
    return fallback;
  }
  try {
    const parsed = new URL(returnTo, 'http://localhost');
    if (!parsed.pathname.startsWith('/cont/')) {
      return fallback;
    }
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch (error) {
    return fallback;
  }
}

const projectFileStorage = multer.diskStorage({
  destination: async (req, file, cb) => {
    try {
      const projectId = Number(req.params.id);
      if (!projectId) {
        return cb(new Error('PROJECT_ID_REQUIRED'));
      }
      const uploadPath = await ensureProjectStoragePath(projectId);
      return cb(null, uploadPath);
    } catch (error) {
      return cb(error);
    }
  },
  filename: (req, file, cb) => {
    const storedName = buildStoredFileName(file.originalname);
    // eslint-disable-next-line no-param-reassign
    file.storedName = storedName;
    cb(null, storedName);
  }
});

const projectFileUpload = multer({
  storage: projectFileStorage,
  limits: { files: STAFF_MAX_PROJECT_FILES, fileSize: STAFF_MAX_FILE_SIZE },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (!ALLOWED_PROJECT_FILE_EXTENSIONS.has(ext)) {
      return cb(new Error('INVALID_FILE_TYPE'));
    }
    return cb(null, true);
  }
});

router.use(ensureAuthenticated);

router
  .route('/cont/setari')
  .get(async (req, res, next) => {
    try {
      const user = req.session.user;
      const [profile, tickets, projects, contracts, trustedDevices, passkeys] = await Promise.all([
        getUserById(user.id),
        listTicketsForUser(user),
        listProjectsForUser(user),
        listContractsForUser(user),
        listTrustedDevicesForUser(user.id),
        listPasskeysForUser(user.id)
      ]);
      const successKey = typeof req.query.success === 'string' ? req.query.success : null;
      const errorKey = typeof req.query.error === 'string' ? req.query.error : null;
      const requestedTab = typeof req.query.tab === 'string' ? req.query.tab : null;
      const passkeyFlash = req.session.passkeyFlash || null;
      delete req.session.passkeyFlash;
      const successMessages = {
        profile: 'Datele tale au fost actualizate.',
        password: 'Parola a fost schimbata cu succes.',
        devices: 'Accesul dispozitivului selectat a fost revocat.',
        'devices-all': 'Am revocat accesul pentru toate dispozitivele salvate.',
        passkey: 'Passkey-ul a fost generat cu succes. Il vom salva automat in managerul tau de parole.'
      };
      const errorMessages = {
        'invalid-password': 'Parola curenta nu este corecta.',
        'profile-form': 'Completeaza corect toate campurile obligatorii din profil.',
        'password-form': 'Completeaza corect toate campurile obligatorii pentru parola.',
        'device-action': 'Nu am putut actualiza dispozitivele de incredere. Te rugam sa reincerci.',
        'passkey-action': 'Nu am putut gestiona passkey-urile. Te rugam sa reincerci.',
        'passkey-limit': 'Ai atins numarul maxim de 3 passkey-uri active.'
      };
      const feedback = {
        profileSuccess: successKey === 'profile' ? successMessages.profile : null,
        passwordSuccess: successKey === 'password' ? successMessages.password : null,
        deviceSuccess:
          successKey && (successKey === 'devices' || successKey === 'devices-all')
            ? successMessages[successKey]
            : null,
        passkeySuccess: successKey === 'passkey' ? successMessages.passkey : null,
        profileError: errorKey === 'profile-form' ? errorMessages['profile-form'] : null,
        passwordError:
          errorKey === 'password-form'
            ? errorMessages['password-form']
            : errorKey === 'invalid-password'
            ? errorMessages['invalid-password']
            : null,
        deviceError: errorKey === 'device-action' ? errorMessages['device-action'] : null,
        passkeyError:
          errorKey === 'passkey-action'
            ? errorMessages['passkey-action']
            : errorKey === 'passkey-limit'
            ? errorMessages['passkey-limit']
            : null
      };
      const allowedTabs = new Set(['profile', 'tickets', 'contracts', 'projects', 'security']);
      let activeTab = requestedTab && allowedTabs.has(requestedTab) ? requestedTab : 'profile';
      if (
        !requestedTab &&
        (successKey === 'password' || ['password-form', 'invalid-password'].includes(errorKey ?? ''))
      ) {
        activeTab = 'security';
      }
      res.render('pages/account-settings', {
        title: 'Cont',
        description: 'Gestioneaza datele personale, proiectele si securitatea accesului tau.',
        profile,
        tickets,
        projects,
        contracts,
        trustedDevices,
        passkeys,
        passkeyFlash,
        feedback,
        passkeyLimit: PASSKEY_LIMIT_PER_USER,
        activeTab,
        projectStatuses: PROJECT_STATUSES,
        projectStatusMap: buildProjectStatusDictionary()
      });
    } catch (error) {
      next(error);
    }
  })
  .post(async (req, res, next) => {
    try {
      const schema = z.object({
        fullName: z.string().min(3),
        phone: z.string().trim().optional()
      });
      const data = schema.parse(req.body);
      await updateUserProfile(req.session.user.id, {
        fullName: data.fullName,
        phone: data.phone && data.phone.length ? data.phone : null
      });
      req.session.user.fullName = data.fullName;
      req.session.user.phone = data.phone && data.phone.length ? data.phone : null;
      res.redirect('/cont/setari?success=profile');
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.redirect('/cont/setari?error=profile-form');
      }
      next(error);
    }
  });

router.post('/cont/setari/parola', async (req, res, next) => {
  try {
    const schema = z
      .object({
        currentPassword: z.string().min(6),
        newPassword: z.string().min(8),
        confirmPassword: z.string().min(8)
      })
      .refine((data) => data.newPassword === data.confirmPassword, {
        message: 'Parolele nu coincid',
        path: ['confirmPassword']
      });
    const data = schema.parse(req.body);
    await changeUserPassword(req.session.user.id, data.currentPassword, data.newPassword);
    res.redirect('/cont/setari?success=password&tab=security');
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.redirect('/cont/setari?error=password-form&tab=security');
    }
    if (error.message === 'INVALID_PASSWORD') {
      return res.redirect('/cont/setari?error=invalid-password&tab=security');
    }
    next(error);
  }
});

router.post('/cont/setari/dispozitive', async (req, res, next) => {
  try {
    const schema = z.object({
      action: z.enum(['revoke', 'revoke_all', 'revoke_all_except_current']),
      deviceId: z
        .string()
        .regex(/^[0-9]+$/)
        .optional()
    });
    const data = schema.parse(req.body);
    const userId = req.session.user.id;
    const currentTrustedDeviceId = req.currentTrustedDeviceId || res.locals.currentTrustedDeviceId || null;

    if (data.action === 'revoke') {
      const deviceId = data.deviceId ? Number.parseInt(data.deviceId, 10) : NaN;
      if (!Number.isInteger(deviceId) || deviceId <= 0) {
        return res.redirect('/cont/setari?error=device-action&tab=security');
      }
      const revoked = await revokeTrustedDevice({ userId, deviceId });
      if (!revoked) {
        return res.redirect('/cont/setari?error=device-action&tab=security');
      }
      if (currentTrustedDeviceId && deviceId === currentTrustedDeviceId) {
        res.clearCookie(TRUSTED_DEVICE_COOKIE_NAME, getTrustedDeviceCookieClearOptions());
      }
      return res.redirect('/cont/setari?success=devices&tab=security');
    }

    if (data.action === 'revoke_all_except_current') {
      await revokeTrustedDevicesExcept({ userId, exceptDeviceId: currentTrustedDeviceId || undefined });
      if (!currentTrustedDeviceId) {
        res.clearCookie(TRUSTED_DEVICE_COOKIE_NAME, getTrustedDeviceCookieClearOptions());
      }
      return res.redirect('/cont/setari?success=devices-all&tab=security');
    }

    if (data.action === 'revoke_all') {
      await revokeTrustedDevicesExcept({ userId });
      res.clearCookie(TRUSTED_DEVICE_COOKIE_NAME, getTrustedDeviceCookieClearOptions());
      return res.redirect('/cont/setari?success=devices-all&tab=security');
    }

    return res.redirect('/cont/setari?error=device-action&tab=security');
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.redirect('/cont/setari?error=device-action&tab=security');
    }
    next(error);
  }
});

router.post('/cont/setari/passkeys', async (req, res, next) => {
  try {
    const schema = z.object({
      action: z.enum(['create', 'revoke']),
      name: z.string().trim().min(1).max(150).optional(),
      passkeyId: z
        .string()
        .regex(/^[0-9]+$/)
        .optional()
    });
    const data = schema.parse(req.body);
    const userId = req.session.user.id;

    if (data.action === 'create') {
      try {
        const result = await createPasskey({ userId, label: data.name });
        req.session.passkeyFlash = { token: result.token, name: result.name };
        return res.redirect('/cont/setari?success=passkey&tab=security');
      } catch (error) {
        if (error.message === 'PASSKEY_LIMIT_REACHED') {
          return res.redirect('/cont/setari?error=passkey-limit&tab=security');
        }
        throw error;
      }
    }

    if (data.action === 'revoke') {
      const passkeyId = data.passkeyId ? Number.parseInt(data.passkeyId, 10) : NaN;
      if (!Number.isInteger(passkeyId) || passkeyId <= 0) {
        return res.redirect('/cont/setari?error=passkey-action&tab=security');
      }
      const revoked = await revokePasskey({ userId, passkeyId });
      if (!revoked) {
        return res.redirect('/cont/setari?error=passkey-action&tab=security');
      }
      return res.redirect('/cont/setari?success=passkey&tab=security');
    }

    return res.redirect('/cont/setari?error=passkey-action&tab=security');
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.redirect('/cont/setari?error=passkey-action&tab=security');
    }
    next(error);
  }
});

router.get('/cont', async (req, res, next) => {
  try {
    const user = req.session.user;
    const [projects, tickets] = await Promise.all([
      listProjectsForUser(user),
      listTicketsForUser(user)
    ]);

    const viewModel = {
      title: 'Panou de control',
      description: 'Monitorizeaza proiectele, contractele si discutiile cu echipa Academia de Licențe.',
      projects,
      tickets,
      offers: [],
      clientHighlights: { nextDeadline: null, admins: [], redactors: [] },
      redactorHighlights: { statusCounts: [], upcomingDeadlines: [] },
      adminHighlights: { statusCounts: [], recentProjects: [] },
      pendingSupportTickets: [],
      pendingOffers: [],
      recentReplies: [],
      securitySettings: [],
      securityFlash: null,
      mailLogs: [],
      licenseState: getLicenseState()
    };

    if (user.role === 'client') {
      const [clientHighlights, offers, recentReplies] = await Promise.all([
        getClientProjectHighlights(user.id),
        listOffersForUser(user),
        listRecentTicketRepliesForUser(user.id, 5)
      ]);
      viewModel.clientHighlights = clientHighlights;
      viewModel.offers = offers;
      viewModel.recentReplies = recentReplies;
    }

    if (user.role === 'redactor') {
      const [redactorHighlights, pendingSupport] = await Promise.all([
        getRedactorProjectHighlights(user.id),
        listPendingSupportTicketsForRedactor(user.id)
      ]);
      viewModel.redactorHighlights = redactorHighlights;
      viewModel.pendingSupportTickets = pendingSupport;
    }

    if (user.role === 'admin' || user.role === 'superadmin') {
      const [adminHighlights, pendingSupport, pendingOffers] = await Promise.all([
        getAdminProjectHighlights(user.id),
        listPendingSupportTicketsForAdmin(user.id),
        listPendingOffersForAdmin(user.role === 'superadmin' ? null : user.id)
      ]);
      viewModel.adminHighlights = adminHighlights;
      viewModel.pendingSupportTickets = pendingSupport;
      viewModel.pendingOffers = pendingOffers;
    }

    if (user.role === 'superadmin') {
      const [securitySettings, mailLogs] = await Promise.all([listSecuritySettings(), listRecentMailEvents(25)]);
      const flash = req.session.securityFlash || null;
      delete req.session.securityFlash;
      viewModel.securitySettings = securitySettings;
      viewModel.securityFlash = flash;
      viewModel.mailLogs = mailLogs;
    }

    viewModel.projectStatuses = PROJECT_STATUSES;
    viewModel.projectStatusMap = buildProjectStatusDictionary();
    viewModel.projectStatusFlow = PROJECT_FLOW_STATUSES;

    res.render('pages/dashboard', viewModel);
  } catch (error) {
    next(error);
  }
});

router.get('/cont/proiecte', requireActiveLicense(), async (req, res, next) => {
  try {
    const user = req.session.user;
    const projects = await listProjectsForUser(user);
    res.render('pages/project-list', {
      title: 'Proiecte',
      description: 'Vizualizeaza proiectele alocate si acceseaza rapid detaliile fiecaruia.',
      projects,
      projectStatusMap: buildProjectStatusDictionary()
    });
  } catch (error) {
    next(error);
  }
});

router.get('/cont/utilizatori', ensureRole('admin', 'superadmin'), async (req, res, next) => {
  try {
    const filters = {
      role: req.query.role || 'all',
      status: req.query.status || 'all',
      q: req.query.q || ''
    };
    const users = await listUsers({
      role: filters.role !== 'all' ? filters.role : undefined,
      status: filters.status !== 'all' ? filters.status : undefined,
      search: filters.q ? filters.q : undefined,
      viewer: req.session.user
    });
    const flash = req.session.flash || {};
    delete req.session.flash;
    res.render('pages/user-management', {
      title: 'Gestionare utilizatori',
      description: 'Creeaza conturi pentru echipa si gestioneaza accesul clientilor.',
      users,
      filters,
      flashMessage: flash.success || null,
      errorMessage: flash.error || null,
      generatedCredentials: flash.credentials || null,
      roleHierarchy: ROLE_HIERARCHY
    });
  } catch (error) {
    next(error);
  }
});

router.get('/cont/utilizatori/:id', ensureRole('admin', 'superadmin'), async (req, res, next) => {
  try {
    const targetId = Number(req.params.id);
    if (Number.isNaN(targetId)) {
      req.session.flash = { error: 'Utilizator invalid.' };
      return res.redirect('/cont/utilizatori');
    }
    const { user, trustedDevices, passkeys, securitySummary } = await getManagedUserProfile({
      actor: req.session.user,
      userId: targetId
    });
    const flash = req.session.flash || {};
    delete req.session.flash;
    const roleLabels = {
      client: 'Client',
      redactor: 'Redactor',
      admin: 'Admin',
      superadmin: 'Superadmin'
    };
    const actor = req.session.user;
    const actorLevel = ROLE_HIERARCHY[actor.role] || 0;
    const targetLevel = ROLE_HIERARCHY[user.role] || 0;
    const isSelf = user.id === actor.id;
    const canManageTarget =
      !isSelf &&
      (actor.id === PROTECTED_USER_ID
        ? true
        : actor.role === 'superadmin'
        ? targetLevel <= actorLevel
        : targetLevel < actorLevel);
    const availableRoles = ['client', 'redactor', 'admin', 'superadmin'].filter((role) => {
      if (actor.id === PROTECTED_USER_ID) {
        return true;
      }
      if (actor.role === 'superadmin') {
        return (ROLE_HIERARCHY[role] || 0) <= actorLevel;
      }
      return (ROLE_HIERARCHY[role] || 0) < actorLevel;
    });
    if (!availableRoles.includes(user.role)) {
      availableRoles.push(user.role);
    }
    availableRoles.sort((a, b) => (ROLE_HIERARCHY[a] || 0) - (ROLE_HIERARCHY[b] || 0));
    res.render('pages/user-edit', {
      title: `Editeaza ${user.fullName}`,
      description: `Administreaza setarile contului pentru ${user.email}.`,
      user,
      trustedDevices,
      passkeys,
      securitySummary,
      flashMessage: flash.success || null,
      errorMessage: flash.error || null,
      canModifyProfile: canManageTarget,
      canModifyRole: canManageTarget,
      canModifyStatus: canManageTarget,
      canResetPassword: canManageTarget,
      canClearSecurity: actor.role === 'superadmin' && canManageTarget,
      roleOptions: availableRoles,
      roleLabels
    });
  } catch (error) {
    if (['USER_NOT_FOUND', 'PROTECTED_USER'].includes(error.message)) {
      req.session.flash = { error: 'Utilizatorul selectat nu poate fi editat.' };
      return res.redirect('/cont/utilizatori');
    }
    if (error.message === 'INSUFFICIENT_PRIVILEGES') {
      req.session.flash = { error: 'Nu aveti permisiuni pentru a gestiona acest utilizator.' };
      return res.redirect('/cont/utilizatori');
    }
    next(error);
  }
});

router.get('/cont/tichete', ensureRole('admin', 'superadmin'), async (req, res, next) => {
  try {
    const filters = {
      status: req.query.status || 'all',
      kind: req.query.kind || 'all'
    };
    const tickets = await listTicketsForUser(req.session.user);
    const filteredTickets = tickets.filter((ticket) => {
      const statusMatch = filters.status === 'all' || ticket.status === filters.status;
      const kindMatch = filters.kind === 'all' || ticket.kind === filters.kind;
      return statusMatch && kindMatch;
    });
    res.render('pages/ticket-management', {
      title: 'Gestionare tichete',
      description: 'Vizualizeaza rapid solicitarile clientilor si actualizeaza statusurile direct din panoul de control.',
      tickets: filteredTickets,
      filters
    });
  } catch (error) {
    next(error);
  }
});

router.get('/cont/securitate', ensureRole('superadmin'), (req, res) => {
  res.redirect('/cont#securitate');
});

router.post('/cont/securitate', ensureRole('superadmin'), async (req, res, next) => {
  try {
    const schema = z.object({
      key: z.enum(['csp', 'enforce_https', 'debug_mode']),
      enabled: z.enum(['0', '1'])
    });
    const data = schema.parse(req.body);
    await updateSecuritySetting(data.key, data.enabled === '1');
    await refreshSecurityState();
    req.session.securityFlash = {
      type: 'success',
      message: 'Setarea de securitate a fost actualizata.'
    };
    res.redirect('/cont#securitate');
  } catch (error) {
    if (error instanceof z.ZodError) {
      req.session.securityFlash = {
        type: 'error',
        message: 'Solicitarea trimisa nu este valida.'
      };
      return res.redirect('/cont#securitate');
    }
    if (error.message === 'UNKNOWN_SECURITY_SETTING') {
      req.session.securityFlash = {
        type: 'error',
        message: 'Setarea selectata nu exista.'
      };
      return res.redirect('/cont#securitate');
    }
    next(error);
  }
});

router.post('/cont/securitate/licenta', ensureRole('superadmin'), async (req, res, next) => {
  try {
    const schema = z.object({
      paidUntil: z
        .string()
        .trim()
        .optional()
        .transform((value) => (value && value.length ? value : null))
        .refine(
          (value) => value === null || /^\d{4}-\d{2}-\d{2}$/.test(value),
          'Data invalida pentru licenta.'
        )
    });
    const data = schema.parse(req.body);
    await updateLicensePaidUntil(data.paidUntil);
    req.session.securityFlash = {
      type: 'success',
      message: 'Data de expirare a licentei a fost actualizata.'
    };
    res.redirect('/cont#securitate');
  } catch (error) {
    if (error instanceof z.ZodError) {
      req.session.securityFlash = {
        type: 'error',
        message: 'Completeaza o data valida in format AAAA-LL-ZZ.'
      };
      return res.redirect('/cont#securitate');
    }
    next(error);
  }
});

router.post('/cont/utilizatori', ensureRole('admin', 'superadmin'), async (req, res, next) => {
  try {
    const schema = z.object({
      fullName: z.string().min(3),
      email: z.string().email(),
      phone: z.string().trim().optional(),
      role: z.enum(['client', 'redactor', 'admin', 'superadmin'])
    });
    const data = schema.parse(req.body);
    if (data.role === 'superadmin' && req.session.user.role !== 'superadmin') {
      req.session.flash = { error: 'Numai superadminii pot crea alti superadmini.' };
      return res.redirect('/cont/utilizatori');
    }
    const { generatedPassword } = await createManagedUser({
      fullName: data.fullName,
      email: data.email,
      phone: data.phone && data.phone.length ? data.phone : null,
      role: data.role
    });
    req.session.flash = {
      success: 'Contul de staff a fost creat cu succes.',
      credentials: { email: data.email.toLowerCase(), password: generatedPassword }
    };
    res.redirect('/cont/utilizatori');
  } catch (error) {
    if (error instanceof z.ZodError) {
      req.session.flash = { error: 'Verifica datele introduse in formular.' };
      return res.redirect('/cont/utilizatori');
    }
    if (error.message === 'EMAIL_EXISTS') {
      req.session.flash = { error: 'Exista deja un cont cu acest email.' };
      return res.redirect('/cont/utilizatori');
    }
    if (error.message === 'INVALID_ROLE') {
      req.session.flash = { error: 'Rolul selectat nu este permis.' };
      return res.redirect('/cont/utilizatori');
    }
    next(error);
  }
});

router.post('/cont/utilizatori/:id/detalii', ensureRole('admin', 'superadmin'), async (req, res, next) => {
  try {
    const targetId = Number(req.params.id);
    if (Number.isNaN(targetId)) {
      req.session.flash = { error: 'Utilizator invalid.' };
      return res.redirect('/cont/utilizatori');
    }
    const schema = z.object({
      fullName: z.string().trim().min(3),
      email: z.string().trim().email(),
      phone: z
        .string()
        .optional()
        .transform((value) => {
          if (typeof value !== 'string') {
            return null;
          }
          const trimmed = value.trim();
          return trimmed.length ? trimmed : null;
        }),
      role: z.enum(['client', 'redactor', 'admin', 'superadmin']),
      isActive: z.enum(['0', '1']).optional(),
      mustResetPassword: z.enum(['1']).optional(),
      returnTo: z.string().optional()
    });
    const data = schema.parse(req.body);
    const redirectTo = resolveUserManagementRedirect(data.returnTo, `/cont/utilizatori/${targetId}`);
    const hasStatusField = Object.prototype.hasOwnProperty.call(req.body, 'isActive');
    const hasResetField = Object.prototype.hasOwnProperty.call(req.body, 'mustResetPassword');
    await updateManagedUserDetails({
      actor: req.session.user,
      userId: targetId,
      fullName: data.fullName,
      email: data.email,
      phone: data.phone,
      role: data.role,
      mustResetPassword: hasResetField ? data.mustResetPassword === '1' : undefined,
      isActive: hasStatusField ? data.isActive === '1' : undefined
    });
    req.session.flash = { success: 'Profilul utilizatorului a fost actualizat.' };
    return res.redirect(redirectTo);
  } catch (error) {
    if (error instanceof z.ZodError) {
      req.session.flash = { error: 'Completeaza corect toate campurile obligatorii.' };
      return res.redirect(resolveUserManagementRedirect(req.body.returnTo, '/cont/utilizatori'));
    }
    if (error.message === 'EMAIL_EXISTS') {
      req.session.flash = { error: 'Exista deja un cont cu aceasta adresa de email.' };
      return res.redirect(resolveUserManagementRedirect(req.body.returnTo, '/cont/utilizatori'));
    }
    if (error.message === 'INSUFFICIENT_PRIVILEGES') {
      req.session.flash = { error: 'Nu aveti permisiuni pentru a modifica acest utilizator.' };
      return res.redirect(resolveUserManagementRedirect(req.body.returnTo, '/cont/utilizatori'));
    }
    if (error.message === 'PROTECTED_USER') {
      req.session.flash = { error: 'Acest utilizator este protejat si nu poate fi modificat.' };
      return res.redirect('/cont/utilizatori');
    }
    if (error.message === 'SELF_MODIFICATION') {
      req.session.flash = { error: 'Nu iti poti edita contul din aceasta sectiune.' };
      return res.redirect('/cont/utilizatori');
    }
    if (error.message === 'USER_NOT_FOUND') {
      req.session.flash = { error: 'Utilizatorul selectat nu exista.' };
      return res.redirect('/cont/utilizatori');
    }
    next(error);
  }
});

router.post('/cont/utilizatori/:id/rol', ensureRole('admin', 'superadmin'), async (req, res, next) => {
  try {
    const targetId = Number(req.params.id);
    if (Number.isNaN(targetId)) {
      req.session.flash = { error: 'Utilizator invalid.' };
      return res.redirect('/cont/utilizatori');
    }
    if (targetId === PROTECTED_USER_ID) {
      req.session.flash = { error: 'Acest utilizator este protejat si nu poate fi modificat.' };
      return res.redirect('/cont/utilizatori');
    }
    if (targetId === req.session.user.id) {
      req.session.flash = { error: 'Nu iti poti modifica propriul rol.' };
      return res.redirect('/cont/utilizatori');
    }
    const schema = z.object({ role: z.enum(['client', 'redactor', 'admin', 'superadmin']) });
    const { role } = schema.parse(req.body);
    if (role === 'superadmin' && req.session.user.role !== 'superadmin') {
      req.session.flash = { error: 'Numai superadminii pot atribui rolul de superadmin.' };
      return res.redirect('/cont/utilizatori');
    }
    await updateUserRole({ actor: req.session.user, userId: targetId, role });
    req.session.flash = { success: 'Rolul utilizatorului a fost actualizat.' };
    res.redirect('/cont/utilizatori');
  } catch (error) {
    if (error instanceof z.ZodError || error.message === 'INVALID_ROLE') {
      req.session.flash = { error: 'Rol selectat invalid.' };
      return res.redirect('/cont/utilizatori');
    }
    if (error.message === 'PROTECTED_USER') {
      req.session.flash = { error: 'Acest utilizator este protejat si nu poate fi modificat.' };
      return res.redirect('/cont/utilizatori');
    }
    if (error.message === 'INSUFFICIENT_PRIVILEGES') {
      req.session.flash = { error: 'Nu aveti permisiuni pentru a modifica acest utilizator.' };
      return res.redirect('/cont/utilizatori');
    }
    if (error.message === 'USER_NOT_FOUND') {
      req.session.flash = { error: 'Utilizatorul selectat nu exista.' };
      return res.redirect('/cont/utilizatori');
    }
    next(error);
  }
});

router.post('/cont/utilizatori/:id/status', ensureRole('admin', 'superadmin'), async (req, res, next) => {
  try {
    const targetId = Number(req.params.id);
    if (Number.isNaN(targetId)) {
      req.session.flash = { error: 'Utilizator invalid.' };
      return res.redirect('/cont/utilizatori');
    }
    if (targetId === PROTECTED_USER_ID && req.session.user.id !== PROTECTED_USER_ID) {
      req.session.flash = { error: 'Acest utilizator este protejat si nu poate fi dezactivat.' };
      return res.redirect('/cont/utilizatori');
    }
    if (targetId === req.session.user.id) {
      req.session.flash = { error: 'Nu iti poti dezactiva propriul cont.' };
      return res.redirect('/cont/utilizatori');
    }
    const schema = z.object({ isActive: z.enum(['0', '1']) });
    const { isActive } = schema.parse(req.body);
    await setUserActiveStatus({ actor: req.session.user, userId: targetId, isActive: isActive === '1' });
    req.session.flash = { success: 'Statusul contului a fost actualizat.' };
    const redirectTo = resolveUserManagementRedirect(req.body.returnTo, '/cont/utilizatori');
    res.redirect(redirectTo);
  } catch (error) {
    if (error instanceof z.ZodError) {
      req.session.flash = { error: 'Solicitarea nu este valida.' };
      return res.redirect(resolveUserManagementRedirect(req.body.returnTo, '/cont/utilizatori'));
    }
    if (error.message === 'PROTECTED_USER') {
      req.session.flash = { error: 'Acest utilizator este protejat si nu poate fi dezactivat.' };
      return res.redirect(resolveUserManagementRedirect(req.body.returnTo, '/cont/utilizatori'));
    }
    if (error.message === 'INSUFFICIENT_PRIVILEGES') {
      req.session.flash = { error: 'Nu aveti permisiuni pentru a modifica acest utilizator.' };
      return res.redirect(resolveUserManagementRedirect(req.body.returnTo, '/cont/utilizatori'));
    }
    if (error.message === 'USER_NOT_FOUND') {
      req.session.flash = { error: 'Utilizatorul selectat nu exista.' };
      return res.redirect(resolveUserManagementRedirect(req.body.returnTo, '/cont/utilizatori'));
    }
    next(error);
  }
});

router.post('/cont/utilizatori/:id/parola', ensureRole('admin', 'superadmin'), async (req, res, next) => {
  try {
    const targetId = Number(req.params.id);
    if (Number.isNaN(targetId)) {
      req.session.flash = { error: 'Utilizator invalid.' };
      return res.redirect('/cont/utilizatori');
    }
    const schema = z.object({ newPassword: z.string().min(8) });
    const { newPassword } = schema.parse(req.body);
    await forceChangeUserPassword({
      actor: req.session.user,
      userId: targetId,
      newPassword
    });
    req.session.flash = { success: 'Parola utilizatorului a fost actualizata.' };
    return res.redirect(resolveUserManagementRedirect(req.body.returnTo, '/cont/utilizatori'));
  } catch (error) {
    if (error instanceof z.ZodError) {
      req.session.flash = { error: 'Parola noua trebuie sa aiba cel putin 8 caractere.' };
      return res.redirect(resolveUserManagementRedirect(req.body.returnTo, '/cont/utilizatori'));
    }
    if (error.message === 'PROTECTED_USER') {
      req.session.flash = { error: 'Parola acestui utilizator nu poate fi schimbata.' };
      return res.redirect(resolveUserManagementRedirect(req.body.returnTo, '/cont/utilizatori'));
    }
    if (error.message === 'SELF_MODIFICATION') {
      req.session.flash = { error: 'Nu iti poti schimba parola din aceasta sectiune.' };
      return res.redirect('/cont/utilizatori');
    }
    if (error.message === 'INSUFFICIENT_PRIVILEGES') {
      req.session.flash = { error: 'Nu aveti permisiuni pentru a modifica parola acestui utilizator.' };
      return res.redirect(resolveUserManagementRedirect(req.body.returnTo, '/cont/utilizatori'));
    }
    if (error.message === 'USER_NOT_FOUND') {
      req.session.flash = { error: 'Utilizatorul selectat nu exista.' };
      return res.redirect(resolveUserManagementRedirect(req.body.returnTo, '/cont/utilizatori'));
    }
    next(error);
  }
});

router.post('/cont/utilizatori/:id/securitate/reset', ensureRole('superadmin'), async (req, res, next) => {
  try {
    const targetId = Number(req.params.id);
    if (Number.isNaN(targetId)) {
      req.session.flash = { error: 'Utilizator invalid.' };
      return res.redirect('/cont/utilizatori');
    }
    await clearUserSecurityData({ actor: req.session.user, userId: targetId });
    req.session.flash = { success: 'Datele de securitate au fost sterse.' };
    const redirectTo = resolveUserManagementRedirect(req.body.returnTo, `/cont/utilizatori/${targetId}`);
    return res.redirect(redirectTo);
  } catch (error) {
    if (error.message === 'PROTECTED_USER') {
      req.session.flash = { error: 'Acest utilizator este protejat si nu poate fi modificat.' };
      return res.redirect(resolveUserManagementRedirect(req.body.returnTo, '/cont/utilizatori'));
    }
    if (error.message === 'SELF_MODIFICATION') {
      req.session.flash = { error: 'Nu iti poti curata propriile date de securitate din aceasta sectiune.' };
      return res.redirect('/cont/utilizatori');
    }
    if (error.message === 'INSUFFICIENT_PRIVILEGES') {
      req.session.flash = { error: 'Nu aveti permisiuni pentru a modifica acest utilizator.' };
      return res.redirect(resolveUserManagementRedirect(req.body.returnTo, '/cont/utilizatori'));
    }
    if (error.message === 'USER_NOT_FOUND') {
      req.session.flash = { error: 'Utilizatorul selectat nu exista.' };
      return res.redirect(resolveUserManagementRedirect(req.body.returnTo, '/cont/utilizatori'));
    }
    next(error);
  }
});

router
  .route('/cont/tichete/creeaza')
  .get(async (req, res, next) => {
    try {
      const projects = await listProjectsForUser(req.session.user);
      res.render('pages/ticket-create', {
        title: 'Deschide un ticket',
        description: 'Trimite o solicitare rapida catre echipa de redactori.',
        projects,
        error: null,
        fieldErrors: {},
        formData: {
          projectId: '',
          subject: '',
          message: ''
        }
      });
    } catch (error) {
      next(error);
    }
  })
  .post(async (req, res, next) => {
    try {
      const schema = z.object({
        projectId: z
          .string()
          .optional()
          .transform((value) => (typeof value === 'string' ? value.trim() : ''))
          .refine((value) => !value || /^\d+$/.test(value), 'Selecteaza un proiect valid.'),
        subject: z.string().trim().min(5, 'Subiectul trebuie sa contina cel putin 5 caractere.'),
        message: z.string().trim().min(10, 'Mesajul trebuie sa aiba cel putin 10 caractere.')
      });
      const data = schema.parse(req.body);
      const projectId = data.projectId ? Number(data.projectId) : null;
      const clientMetadata = collectClientMetadata(req);
      const project = projectId ? await getProjectById(projectId) : null;
      const projectAdmins = [];
      if (project?.assigned_admin_id) {
        const adminUser = await getUserById(project.assigned_admin_id);
        if (adminUser?.email) {
          projectAdmins.push(adminUser.email);
        }
      }
      if (project?.assigned_editor_id) {
        const editorUser = await getUserById(project.assigned_editor_id);
        if (editorUser?.email) {
          projectAdmins.push(editorUser.email);
        }
      }

      const { id: ticketId, displayCode } = await createTicket({
        projectId,
        userId: req.session.user.id,
        subject: data.subject,
        message: data.message,
        clientMetadata
      });
      const ticketPayload = {
        id: ticketId,
        display_code: displayCode,
        subject: data.subject,
        message: data.message
      };
      sendTicketCreatedNotification({
        ticket: ticketPayload,
        author: req.session.user,
        clientEmail: req.session.user.email,
        adminEmails: projectAdmins,
        projectTitle: project?.title || null
      }).catch((error) => console.error('Nu s-a putut trimite notificarea de creare ticket (cont):', error));
      res.redirect('/cont');
    } catch (error) {
      if (error instanceof z.ZodError) {
        const fieldErrors = buildFieldErrorsFromZod(error);
        const projects = await listProjectsForUser(req.session.user);
        return res.status(400).render('pages/ticket-create', {
          title: 'Deschide un ticket',
          description: 'Trimite o solicitare rapida catre echipa de redactori.',
          projects,
          error: 'Corecteaza campurile marcate mai jos pentru a continua.',
          fieldErrors,
          formData: {
            projectId: typeof req.body.projectId === 'string' ? req.body.projectId : '',
            subject: typeof req.body.subject === 'string' ? req.body.subject : '',
            message: typeof req.body.message === 'string' ? req.body.message : ''
          }
        });
      }
      next(error);
    }
  });

router.get('/cont/tichete/:id', requireActiveLicense(), async (req, res, next) => {
  try {
    const ticketId = Number(req.params.id);
    const ticket = await getTicketById(ticketId);
    if (!ticket) {
      return res.status(404).render('pages/404', {
        title: 'Ticket inexistent',
        description: 'Ticketul solicitat nu a fost gasit.'
      });
    }
    const user = req.session.user;
    if (user.role === 'client' && ticket.created_by !== user.id) {
      return res.status(403).render('pages/403', {
        title: 'Acces restrictionat',
        description: 'Nu aveti acces la acest ticket.'
      });
    }
    if (user.role === 'redactor' && ticket.project_id && ticket.assigned_editor_id && ticket.assigned_editor_id !== user.id) {
      return res.status(403).render('pages/403', {
        title: 'Acces restrictionat',
        description: 'Ticketul nu este asociat proiectelor tale.'
      });
    }
    if (user.role === 'admin' && ticket.project_id && ticket.assigned_admin_id && ticket.assigned_admin_id !== user.id && ticket.assigned_editor_id !== user.id) {
      return res.status(403).render('pages/403', {
        title: 'Acces restrictionat',
        description: 'Ticketul nu este gestionat de tine.'
      });
    }
    const includeInternalTimeline = ['admin', 'superadmin', 'redactor'].includes(user.role);
    const [timelineBatch, timelineLastReadAt] = await Promise.all([
      getTicketTimelineEntries(ticket.id, {
        limit: TIMELINE_PAGE_SIZE + 1,
        offset: 0,
        includeInternal: includeInternalTimeline
      }),
      getTicketTimelineLastRead(ticket.id, user.id)
    ]);
    const hasMoreTimeline = timelineBatch.length > TIMELINE_PAGE_SIZE;
    const baseTimelineEntries = hasMoreTimeline ? timelineBatch.slice(0, TIMELINE_PAGE_SIZE) : timelineBatch;
    const timelineEntries = baseTimelineEntries.map((entry) => {
      const createdAt = entry.created_at instanceof Date ? entry.created_at : new Date(entry.created_at);
      const isOwnEntry = entry.author_id && entry.author_id === user.id;
      const isValidDate = createdAt instanceof Date && !Number.isNaN(createdAt.getTime());
      const isUnread = !isOwnEntry && (!timelineLastReadAt || (isValidDate && createdAt > timelineLastReadAt));
      return { ...entry, isUnread };
    });
    await markTicketTimelineRead({ ticketId: ticket.id, userId: user.id });
    const offer = ticket.kind === 'offer' || ticket.kind === 'contract' ? await getOfferByTicketId(ticket.id) : null;
    const contractDetails = ticket.kind === 'contract' ? await getContractDetailsByTicket(ticket.id) : null;
    let mergeCandidates = [];
    if (['admin', 'superadmin'].includes(user.role) && !ticket.merged_into_ticket_id) {
      mergeCandidates = await listMergeCandidates({
        baseTicketId: ticket.id,
        createdBy: ticket.created_by,
        actor: user
      });
    }
    const feedback = req.session.ticketFeedback || {};
    delete req.session.ticketFeedback;
    res.render('pages/ticket-detail', {
      title: `Ticket ${ticket.display_code} – ${ticket.subject}`,
      description: 'Comunicare rapida cu echipa de proiect.',
      ticket,
      timelineEntries,
      hasMoreTimeline,
      timelinePageSize: TIMELINE_PAGE_SIZE,
      offer,
      offerMinHours: MIN_OFFER_EXPIRATION_HOURS,
      feedback,
      contractDetails,
      mergeCandidates,
      includeInternalTimeline
    });
  } catch (error) {
    next(error);
  }
});

router.get('/cont/tichete/:id/timeline', requireActiveLicense(), async (req, res, next) => {
  try {
    const ticketId = Number(req.params.id);
    const ticket = await getTicketById(ticketId);
    if (!ticket) {
      return res.status(404).json({ error: 'Ticketul solicitat nu a fost gasit.' });
    }

    const user = req.session.user;
    if (user.role === 'client' && ticket.created_by !== user.id) {
      return res.status(403).json({ error: 'Nu aveti acces la acest ticket.' });
    }
    if (
      user.role === 'redactor' &&
      ticket.project_id &&
      ticket.assigned_editor_id &&
      ticket.assigned_editor_id !== user.id
    ) {
      return res.status(403).json({ error: 'Ticketul nu este asociat proiectelor tale.' });
    }
    if (user.role === 'admin' && ticket.project_id && ticket.assigned_admin_id && ticket.assigned_admin_id !== user.id && ticket.assigned_editor_id !== user.id) {
      return res.status(403).json({ error: 'Ticketul nu este gestionat de tine.' });
    }

    const rawOffset = Number.parseInt(req.query.offset ?? '0', 10);
    const rawLimit = Number.parseInt(req.query.limit ?? `${TIMELINE_PAGE_SIZE}`, 10);
    const offset = Number.isNaN(rawOffset) ? 0 : Math.max(0, rawOffset);
    const limit = Number.isNaN(rawLimit)
      ? TIMELINE_PAGE_SIZE
      : Math.max(1, Math.min(TIMELINE_PAGE_SIZE, rawLimit));

    const includeInternalTimeline = ['admin', 'superadmin', 'redactor'].includes(user.role);
    const [timelineBatch, timelineLastReadAt] = await Promise.all([
      getTicketTimelineEntries(ticketId, {
        limit: limit + 1,
        offset,
        includeInternal: includeInternalTimeline
      }),
      getTicketTimelineLastRead(ticketId, user.id)
    ]);
    const hasMore = timelineBatch.length > limit;
    const entries = hasMore ? timelineBatch.slice(0, limit) : timelineBatch;
    const normalizedEntries = entries.map((entry) => {
      const createdAt = entry.created_at instanceof Date ? entry.created_at : new Date(entry.created_at);
      const isOwnEntry = entry.author_id && entry.author_id === user.id;
      const isValidDate = createdAt instanceof Date && !Number.isNaN(createdAt.getTime());
      const isUnread = !isOwnEntry && (!timelineLastReadAt || (isValidDate && createdAt > timelineLastReadAt));
      return { ...entry, isUnread };
    });

    res.json({
      entries: normalizedEntries,
      hasMore,
      nextOffset: offset + entries.length
    });
  } catch (error) {
    next(error);
  }
});

router.post('/cont/tichete/:id/raspuns', requireActiveLicense(), async (req, res, next) => {
  try {
    const schema = z.object({
      message: z.string().min(2)
    });
    const data = schema.parse(req.body);
    const { ticket } = await getTicketWithReplies(Number(req.params.id));
    if (!ticket) {
      return res.status(404).render('pages/404', {
        title: 'Ticket inexistent',
        description: 'Ticketul solicitat nu a fost gasit.'
      });
    }
    const user = req.session.user;
    if (user.role === 'client' && ticket.created_by !== user.id) {
      return res.status(403).render('pages/403', {
        title: 'Acces restrictionat',
        description: 'Nu aveti acces la acest ticket.'
      });
    }
    if (user.role === 'redactor' && ticket.project_id && ticket.assigned_editor_id && ticket.assigned_editor_id !== user.id) {
      return res.status(403).render('pages/403', {
        title: 'Acces restrictionat',
        description: 'Ticketul nu este asociat proiectelor tale.'
      });
    }
    if (user.role === 'admin' && ticket.project_id && ticket.assigned_admin_id && ticket.assigned_admin_id !== user.id && ticket.assigned_editor_id !== user.id) {
      return res.status(403).render('pages/403', {
        title: 'Acces restrictionat',
        description: 'Ticketul nu este gestionat de tine.'
      });
    }
    if (ticket.merged_into_ticket_id) {
      req.session.ticketFeedback = {
        error: 'Acest ticket a fost fuzionat in altul si nu mai permite raspunsuri.'
      };
      return res.redirect(`/cont/tichete/${req.params.id}`);
    }
    const project = ticket.project_id ? await getProjectById(ticket.project_id) : null;
    const projectAdmins = [];
    if (project?.assigned_admin_id) {
      const adminUser = await getUserById(project.assigned_admin_id);
      if (adminUser?.email) {
        projectAdmins.push(adminUser.email);
      }
    }
    if (project?.assigned_editor_id) {
      const editorUser = await getUserById(project.assigned_editor_id);
      if (editorUser?.email) {
        projectAdmins.push(editorUser.email);
      }
    }
    const ticketAuthor = ticket.created_by ? await getUserById(ticket.created_by) : null;
    await addReply({
      ticketId: ticket.id,
      userId: user.id,
      message: data.message
    });
    sendTicketReplyNotification({
      ticket: { id: ticket.id, display_code: ticket.display_code, subject: ticket.subject },
      author: { id: user.id, role: user.role, fullName: user.fullName, email: user.email },
      message: data.message,
      clientEmail: ticketAuthor?.email || null,
      adminEmails: projectAdmins,
      projectTitle: project?.title || null
    }).catch((error) => console.error('Nu s-a putut trimite notificarea de raspuns ticket:', error));
    res.redirect(`/cont/tichete/${req.params.id}`);
  } catch (error) {
    next(error);
  }
});

router.post(
  '/cont/tichete/:id/oferta/detalii',
  ensureRole('admin', 'superadmin'),
  requireActiveLicense({ roles: ['admin'] }),
  async (req, res, next) => {
    try {
      const ticketId = Number(req.params.id);
      const { ticket } = await getTicketWithReplies(ticketId);
      if (!ticket || ticket.kind !== 'offer') {
        return res.status(404).render('pages/404', {
          title: 'Ticket inexistent',
          description: 'Ticketul solicitat nu a fost gasit.'
        });
      }
      const user = req.session.user;
      if (
        user.role === 'admin' &&
        ticket.project_id &&
        ticket.assigned_admin_id &&
        ticket.assigned_admin_id !== user.id && ticket.assigned_editor_id !== user.id
      ) {
        return res.status(403).render('pages/403', {
          title: 'Acces restrictionat',
          description: 'Nu sunteti responsabil de acest ticket.'
        });
      }
      const schema = z.object({
        amount: z.string().min(1),
        expiresInHours: z.string().optional(),
        message: z.string().optional()
      });
      const data = schema.parse(req.body);
      const amount = Number(data.amount.replace(',', '.'));
      if (Number.isNaN(amount) || amount <= 0) {
        req.session.ticketFeedback = { error: 'Valoarea ofertei trebuie sa fie pozitiva.' };
        return res.redirect(`/cont/tichete/${ticketId}`);
      }
      let expiresInHours = data.expiresInHours ? Number(data.expiresInHours) : MIN_OFFER_EXPIRATION_HOURS;
      if (Number.isNaN(expiresInHours) || expiresInHours < MIN_OFFER_EXPIRATION_HOURS) {
        expiresInHours = MIN_OFFER_EXPIRATION_HOURS;
      }
      const offer = await getOfferByTicketId(ticketId);
      if (!offer) {
        return res.status(404).render('pages/404', {
          title: 'Oferta indisponibila',
          description: 'Nu exista o oferta asociata acestui ticket.'
        });
      }
      await attachOfferDetails(offer.id, {
        amount,
        expiresInHours,
        notes: data.message,
        program: offer.program,
        topic: offer.topic,
        deliveryDate: offer.delivery_date,
        clientName: offer.client_name
      });
      if (data.message && data.message.trim().length > 0) {
        await addReply({
          ticketId,
          userId: user.id,
          message: `Oferta transmisa: ${amount.toFixed(2)} RON. ${data.message}`
        });
      }
      req.session.ticketFeedback = { success: 'Oferta a fost transmisa clientului.' };
      return res.redirect(`/cont/tichete/${ticketId}`);
    } catch (error) {
      if (error instanceof z.ZodError) {
        req.session.ticketFeedback = { error: 'Completeaza corect campurile ofertei.' };
        return res.redirect(`/cont/tichete/${req.params.id}`);
      }
      if (error.message === 'OFFER_LOCKED') {
        req.session.ticketFeedback = { error: 'Oferta a fost deja transmisa si nu mai poate fi modificata.' };
        return res.redirect(`/cont/tichete/${req.params.id}`);
      }
      if (error.message === 'OFFER_NOT_FOUND') {
        req.session.ticketFeedback = { error: 'Oferta nu a fost gasita.' };
        return res.redirect(`/cont/tichete/${req.params.id}`);
      }
      next(error);
    }
  }
);

router.post('/cont/tichete/:id/oferta/accepta', async (req, res, next) => {
  try {
    const ticketId = Number(req.params.id);
    const user = req.session.user;
    const { ticket } = await getTicketWithReplies(ticketId);
    if (!ticket || ticket.kind !== 'offer') {
      return res.status(404).render('pages/404', {
        title: 'Ticket inexistent',
        description: 'Ticketul solicitat nu a fost gasit.'
      });
    }
    if (user.role !== 'client' || ticket.created_by !== user.id) {
      return res.status(403).render('pages/403', {
        title: 'Acces restrictionat',
        description: 'Nu puteti accepta aceasta oferta.'
      });
    }
    const offer = await getOfferByTicketId(ticketId);
    if (!offer || offer.status !== 'sent') {
      req.session.ticketFeedback = { error: 'Oferta nu mai poate fi acceptata.' };
      return res.redirect(`/cont/tichete/${ticketId}`);
    }
    await acceptOffer(offer.id);
    await markTicketAsContract(ticketId);
    await addReply({
      ticketId,
      userId: user.id,
      message: 'Oferta a fost acceptata si a fost deschisa etapa de semnare a contractului.'
    });
    req.session.ticketFeedback = {
      success: 'Ai acceptat oferta. Completeaza datele contractului pentru a continua semnarea.'
    };
    res.redirect(`/cont/tichete/${ticketId}`);
  } catch (error) {
    next(error);
  }
});

router.post('/cont/tichete/:id/oferta/refuza', async (req, res, next) => {
  try {
    const ticketId = Number(req.params.id);
    const user = req.session.user;
    const { ticket } = await getTicketWithReplies(ticketId);
    if (!ticket || ticket.kind !== 'offer') {
      return res.status(404).render('pages/404', {
        title: 'Ticket inexistent',
        description: 'Ticketul solicitat nu a fost gasit.'
      });
    }
    if (user.role !== 'client' || ticket.created_by !== user.id) {
      return res.status(403).render('pages/403', {
        title: 'Acces restrictionat',
        description: 'Nu puteti refuza aceasta oferta.'
      });
    }
    const offer = await getOfferByTicketId(ticketId);
    if (!offer || offer.status !== 'sent') {
      req.session.ticketFeedback = { error: 'Oferta nu mai poate fi refuzata.' };
      return res.redirect(`/cont/tichete/${ticketId}`);
    }
    await requestCounterOffer(offer.id);
    await addReply({
      ticketId,
      userId: user.id,
      message: 'Oferta a fost refuzata. Voi trimite o contraoferta in cel mai scurt timp.'
    });
    req.session.ticketFeedback = {
      success: 'Ai refuzat oferta. Ai 30 de minute pentru a trimite o contraoferta.'
    };
    res.redirect(`/cont/tichete/${ticketId}`);
  } catch (error) {
    next(error);
  }
});

router.post('/cont/tichete/:id/oferta/contraoferta', async (req, res, next) => {
  try {
    const ticketId = Number(req.params.id);
    const user = req.session.user;
    const { ticket } = await getTicketWithReplies(ticketId);
    if (!ticket || ticket.kind !== 'offer') {
      return res.status(404).render('pages/404', {
        title: 'Ticket inexistent',
        description: 'Ticketul solicitat nu a fost gasit.'
      });
    }
    if (user.role !== 'client' || ticket.created_by !== user.id) {
      return res.status(403).render('pages/403', {
        title: 'Acces restrictionat',
        description: 'Nu puteti trimite o contraoferta pentru acest ticket.'
      });
    }
    const schema = z.object({
      amount: z.string().min(1)
    });
    const data = schema.parse(req.body);
    const amount = Number(data.amount.replace(',', '.'));
    if (Number.isNaN(amount) || amount <= 0) {
      req.session.ticketFeedback = { error: 'Contraoferta trebuie sa fie o valoare pozitiva.' };
      return res.redirect(`/cont/tichete/${ticketId}`);
    }
    const offer = await getOfferByTicketId(ticketId);
    if (!offer || offer.status !== 'counter_pending') {
      req.session.ticketFeedback = { error: 'Nu exista o fereastra activa pentru contraoferta.' };
      return res.redirect(`/cont/tichete/${ticketId}`);
    }
    await submitCounterOffer(offer.id, amount);
    await addReply({
      ticketId,
      userId: user.id,
      message: `Contraoferta propusa: ${amount.toFixed(2)} RON.`
    });
    req.session.ticketFeedback = { success: 'Contraoferta a fost trimisa administratorului.' };
    res.redirect(`/cont/tichete/${ticketId}`);
  } catch (error) {
    if (error instanceof z.ZodError) {
      req.session.ticketFeedback = { error: 'Completeaza valoarea contraofertei.' };
      return res.redirect(`/cont/tichete/${req.params.id}`);
    }
    if (error.message === 'COUNTER_TOO_LOW') {
      req.session.ticketFeedback = {
        error: 'Contraoferta nu poate fi mai mica de 85% din valoarea propusa initial.'
      };
      return res.redirect(`/cont/tichete/${req.params.id}`);
    }
    if (error.message === 'INVALID_STATE' || error.message === 'MISSING_BASE_AMOUNT') {
      req.session.ticketFeedback = { error: 'Nu exista o fereastra activa pentru contraoferta.' };
      return res.redirect(`/cont/tichete/${req.params.id}`);
    }
    next(error);
  }
});

router.post(
  '/cont/tichete/:id/oferta/contraoferta/accepta',
  ensureRole('admin', 'superadmin'),
  requireActiveLicense({ roles: ['admin'] }),
  async (req, res, next) => {
    try {
    const ticketId = Number(req.params.id);
    const { ticket } = await getTicketWithReplies(ticketId);
    if (!ticket || ticket.kind !== 'offer') {
      return res.status(404).render('pages/404', {
        title: 'Ticket inexistent',
        description: 'Ticketul solicitat nu a fost gasit.'
      });
    }
    const user = req.session.user;
    if (
      user.role === 'admin' &&
      ticket.project_id &&
      ticket.assigned_admin_id &&
      ticket.assigned_admin_id !== user.id && ticket.assigned_editor_id !== user.id
    ) {
      return res.status(403).render('pages/403', {
        title: 'Acces restrictionat',
        description: 'Nu sunteti responsabil de acest ticket.'
      });
    }
    const offer = await getOfferByTicketId(ticketId);
    if (!offer || offer.status !== 'counter_submitted') {
      req.session.ticketFeedback = { error: 'Nu exista o contraoferta de acceptat.' };
      return res.redirect(`/cont/tichete/${ticketId}`);
    }
    await acceptCounterOffer(offer.id);
    await addReply({
      ticketId,
      userId: user.id,
      message: 'Contraoferta clientului a fost acceptata. Pregatim contractul final.'
    });
    req.session.ticketFeedback = {
      success: 'Ai acceptat contraoferta clientului. Poti continua cu semnarea contractului.'
    };
      res.redirect(`/cont/tichete/${ticketId}`);
    } catch (error) {
      if (error.message === 'INVALID_STATE' || error.message === 'MISSING_BASE_AMOUNT') {
        req.session.ticketFeedback = { error: 'Nu exista o contraoferta valida pentru acest ticket.' };
        return res.redirect(`/cont/tichete/${req.params.id}`);
      }
      next(error);
    }
  }
);

router.post(
  '/cont/tichete/:id/oferta/contraoferta/refuza',
  ensureRole('admin', 'superadmin'),
  requireActiveLicense({ roles: ['admin'] }),
  async (req, res, next) => {
    try {
    const ticketId = Number(req.params.id);
    const { ticket } = await getTicketWithReplies(ticketId);
    if (!ticket || ticket.kind !== 'offer') {
      return res.status(404).render('pages/404', {
        title: 'Ticket inexistent',
        description: 'Ticketul solicitat nu a fost gasit.'
      });
    }
    const user = req.session.user;
    if (
      user.role === 'admin' &&
      ticket.project_id &&
      ticket.assigned_admin_id &&
      ticket.assigned_admin_id !== user.id && ticket.assigned_editor_id !== user.id
    ) {
      return res.status(403).render('pages/403', {
        title: 'Acces restrictionat',
        description: 'Nu sunteti responsabil de acest ticket.'
      });
    }
    const offer = await getOfferByTicketId(ticketId);
    if (!offer || offer.status !== 'counter_submitted') {
      req.session.ticketFeedback = { error: 'Nu exista o contraoferta de refuzat.' };
      return res.redirect(`/cont/tichete/${ticketId}`);
    }
    await declineCounterOffer(offer.id);
    await addReply({
      ticketId,
      userId: user.id,
      message: 'Contraoferta clientului a fost refuzata. Vom reveni cu o noua propunere.'
    });
    req.session.ticketFeedback = {
      success: 'Ai refuzat contraoferta. Poti transmite o noua propunere din discutie.'
    };
      res.redirect(`/cont/tichete/${ticketId}`);
    } catch (error) {
      if (error.message === 'INVALID_STATE') {
        req.session.ticketFeedback = { error: 'Nu exista o contraoferta valida pentru acest ticket.' };
        return res.redirect(`/cont/tichete/${req.params.id}`);
      }
      next(error);
    }
  }
);

router.post(
  '/cont/tichete/:id/oferta/contract',
  ensureRole('admin', 'superadmin'),
  requireActiveLicense({ roles: ['admin'] }),
  async (req, res, next) => {
    try {
    const ticketId = Number(req.params.id);
    const { ticket } = await getTicketWithReplies(ticketId);
    if (!ticket || (ticket.kind !== 'offer' && ticket.kind !== 'contract')) {
      return res.status(404).render('pages/404', {
        title: 'Ticket inexistent',
        description: 'Ticketul solicitat nu a fost gasit.'
      });
    }
    const user = req.session.user;
    if (
      user.role === 'admin' &&
      ticket.project_id &&
      ticket.assigned_admin_id &&
      ticket.assigned_admin_id !== user.id && ticket.assigned_editor_id !== user.id
    ) {
      return res.status(403).render('pages/403', {
        title: 'Acces restrictionat',
        description: 'Nu sunteti responsabil de acest ticket.'
      });
    }
    const offer = await getOfferByTicketId(ticketId);
    if (!offer || offer.status !== 'accepted') {
      req.session.ticketFeedback = { error: 'Oferta trebuie sa fie acceptata inainte de a incepe semnarea.' };
      return res.redirect(`/cont/tichete/${ticketId}`);
    }
    await markTicketAsContract(ticketId);
    await addReply({
      ticketId,
      userId: user.id,
      message: 'Ticketul a fost transformat pentru semnarea contractului. Te rugam sa completezi datele personale.'
    });
    req.session.ticketFeedback = {
      success: 'Ai activat etapa de semnare. Clientul poate completa acum datele pentru contract.'
    };
      res.redirect(`/cont/tichete/${ticketId}`);
    } catch (error) {
      next(error);
    }
  }
);

router.post('/cont/tichete/:id/contract-date', async (req, res, next) => {
  try {
    const ticketId = Number(req.params.id);
    const { ticket } = await getTicketWithReplies(ticketId);
    if (!ticket || ticket.kind !== 'contract') {
      return res.status(404).render('pages/404', {
        title: 'Ticket inexistent',
        description: 'Ticketul solicitat nu a fost gasit.'
      });
    }
    const user = req.session.user;
    if (user.role !== 'client' || ticket.created_by !== user.id) {
      return res.status(403).render('pages/403', {
        title: 'Acces restrictionat',
        description: 'Nu aveti acces la acest ticket.'
      });
    }
    const offer = await getOfferByTicketId(ticketId);
    if (!offer || offer.status !== 'accepted') {
      req.session.ticketFeedback = { error: 'Oferta trebuie acceptata pentru a completa datele de contract.' };
      return res.redirect(`/cont/tichete/${ticketId}`);
    }
    const existingContract = await getContractDetailsByTicket(ticketId);
    if (existingContract && ['awaiting_admin', 'completed'].includes(existingContract.contractStage)) {
      req.session.ticketFeedback = {
        error: 'Datele beneficiarului nu mai pot fi modificate dupa semnarea contractului.'
      };
      return res.redirect(`/cont/tichete/${ticketId}`);
    }
    const schema = z.object({
      fullName: z.string().min(3),
      idType: z.string().trim().min(2),
      idSeries: z.string().trim().min(2),
      idNumber: z.string().trim().min(3),
      cnp: z.string().trim().optional(),
      address: z.string().min(5)
    });
    const payload = schema.parse(req.body);
    const normalizedCnp = payload.cnp && payload.cnp.trim().length ? payload.cnp.trim().replace(/\s+/g, '') : null;
    if (normalizedCnp && !isValidCNP(normalizedCnp)) {
      req.session.ticketFeedback = { error: 'CNP-ul introdus nu este valid.' };
      return res.redirect(`/cont/tichete/${ticketId}`);
    }
    const sanitizedCnp = normalizedCnp ? normalizedCnp.replace(/\D/g, '') : null;
    const clientData = {
      fullName: payload.fullName.trim(),
      idType: payload.idType.trim(),
      idSeries: payload.idSeries.trim(),
      idNumber: payload.idNumber.trim(),
      cnp: sanitizedCnp,
      address: payload.address.trim()
    };
    const draft = await generateDraftForContract({ offer, clientData });
    await saveContractDetails({
      ticketId,
      offerId: offer.id,
      userId: user.id,
      data: clientData,
      draft
    });
    await updateOfferContractText(offer.id, draft);
    await addReply({
      ticketId,
      userId: user.id,
      message: 'Datele personale pentru contract au fost completate.'
    });
    req.session.ticketFeedback = {
      success: 'Datele pentru contract au fost salvate si draftul contractului a fost generat.'
    };
    res.redirect(`/cont/tichete/${ticketId}#contract-draft`);
  } catch (error) {
    if (error instanceof z.ZodError) {
      req.session.ticketFeedback = { error: 'Te rugam sa completezi toate campurile obligatorii.' };
      return res.redirect(`/cont/tichete/${req.params.id}`);
    }
    next(error);
  }
});

router.post(
  '/cont/tichete/:id/merge',
  ensureRole('admin', 'superadmin'),
  requireActiveLicense({ roles: ['admin'] }),
  async (req, res, next) => {
    try {
    const ticketId = Number(req.params.id);
    const { ticket } = await getTicketWithReplies(ticketId);
    if (!ticket) {
      return res.status(404).render('pages/404', {
        title: 'Ticket inexistent',
        description: 'Ticketul solicitat nu a fost gasit.'
      });
    }
    const user = req.session.user;
    if (
      user.role === 'admin' &&
      ticket.project_id &&
      ticket.assigned_admin_id &&
      ticket.assigned_admin_id !== user.id && ticket.assigned_editor_id !== user.id
    ) {
      return res.status(403).render('pages/403', {
        title: 'Acces restrictionat',
        description: 'Ticketul nu este gestionat de tine.'
      });
    }
    if (ticket.merged_into_ticket_id) {
      req.session.ticketFeedback = {
        error: 'Acest ticket a fost deja fuzionat in altul si nu poate primi alte tickete.'
      };
      return res.redirect(`/cont/tichete/${ticketId}`);
    }
    const schema = z.object({
      ticketIds: z.preprocess(
        (value) => {
          if (Array.isArray(value)) {
            return value;
          }
          if (typeof value === 'string') {
            return value.trim().length ? [value] : [];
          }
          return [];
        },
        z.array(z.coerce.number().int().positive()).min(1)
      )
    });
    const data = schema.parse(req.body);
    const availableCandidates = await listMergeCandidates({
      baseTicketId: ticket.id,
      createdBy: ticket.created_by,
      actor: user
    });
    const candidateMap = new Map(availableCandidates.map((candidate) => [candidate.id, candidate]));
    const uniqueSelection = [...new Set(data.ticketIds)];
    const selectedIds = uniqueSelection.filter((id) => candidateMap.has(id));
    if (selectedIds.length === 0) {
      req.session.ticketFeedback = {
        error: 'Selecteaza cel putin un ticket eligibil pentru a realiza merge.'
      };
      return res.redirect(`/cont/tichete/${ticketId}`);
    }
    const { sources } = await mergeTickets({
      targetTicketId: ticket.id,
      sourceTicketIds: selectedIds,
      actorId: user.id
    });
    const mergedCodes = sources.map((entry) => `#${entry.display_code}`).join(', ');
    req.session.ticketFeedback = {
      success:
        sources.length === 1
          ? `Ticketul ${mergedCodes} a fost fuzionat in conversatia curenta.`
          : `Ticketele ${mergedCodes} au fost fuzionate in conversatia curenta.`
    };
    res.redirect(`/cont/tichete/${ticketId}`);
  } catch (error) {
    if (error instanceof z.ZodError) {
      req.session.ticketFeedback = {
        error: 'Selecteaza cel putin un ticket eligibil pentru a realiza merge.'
      };
      return res.redirect(`/cont/tichete/${req.params.id}`);
    }
    const handledErrors = new Map([
      ['MERGE_TARGET_NOT_FOUND', 'Ticketul tinta nu a fost gasit.'],
      ['MERGE_TARGET_ALREADY_MERGED', 'Ticketul tinta este deja fuzionat in alt ticket.'],
      ['MERGE_SOURCE_NOT_FOUND', 'Unul dintre ticketele selectate nu a fost gasit.'],
      ['MERGE_SOURCE_ALREADY_MERGED', 'Unul dintre ticketele selectate este deja fuzionat.'],
      ['MERGE_DIFFERENT_OWNER', 'Ticketele selectate apartin unui alt client si nu pot fi unite.'],
      ['MERGE_NO_TICKETS_SELECTED', 'Selecteaza cel putin un ticket eligibil pentru a realiza merge.'],
      ['MERGE_ACTOR_REQUIRED', 'Utilizatorul curent nu poate efectua aceasta actiune.']
    ]);
    if (handledErrors.has(error.message)) {
      req.session.ticketFeedback = { error: handledErrors.get(error.message) };
      return res.redirect(`/cont/tichete/${req.params.id}`);
    }
      next(error);
    }
  }
);

router.post('/cont/tichete/:id/contract/semnatura-client', async (req, res, next) => {
  try {
    const ticketId = Number(req.params.id);
    const { ticket } = await getTicketWithReplies(ticketId);
    if (!ticket || ticket.kind !== 'contract') {
      return res.status(404).render('pages/404', {
        title: 'Ticket inexistent',
        description: 'Ticketul solicitat nu a fost gasit.'
      });
    }
    const user = req.session.user;
    if (user.role !== 'client' || ticket.created_by !== user.id) {
      return res.status(403).render('pages/403', {
        title: 'Acces restrictionat',
        description: 'Nu aveti acces la acest ticket.'
      });
    }
    const offer = await getOfferByTicketId(ticketId);
    if (!offer || offer.status !== 'accepted') {
      req.session.ticketFeedback = { error: 'Oferta trebuie acceptata pentru a semna contractul.' };
      return res.redirect(`/cont/tichete/${ticketId}`);
    }
    const schema = z.object({ signatureData: z.string().min(20) });
    const data = schema.parse(req.body);
    let clientDraft;
    try {
      clientDraft = await applyClientSignature({ ticketId, signatureData: data.signatureData, offer });
    } catch (signatureError) {
      if (signatureError.message === 'INVALID_CONTRACT_STAGE') {
        req.session.ticketFeedback = {
          error: 'Contractul nu poate fi semnat in acest stadiu.'
        };
        return res.redirect(`/cont/tichete/${ticketId}`);
      }
      throw signatureError;
    }
    if (clientDraft) {
      await updateOfferContractText(offer.id, clientDraft);
    }
    await addReply({
      ticketId,
      userId: user.id,
      message: 'Beneficiarul a semnat contractul electronic.'
    });
    req.session.ticketFeedback = {
      success: 'Semnatura a fost aplicata. Contractul asteapta aprobarea administratorului.'
    };
    res.redirect(`/cont/tichete/${ticketId}`);
  } catch (error) {
    if (error instanceof z.ZodError) {
      req.session.ticketFeedback = { error: 'Semnatura electronica este necesara pentru a continua.' };
      return res.redirect(`/cont/tichete/${req.params.id}`);
    }
    next(error);
  }
});

router.post(
  '/cont/tichete/:id/contract/semnatura-admin',
  ensureRole('admin', 'superadmin'),
  requireActiveLicense({ roles: ['admin'] }),
  async (req, res, next) => {
    try {
      const ticketId = Number(req.params.id);
      const { ticket } = await getTicketWithReplies(ticketId);
      if (!ticket || ticket.kind !== 'contract') {
        return res.status(404).render('pages/404', {
          title: 'Ticket inexistent',
          description: 'Ticketul solicitat nu a fost gasit.'
        });
      }
      const user = req.session.user;
      if (
        user.role === 'admin' &&
        ticket.project_id &&
        ticket.assigned_admin_id &&
        ticket.assigned_admin_id !== user.id && ticket.assigned_editor_id !== user.id
      ) {
        return res.status(403).render('pages/403', {
          title: 'Acces restrictionat',
          description: 'Nu sunteti responsabil de acest ticket.'
        });
      }
      const offer = await getOfferByTicketId(ticketId);
      if (!offer || offer.status !== 'accepted') {
        req.session.ticketFeedback = { error: 'Oferta trebuie sa fie acceptata pentru a finaliza contractul.' };
        return res.redirect(`/cont/tichete/${ticketId}`);
      }
      const schema = z.object({ signatureData: z.string().min(20) });
      const data = schema.parse(req.body);
      let draftUpdate;
      try {
        draftUpdate = await applyAdminSignature({ ticketId, signatureData: data.signatureData, offer });
      } catch (signatureError) {
        if (signatureError.message === 'INVALID_CONTRACT_STAGE') {
          req.session.ticketFeedback = {
            error: 'Semnatura beneficiarului este necesara inainte de a finaliza contractul.'
          };
          return res.redirect(`/cont/tichete/${ticketId}`);
        }
        throw signatureError;
      }
      await updateOfferContractText(offer.id, draftUpdate.draft);
      await addReply({
        ticketId,
        userId: user.id,
        message: 'Administratorul a semnat contractul electronic.'
      });
      req.session.ticketFeedback = {
        success: `Contractul a fost finalizat. Numar: ${draftUpdate.contractNumber}.`
      };
      res.redirect(`/cont/tichete/${ticketId}`);
    } catch (error) {
      if (error instanceof z.ZodError) {
        req.session.ticketFeedback = { error: 'Deseneaza semnatura pentru a o aplica pe contract.' };
        return res.redirect(`/cont/tichete/${req.params.id}`);
      }
      next(error);
    }
  }
);

router.post(
  '/cont/tichete/:id/proiect',
  ensureRole('admin', 'superadmin'),
  requireActiveLicense({ roles: ['admin'] }),
  async (req, res, next) => {
    try {
      const ticketId = Number(req.params.id);
      const ticket = await getTicketById(ticketId);
      if (!ticket || ticket.kind !== 'contract') {
        return res.status(404).render('pages/404', {
          title: 'Ticket inexistent',
          description: 'Ticketul solicitat nu a fost gasit.'
        });
      }
      const user = req.session.user;
      if (
        user.role === 'admin' &&
        ticket.project_id &&
        ticket.assigned_admin_id &&
        ticket.assigned_admin_id !== user.id && ticket.assigned_editor_id !== user.id
      ) {
        return res.status(403).render('pages/403', {
          title: 'Acces restrictionat',
          description: 'Nu sunteti responsabil de acest ticket.'
        });
      }
      const contractDetails = await getContractDetailsByTicket(ticketId);
      if (!contractDetails || contractDetails.contractStage !== 'completed') {
        req.session.ticketFeedback = {
          error: 'Contractul trebuie semnat de ambele parti inainte de a crea proiectul.'
        };
        return res.redirect(`/cont/tichete/${ticketId}`);
      }

      try {
        const { projectId, projectCode } = await createProjectFromTicket({
          ticketId,
          actor: user
        });
        req.session.projectFeedback = {
          success: `Proiectul ${projectCode} a fost creat si este gata pentru organizarea etapelor.`
        };
        return res.redirect(`/cont/proiecte/${projectId}`);
      } catch (error) {
        const errorMessages = {
          CONTRACT_NOT_COMPLETED: 'Contractul trebuie semnat de ambele parti.',
          PROJECT_ALREADY_EXISTS: 'Exista deja un proiect creat pentru acest ticket.',
          CLIENT_NOT_IDENTIFIED: 'Nu am putut identifica clientul pentru acest ticket.'
        };
        if (errorMessages[error.message]) {
          req.session.ticketFeedback = { error: errorMessages[error.message] };
          return res.redirect(`/cont/tichete/${ticketId}`);
        }
        throw error;
      }
    } catch (error) {
      next(error);
    }
});

router.post(
  '/cont/tichete/:id/contract/descarca',
  ensureRole('client', 'admin', 'superadmin'),
  async (req, res, next) => {
    try {
      const ticketId = Number(req.params.id);
      const { ticket } = await getTicketWithReplies(ticketId);
      if (!ticket || ticket.kind !== 'contract') {
        return res.status(404).render('pages/404', {
          title: 'Ticket inexistent',
          description: 'Ticketul solicitat nu a fost gasit.'
        });
      }
      const user = req.session.user;
      if (user.role === 'client' && ticket.created_by !== user.id) {
        return res.status(403).render('pages/403', {
          title: 'Acces restrictionat',
          description: 'Nu aveti acces la acest ticket.'
        });
      }
      if (
        user.role === 'admin' &&
        ticket.project_id &&
        ticket.assigned_admin_id &&
        ticket.assigned_admin_id !== user.id && ticket.assigned_editor_id !== user.id
      ) {
        return res.status(403).render('pages/403', {
          title: 'Acces restrictionat',
          description: 'Nu sunteti responsabil de acest ticket.'
        });
      }
      const contractDetails = await getContractDetailsByTicket(ticketId);
      if (!contractDetails || !contractDetails.contractDraft) {
        req.session.ticketFeedback = {
          error: 'Contractul nu este disponibil pentru descarcare in acest moment.'
        };
        return res.redirect(`/cont/tichete/${ticketId}`);
      }
      if (contractDetails.contractStage !== 'completed') {
        req.session.ticketFeedback = {
          error: 'Contractul poate fi descarcat doar dupa semnarea de catre ambele parti.'
        };
        return res.redirect(`/cont/tichete/${ticketId}`);
      }
      const { token } = createContractDownloadToken({ ticketId, userId: user.id });
      return res.redirect(
        `/cont/tichete/${ticketId}/contract/descarca?token=${encodeURIComponent(token)}`
      );
    } catch (error) {
      next(error);
    }
  }
);

router.get(
  '/cont/tichete/:id/contract/descarca',
  ensureRole('client', 'admin', 'superadmin'),
  async (req, res, next) => {
    try {
      const ticketId = Number(req.params.id);
      const { ticket } = await getTicketWithReplies(ticketId);
      if (!ticket || ticket.kind !== 'contract') {
        return res.status(404).render('pages/404', {
          title: 'Ticket inexistent',
          description: 'Ticketul solicitat nu a fost gasit.'
        });
      }
      const user = req.session.user;
      if (user.role === 'client' && ticket.created_by !== user.id) {
        return res.status(403).render('pages/403', {
          title: 'Acces restrictionat',
          description: 'Nu aveti acces la acest ticket.'
        });
      }
      if (
        user.role === 'admin' &&
        ticket.project_id &&
        ticket.assigned_admin_id &&
        ticket.assigned_admin_id !== user.id && ticket.assigned_editor_id !== user.id
      ) {
        return res.status(403).render('pages/403', {
          title: 'Acces restrictionat',
          description: 'Nu sunteti responsabil de acest ticket.'
        });
      }
      const contractDetails = await getContractDetailsByTicket(ticketId);
      if (!contractDetails || !contractDetails.contractDraft) {
        req.session.ticketFeedback = {
          error: 'Contractul nu este disponibil pentru descarcare in acest moment.'
        };
        return res.redirect(`/cont/tichete/${ticketId}`);
      }
      if (contractDetails.contractStage !== 'completed') {
        req.session.ticketFeedback = {
          error: 'Contractul poate fi descarcat doar dupa semnarea de catre ambele parti.'
        };
        return res.redirect(`/cont/tichete/${ticketId}`);
      }
      const token = typeof req.query.token === 'string' ? req.query.token : null;
      if (!token) {
        req.session.ticketFeedback = {
          error: 'Tokenul de descarcare lipseste sau este invalid. Genereaza unul nou din pagina contractului.'
        };
        return res.redirect(`/cont/tichete/${ticketId}`);
      }
      const validation = consumeContractDownloadToken({
        token,
        ticketId,
        userId: user.id
      });
      if (!validation) {
        req.session.ticketFeedback = {
          error: 'Linkul de descarcare a expirat sau nu este valid. Genereaza un token nou din pagina contractului.'
        };
        return res.redirect(`/cont/tichete/${ticketId}`);
      }
      const identifier =
        contractDetails.contractNumber ||
        ticket.display_code ||
        `ticket-${ticketId}`;
      const sanitizedIdentifier = identifier
        .toString()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
      if (user.role === 'client') {
        await addTicketLog({
          ticketId,
          message: 'Beneficiarul a descarcat contractul semnat.',
          actor: user
        });
      }
      const copyLabel = user.role === 'client' ? 'COPIE BENEFICIAR' : 'COPIE FURNIZOR';
      const pdfBuffer = await createPdfBufferFromHtml(contractDetails.contractDraft, { copyLabel });
      const fileName = `contract-${sanitizedIdentifier || ticketId}.pdf`;
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
      return res.send(pdfBuffer);
    } catch (error) {
      next(error);
    }
  }
);

router.post(
  '/cont/tichete/:id/status',
  ensureRole('admin', 'superadmin'),
  requireActiveLicense({ roles: ['admin'] }),
  async (req, res, next) => {
    try {
      const schema = z.object({ status: z.enum(['deschis', 'in-analiza', 'rezolvat']) });
      const data = schema.parse(req.body);
      const { ticket } = await getTicketWithReplies(Number(req.params.id));
      if (!ticket) {
        return res.status(404).render('pages/404', {
          title: 'Ticket inexistent',
          description: 'Ticketul solicitat nu a fost gasit.'
        });
      }
      if (req.session.user.role === 'admin' && ticket.project_id && ticket.assigned_admin_id !== req.session.user.id) {
        return res.status(403).render('pages/403', {
          title: 'Acces restrictionat',
          description: 'Nu sunteti responsabil de acest ticket.'
        });
      }
      if (ticket.merged_into_ticket_id) {
        req.session.ticketFeedback = {
          error: 'Ticketul este fuzionat in altul si nu mai poate avea statusul modificat.'
        };
        return res.redirect(`/cont/tichete/${req.params.id}`);
      }
      await updateTicketStatus(ticket.id, data.status);
      res.redirect(`/cont/tichete/${req.params.id}`);
    } catch (error) {
      next(error);
    }
  }
);

router
  .route('/cont/proiecte/:id/status')
  .post(ensureRole('admin', 'superadmin', 'redactor'), requireActiveLicense(), async (req, res, next) => {
    try {
      const schema = z.object({
        action: z.enum(['advance', 'previous', 'set']).default('advance'),
        status: z.string().optional(),
        notes: z.string().optional()
      });
      const data = schema.parse(req.body);
      const projectId = Number(req.params.id);
      const project = await getProjectById(projectId);
      if (!project) {
        return res.status(404).render('pages/404', {
          title: 'Proiect inexistent',
          description: 'Proiectul solicitat nu a fost gasit.'
        });
      }
      const user = req.session.user;
      const isSuperAdmin = user.role === 'superadmin';
      if (user.role === 'redactor' && project.assigned_editor_id !== user.id) {
        return res.status(403).render('pages/403', {
          title: 'Acces restrictionat',
          description: 'Nu sunteti asignat pe acest proiect.'
        });
      }
      if (user.role === 'admin' && project.assigned_admin_id !== user.id && project.assigned_editor_id !== user.id) {
        return res.status(403).render('pages/403', {
          title: 'Acces restrictionat',
          description: 'Nu sunteti responsabil de acest proiect.'
        });
      }

      let targetStatus = null;
      if (data.action === 'advance') {
        targetStatus = getNextProjectStatusId(project.status);
        if (!targetStatus) {
          req.session.projectFeedback = {
            error: 'Proiectul este deja în ultima etapă disponibilă.'
          };
          return res.redirect(`/cont/proiecte/${projectId}`);
        }
      } else if (data.action === 'previous') {
        if (!isSuperAdmin) {
          return res.status(403).render('pages/403', {
            title: 'Acces restrictionat',
            description: 'Doar superadministratorii pot reveni la etapa anterioară.'
          });
        }
        targetStatus = getPreviousProjectStatusId(project.status);
        if (!targetStatus) {
          req.session.projectFeedback = {
            error: 'Nu există o etapă anterioară în flux pentru acest proiect.'
          };
          return res.redirect(`/cont/proiecte/${projectId}`);
        }
      } else {
        if (!isSuperAdmin) {
          return res.status(403).render('pages/403', {
            title: 'Acces restrictionat',
            description: 'Doar superadministratorii pot selecta manual statusul proiectului.'
          });
        }
        if (!data.status || !isValidProjectStatus(data.status)) {
          req.session.projectFeedback = {
            error: 'Selecteaza un status valid pentru proiect.'
          };
          return res.redirect(`/cont/proiecte/${projectId}`);
        }
        targetStatus = data.status;
      }

      if (targetStatus) {
        const targetFlowIndex = PROJECT_FLOW_STATUSES.findIndex((status) => status.id === targetStatus);
        if (
          DOCS_VALIDATED_FLOW_INDEX !== -1 &&
          targetFlowIndex !== -1 &&
          targetFlowIndex > DOCS_VALIDATED_FLOW_INDEX &&
          !project.assigned_editor_id
        ) {
          req.session.projectFeedback = {
            error:
              'Aloca un redactor inainte de a trece proiectul peste etapa „Validare Documentatie / Alocare Redactor”.',
            activeTab: 'detalii'
          };
          return res.redirect(`/cont/proiecte/${projectId}`);
        }
      }

      await updateProjectStatus({
        projectId: project.id,
        status: targetStatus,
        notes: data.notes || null,
        actor: user
      });

      const statusInfo = getProjectStatusById(targetStatus);
      const statusLabel = statusInfo?.label || targetStatus;
      req.session.projectFeedback = {
        success: `Statusul proiectului a fost actualizat la „${statusLabel}”.`
      };

      res.redirect(`/cont/proiecte/${projectId}`);
    } catch (error) {
      if (error instanceof z.ZodError) {
        req.session.projectFeedback = {
          error: 'Completeaza corect campurile pentru actualizarea statusului.'
        };
        return res.redirect(`/cont/proiecte/${req.params.id}`);
      }
      next(error);
    }
  });

router
  .route('/cont/proiecte/creeaza')
  .get(ensureRole('admin', 'superadmin'), requireActiveLicense({ roles: ['admin'] }), async (req, res, next) => {
    try {
      await renderProjectCreatePage(res);
    } catch (error) {
      next(error);
    }
  })
  .post(ensureRole('admin', 'superadmin'), requireActiveLicense({ roles: ['admin'] }), async (req, res, next) => {
    const fallbackFormData = {
      title: typeof req.body.title === 'string' ? req.body.title : '',
      description: typeof req.body.description === 'string' ? req.body.description : '',
      degreeLevel: typeof req.body.degreeLevel === 'string' ? req.body.degreeLevel : '',
      deadline: typeof req.body.deadline === 'string' ? req.body.deadline : '',
      clientId: typeof req.body.clientId === 'string' ? req.body.clientId : '',
      assignedAdminId: typeof req.body.assignedAdminId === 'string' ? req.body.assignedAdminId : '',
      assignedRedactorId: typeof req.body.assignedRedactorId === 'string' ? req.body.assignedRedactorId : ''
    };
    try {
      const schema = z.object({
        title: z.string().trim().min(5, 'Titlul trebuie sa aiba cel putin 5 caractere.'),
        description: z.string().trim().min(10, 'Descrierea trebuie sa contina minimum 10 caractere.'),
        degreeLevel: z.string().trim().min(3, 'Completeaza nivelul de studiu.'),
        deadline: z
          .string()
          .trim()
          .regex(/^\d{4}-\d{2}-\d{2}$/u, 'Selecteaza un deadline valid (format AAAA-LL-ZZ).'),
        clientId: z.string().trim().regex(/^\d+$/u, 'Selecteaza un client valid.'),
        assignedAdminId: z
          .string()
          .trim()
          .optional()
          .refine((value) => !value || /^\d+$/u.test(value), 'Selecteaza un administrator valid.'),
        assignedRedactorId: z
          .string()
          .trim()
          .optional()
          .refine((value) => !value || /^\d+$/u.test(value), 'Selecteaza un redactor valid.')
      });
      const data = schema.parse(req.body);
      const user = req.session.user;
      const normalizedClientId = Number(data.clientId);
      const normalizedAdminId = data.assignedAdminId ? Number(data.assignedAdminId) : null;
      const normalizedRedactorId = data.assignedRedactorId ? Number(data.assignedRedactorId) : null;

      const [client, adminUser, redactorUser] = await Promise.all([
        getUserById(normalizedClientId),
        normalizedAdminId ? getUserById(normalizedAdminId) : null,
        normalizedRedactorId ? getUserById(normalizedRedactorId) : null
      ]);

      if (!client || client.role !== 'client') {
        const fieldErrors = { clientId: 'Clientul selectat nu exista sau nu este activ.' };
        return renderProjectCreatePage(res, { formData: fallbackFormData, formErrors: fieldErrors }, 400);
      }

      if (normalizedAdminId && (!adminUser || !['admin', 'superadmin'].includes(adminUser.role))) {
        const fieldErrors = { assignedAdminId: 'Administratorul selectat nu este valid.' };
        return renderProjectCreatePage(res, { formData: fallbackFormData, formErrors: fieldErrors }, 400);
      }

      if (normalizedRedactorId && (!redactorUser || redactorUser.role !== 'redactor')) {
        const fieldErrors = { assignedRedactorId: 'Redactorul selectat nu este valid.' };
        return renderProjectCreatePage(res, { formData: fallbackFormData, formErrors: fieldErrors }, 400);
      }

      const resolvedAdminId = normalizedAdminId
        ? normalizedAdminId
        : user.role === 'admin'
        ? user.id
        : null;

      const { id: projectId } = await createProject({
        title: data.title,
        description: data.description,
        degreeLevel: data.degreeLevel,
        deadline: data.deadline,
        clientId: normalizedClientId,
        assignedAdminId: resolvedAdminId,
        assignedRedactorId: normalizedRedactorId || null,
        actor: req.session.user,
        initialNote: 'Proiect creat manual din panoul de control.'
      });
      res.redirect(`/cont/proiecte/${projectId}`);
    } catch (error) {
      if (error instanceof z.ZodError) {
        const fieldErrors = buildFieldErrorsFromZod(error);
        return renderProjectCreatePage(res, { formData: fallbackFormData, formErrors: fieldErrors }, 400);
      }
      if (error.code === 'ER_NO_REFERENCED_ROW_2') {
        return renderProjectCreatePage(
          res,
          {
            formData: fallbackFormData,
            formErrors: {
              general: 'Nu am putut salva proiectul deoarece unele selectii nu sunt valide. Verifica informatiile si reincearca.'
            }
          },
          400
        );
      }
      next(error);
    }
  });

router.post('/cont/proiecte/:id/fisiere', requireActiveLicense(), (req, res, next) => {
  projectFileUpload.array('files', STAFF_MAX_PROJECT_FILES)(req, res, async (err) => {
    const projectId = Number(req.params.id);
    const redirectToFiles = () => res.redirect(`/cont/proiecte/${projectId}?tab=fisiere`);

    if (err) {
      const errorMessage =
        err.message === 'INVALID_FILE_TYPE'
          ? 'Formatele permise sunt DOCX, PDF, JPG si PNG.'
          : err.code === 'LIMIT_FILE_SIZE'
          ? 'Unul dintre fisiere depaseste dimensiunea maxima admisa.'
          : 'Incarcarea fisierelor a esuat. Incearca din nou.';
      req.session.projectFeedback = {
        error: errorMessage,
        activeTab: 'fisiere'
      };
      return redirectToFiles();
    }

    const files = Array.isArray(req.files) ? req.files : [];
    if (!files.length) {
      req.session.projectFeedback = {
        error: 'Selecteaza cel putin un fisier pentru incarcare.',
        activeTab: 'fisiere'
      };
      return redirectToFiles();
    }

    const cleanupFiles = async () => {
      await Promise.all(
        files.map((file) =>
          fs.unlink(file.path).catch((unlinkError) => {
            if (unlinkError.code !== 'ENOENT') {
              console.error('Nu s-a putut sterge fisierul incarcat temporar', unlinkError);
            }
          })
        )
      );
    };

    try {
      const project = await getProjectById(projectId);
      if (!project) {
        await cleanupFiles();
        return res.status(404).render('pages/404', {
          title: 'Proiect inexistent',
          description: 'Proiectul solicitat nu a fost gasit.'
        });
      }

      const user = req.session.user;
      const userRole = user.role;
      const allowedRoles = new Set(['client', 'admin', 'superadmin', 'redactor']);
      if (!allowedRoles.has(userRole)) {
        await cleanupFiles();
        return res.status(403).render('pages/403', {
          title: 'Acces restrictionat',
          description: 'Nu aveti permisiunea de a incarca fisiere in acest proiect.'
        });
      }

      if (userRole === 'client' && project.client_id !== user.id) {
        await cleanupFiles();
        return res.status(403).render('pages/403', {
          title: 'Acces restrictionat',
          description: 'Nu aveti acces la acest proiect.'
        });
      }
      if (userRole === 'redactor' && project.assigned_editor_id !== user.id) {
        await cleanupFiles();
        return res.status(403).render('pages/403', {
          title: 'Acces restrictionat',
          description: 'Nu sunteti asignat pe acest proiect.'
        });
      }
      if (userRole === 'admin' && project.assigned_admin_id !== user.id && project.assigned_editor_id !== user.id) {
        await cleanupFiles();
        return res.status(403).render('pages/403', {
          title: 'Acces restrictionat',
          description: 'Nu sunteti responsabil de acest proiect.'
        });
      }

      const origin = userRole === 'client' ? 'client' : 'staff';
      const maxFiles = origin === 'client' ? CLIENT_MAX_PROJECT_FILES : STAFF_MAX_PROJECT_FILES;
      const maxFileSize = origin === 'client' ? CLIENT_MAX_FILE_SIZE : STAFF_MAX_FILE_SIZE;
      const existingCount = await countProjectFilesByOrigin(projectId, origin);
      if (existingCount + files.length > maxFiles) {
        await cleanupFiles();
        req.session.projectFeedback = {
          error:
            origin === 'client'
              ? `Ai atins limita de ${CLIENT_MAX_PROJECT_FILES} fisiere. Sterge un fisier existent sau contacteaza administratorul.`
              : `Limita de ${STAFF_MAX_PROJECT_FILES} fisiere a fost depasita pentru acest proiect.`,
          activeTab: 'fisiere'
        };
        return redirectToFiles();
      }

      if (origin === 'client') {
        const uploadWindowOpen =
          project.status === 'waiting_docs' || (await hasOpenDocumentRequests(projectId));
        if (!uploadWindowOpen) {
          await cleanupFiles();
          req.session.projectFeedback = {
            error:
              'In acest moment nu se accepta documentatie suplimentara. Asteapta solicitarea echipei.',
            activeTab: 'fisiere'
          };
          return redirectToFiles();
        }
      }

      const oversizeFiles = files.filter((file) => file.size > maxFileSize);
      if (oversizeFiles.length) {
        await cleanupFiles();
        req.session.projectFeedback = {
          error:
            origin === 'client'
              ? 'Fiecare fisier trebuie sa aiba maximum 5 MB.'
              : 'Fiecare fisier trebuie sa aiba maximum 30 MB.',
          activeTab: 'fisiere'
        };
        return redirectToFiles();
      }

      const uploadedNames = [];
      for (const file of files) {
        const storedName = file.storedName || path.basename(file.path);
        await createProjectFile({
          projectId,
          uploaderId: user.id,
          uploaderRole: userRole,
          origin,
          originalName: file.originalname,
          storedName,
          mimeType: file.mimetype,
          fileSize: file.size
        });
        uploadedNames.push(file.originalname);
      }

      const uploadMessagePrefix =
        userRole === 'client'
          ? 'Clientul a incarcat documentatia'
          : 'Echipa a incarcat un fisier pentru client';
      const visibility = userRole === 'client' ? 'internal' : 'public';
      const timelineMessage = `${uploadMessagePrefix}: ${uploadedNames.join(', ')}.`;
      await addProjectComment({
        projectId,
        message: timelineMessage,
        actor: user,
        visibility
      });

      req.session.projectFeedback = {
        success:
          uploadedNames.length === 1
            ? `Fisierul "${uploadedNames[0]}" a fost incarcat cu succes.`
            : `${uploadedNames.length} fisiere au fost incarcate cu succes.`,
        activeTab: 'fisiere'
      };
      return redirectToFiles();
    } catch (error) {
      await cleanupFiles();
      return next(error);
    }
  });
});

router.post(
  '/cont/proiecte/:id/fisiere/:fileId/sterge',
  ensureRole('admin', 'superadmin', 'redactor'),
  async (req, res, next) => {
    try {
      const projectId = Number(req.params.id);
      const fileId = Number(req.params.fileId);
      const redirectToFiles = () => res.redirect(`/cont/proiecte/${projectId}?tab=fisiere`);

      const project = await getProjectById(projectId);
      if (!project) {
        return res.status(404).render('pages/404', {
          title: 'Proiect inexistent',
          description: 'Proiectul solicitat nu a fost gasit.'
        });
      }

      const user = req.session.user;
      if (user.role === 'redactor' && project.assigned_editor_id !== user.id) {
        return res.status(403).render('pages/403', {
          title: 'Acces restrictionat',
          description: 'Nu sunteti asignat pe acest proiect.'
        });
      }
      if (user.role === 'admin' && project.assigned_admin_id !== user.id && project.assigned_editor_id !== user.id) {
        return res.status(403).render('pages/403', {
          title: 'Acces restrictionat',
          description: 'Nu sunteti responsabil de acest proiect.'
        });
      }

      const file = await getProjectFileById(fileId);
      if (!file || file.project_id !== projectId) {
        req.session.projectFeedback = {
          error: 'Fișierul solicitat nu există sau a fost deja șters.',
          activeTab: 'fisiere'
        };
        return redirectToFiles();
      }

      const isClientFile = file.origin === 'client';
      const isStaffFile = file.origin === 'staff';

      if (isClientFile && user.role !== 'superadmin') {
        req.session.projectFeedback = {
          error: 'Doar superadministratorii pot șterge fișiere încărcate de client.',
          activeTab: 'fisiere'
        };
        return redirectToFiles();
      }

      if (!isClientFile && !isStaffFile) {
        req.session.projectFeedback = {
          error: 'Fișierul selectat nu poate fi gestionat din această interfață.',
          activeTab: 'fisiere'
        };
        return redirectToFiles();
      }

      let canDelete = false;
      if (isClientFile) {
        canDelete = user.role === 'superadmin';
      } else {
        const isOwnFile = file.uploader_id && user.id === file.uploader_id;
        const actorLevel = ROLE_HIERARCHY[user.role] || 0;
        const uploaderLevel = ROLE_HIERARCHY[file.uploader_role] || 0;
        const canManageOthers = ['admin', 'superadmin'].includes(user.role);
        canDelete = isOwnFile || (canManageOthers && uploaderLevel > 0 && uploaderLevel <= actorLevel);
      }

      if (!canDelete) {
        req.session.projectFeedback = {
          error: 'Nu aveți permisiunea de a șterge acest fișier.',
          activeTab: 'fisiere'
        };
        return redirectToFiles();
      }

      await softDeleteProjectFile(fileId, { actor: user });

      const relativePath = path.join(String(projectId), file.stored_name);
      const absolutePath = resolveStoredFilePath(relativePath);
      try {
        await fs.unlink(absolutePath);
      } catch (unlinkError) {
        if (unlinkError.code !== 'ENOENT') {
          console.error('Nu s-a putut sterge fisierul din stocare', unlinkError);
        }
      }

      req.session.projectFeedback = {
        success: `Fișierul „${file.original_name}” a fost șters.`,
        activeTab: 'fisiere'
      };
      return redirectToFiles();
    } catch (error) {
      return next(error);
    }
  }
);

router.post(
  '/cont/proiecte/:id/solicitare-documentatie',
  ensureRole('admin', 'superadmin', 'redactor'),
  async (req, res, next) => {
    try {
      const schema = z.object({
        message: z.string().min(5)
      });
      const data = schema.parse(req.body);
      const projectId = Number(req.params.id);
      const project = await getProjectById(projectId);
      if (!project) {
        return res.status(404).render('pages/404', {
          title: 'Proiect inexistent',
          description: 'Proiectul solicitat nu a fost gasit.'
        });
      }
      const user = req.session.user;
      if (user.role === 'redactor' && project.assigned_editor_id !== user.id) {
        return res.status(403).render('pages/403', {
          title: 'Acces restrictionat',
          description: 'Nu sunteti asignat pe acest proiect.'
        });
      }
      if (user.role === 'admin' && project.assigned_admin_id !== user.id && project.assigned_editor_id !== user.id) {
        return res.status(403).render('pages/403', {
          title: 'Acces restrictionat',
          description: 'Nu sunteti responsabil de acest proiect.'
        });
      }

      const requestId = await createDocumentRequest({
        projectId,
        requestedBy: user.id,
        message: data.message
      });

      await addProjectComment({
        projectId,
        message: `Echipa a solicitat documentatie suplimentara: ${data.message}`,
        actor: user,
        visibility: 'public'
      });

      req.session.projectFeedback = {
        success: 'Solicitarea pentru documentatie suplimentara a fost trimisa catre client.',
        activeTab: 'fisiere'
      };
      return res.redirect(`/cont/proiecte/${projectId}?tab=fisiere#request-${requestId}`);
    } catch (error) {
      if (error instanceof z.ZodError) {
        req.session.projectFeedback = {
          error: 'Completeaza mesajul pentru documentatia necesara.',
          activeTab: 'fisiere'
        };
        return res.redirect(`/cont/proiecte/${req.params.id}?tab=fisiere`);
      }
      return next(error);
    }
  }
);

router.post(
  '/cont/proiecte/:id/solicitare-documentatie/:requestId/inchide',
  ensureRole('admin', 'superadmin', 'redactor'),
  async (req, res, next) => {
    try {
      const projectId = Number(req.params.id);
      const requestId = Number(req.params.requestId);
      const project = await getProjectById(projectId);
      if (!project) {
        return res.status(404).render('pages/404', {
          title: 'Proiect inexistent',
          description: 'Proiectul solicitat nu a fost gasit.'
        });
      }
      const user = req.session.user;
      if (user.role === 'redactor' && project.assigned_editor_id !== user.id) {
        return res.status(403).render('pages/403', {
          title: 'Acces restrictionat',
          description: 'Nu sunteti asignat pe acest proiect.'
        });
      }
      if (user.role === 'admin' && project.assigned_admin_id !== user.id && project.assigned_editor_id !== user.id) {
        return res.status(403).render('pages/403', {
          title: 'Acces restrictionat',
          description: 'Nu sunteti responsabil de acest proiect.'
        });
      }
      const request = await getDocumentRequestById(requestId);
      if (!request || request.project_id !== projectId) {
        req.session.projectFeedback = {
          error: 'Solicitarea de documentatie nu a fost gasita.',
          activeTab: 'fisiere'
        };
        return res.redirect(`/cont/proiecte/${projectId}?tab=fisiere`);
      }
      if (request.status === 'closed') {
        req.session.projectFeedback = {
          error: 'Aceasta solicitare este deja marcata ca rezolvata.',
          activeTab: 'fisiere'
        };
        return res.redirect(`/cont/proiecte/${projectId}?tab=fisiere`);
      }

      await closeDocumentRequest({ requestId, closedBy: user.id });
      await addProjectComment({
        projectId,
        message: 'Solicitarea de documentatie suplimentara a fost marcata ca rezolvata.',
        actor: user,
        visibility: 'public'
      });

      req.session.projectFeedback = {
        success: 'Solicitarea a fost marcata ca rezolvata.',
        activeTab: 'fisiere'
      };
      return res.redirect(`/cont/proiecte/${projectId}?tab=fisiere`);
    } catch (error) {
      return next(error);
    }
  }
);

router.get('/cont/proiecte/:id/fisiere/:fileId/descarca', async (req, res, next) => {
  try {
    const projectId = Number(req.params.id);
    const fileId = Number(req.params.fileId);
    const project = await getProjectById(projectId);
    if (!project) {
      return res.status(404).render('pages/404', {
        title: 'Proiect inexistent',
        description: 'Proiectul solicitat nu a fost gasit.'
      });
    }

    const file = await getProjectFileById(fileId);
    if (!file || file.project_id !== projectId) {
      return res.status(404).render('pages/404', {
        title: 'Fisier indisponibil',
        description: 'Fisierul solicitat nu exista sau nu mai este disponibil.'
      });
    }

    const user = req.session.user;
    if (user.role === 'client' && project.client_id !== user.id) {
      return res.status(403).render('pages/403', {
        title: 'Acces restrictionat',
        description: 'Nu aveti acces la acest proiect.'
      });
    }
    if (user.role === 'redactor' && project.assigned_editor_id !== user.id) {
      return res.status(403).render('pages/403', {
        title: 'Acces restrictionat',
        description: 'Nu sunteti asignat pe acest proiect.'
      });
    }
    if (user.role === 'admin' && project.assigned_admin_id !== user.id && project.assigned_editor_id !== user.id) {
      return res.status(403).render('pages/403', {
        title: 'Acces restrictionat',
        description: 'Nu sunteti responsabil de acest proiect.'
      });
    }

    const relativePath = path.join(String(projectId), file.stored_name);
    const absolutePath = resolveStoredFilePath(relativePath);
    try {
      await fs.access(absolutePath);
    } catch (accessError) {
      if (accessError.code === 'ENOENT') {
        return res.status(404).render('pages/404', {
          title: 'Fisier indisponibil',
          description: 'Fisierul solicitat nu exista sau nu mai este disponibil.'
        });
      }
      throw accessError;
    }

    return res.download(absolutePath, file.original_name, (downloadError) => {
      if (downloadError) {
        if (!res.headersSent) {
          next(downloadError);
        }
        return;
      }
      if (user.role === 'client') {
        addProjectComment({
          projectId,
          message: `Clientul a descarcat fisierul ${file.original_name}.`,
          actor: user,
          visibility: 'internal'
        }).catch((logError) => {
          console.error('Nu s-a putut inregistra logul pentru descarcarea fisierului', logError);
        });
      }
    });
  } catch (error) {
    next(error);
  }
});

router.post('/cont/proiecte/:id/finalizeaza', ensureRole('superadmin'), async (req, res, next) => {
  try {
    const projectId = Number(req.params.id);
    const project = await getProjectById(projectId);
    if (!project) {
      return res.status(404).render('pages/404', {
        title: 'Proiect inexistent',
        description: 'Proiectul solicitat nu a fost gasit.'
      });
    }
    if (project.status !== 'completed') {
      req.session.projectFeedback = {
        error: 'Proiectul poate fi finalizat manual doar atunci când se află în starea „Proiect Finalizat / Arhivat”.',
        activeTab: 'timeline'
      };
      return res.redirect(`/cont/proiecte/${projectId}?tab=timeline`);
    }
    const finalized = await finalizeProjectConversation(projectId, { actor: req.session.user, reason: 'manual' });
    req.session.projectFeedback = finalized
      ? {
          success: 'Proiectul a fost arhivat. Discuțiile au fost închise imediat.',
          activeTab: 'timeline'
        }
      : {
          error: 'Proiectul este deja arhivat.',
          activeTab: 'timeline'
        };
    return res.redirect(`/cont/proiecte/${projectId}?tab=timeline`);
  } catch (error) {
    return next(error);
  }
});

router
  .route('/cont/proiecte/:id/alocare')
  .post(ensureRole('admin', 'superadmin'), async (req, res, next) => {
    try {
      const schema = z.object({
        adminId: z.string().optional(),
        redactorId: z.string().optional()
      });
      const data = schema.parse(req.body);
      const project = await getProjectById(Number(req.params.id));
      if (!project) {
        return res.status(404).render('pages/404', {
          title: 'Proiect inexistent',
          description: 'Proiectul solicitat nu a fost gasit.'
        });
      }
      const user = req.session.user;
      if (user.role === 'admin' && project.assigned_admin_id !== user.id && project.assigned_editor_id !== user.id) {
        return res.status(403).render('pages/403', {
          title: 'Acces restrictionat',
          description: 'Nu sunteti responsabil de acest proiect.'
        });
      }
      const desiredAdminId =
        typeof data.adminId === 'string'
          ? data.adminId.trim().length
            ? Number(data.adminId)
            : null
          : undefined;
      const desiredRedactorId =
        typeof data.redactorId === 'string'
          ? data.redactorId.trim().length
            ? Number(data.redactorId)
            : null
          : undefined;
      if (desiredRedactorId) {
        const redactorUser = await getUserById(desiredRedactorId);
        if (!redactorUser || !['redactor', 'admin', 'superadmin'].includes(redactorUser.role)) {
          req.session.projectFeedback = {
            error: 'Selecteaza un membru valid al echipei pentru rolul de redactor.',
            activeTab: 'detalii'
          };
          return res.redirect(`/cont/proiecte/${project.id}`);
        }
        if (user.role === 'admin') {
          const actorLevel = ROLE_HIERARCHY[user.role] || 0;
          const targetLevel = ROLE_HIERARCHY[redactorUser.role] || 0;
          if (targetLevel >= actorLevel) {
            req.session.projectFeedback = {
              error: 'Nu poti aloca proiectul catre un membru cu acelasi grad sau cu grad superior.',
              activeTab: 'detalii'
            };
            return res.redirect(`/cont/proiecte/${project.id}`);
          }
        }
      }
      await assignProject(Number(req.params.id), {
        adminId: desiredAdminId,
        redactorId: desiredRedactorId
      });
      res.redirect(`/cont/proiecte/${project.id}`);
    } catch (error) {
      next(error);
    }
  });

router.get('/cont/proiecte/:id', requireActiveLicense(), async (req, res, next) => {
  try {
    const projectId = Number(req.params.id);
    let project = await getProjectById(projectId);
    if (!project) {
      return res.status(404).render('pages/404', {
        title: 'Proiect inexistent',
        description: 'Proiectul solicitat nu a fost gasit.'
      });
    }
    const user = req.session.user;
    if (user.role === 'client' && project.client_id !== user.id) {
      return res.status(403).render('pages/403', {
        title: 'Acces restrictionat',
        description: 'Nu aveti acces la acest proiect.'
      });
    }
    if (user.role === 'redactor' && project.assigned_editor_id !== user.id) {
      return res.status(403).render('pages/403', {
        title: 'Acces restrictionat',
        description: 'Nu sunteti asignat pe acest proiect.'
      });
    }
    if (user.role === 'admin' && project.assigned_admin_id !== user.id && project.assigned_editor_id !== user.id) {
      return res.status(403).render('pages/403', {
        title: 'Acces restrictionat',
        description: 'Nu sunteti responsabil de acest proiect.'
      });
    }

    const { project: hydratedProject } = await ensureProjectCompletionFinalized(project);
    project = hydratedProject;

    const [team, projectFiles, documentRequests, timelineLastReadAt] = await Promise.all([
      listTeamMembers(),
      listProjectFiles(projectId),
      listDocumentRequests(projectId),
      getProjectTimelineLastRead(projectId, user.id)
    ]);

    const clientFiles = projectFiles.filter((file) => file.origin === 'client');
    const staffFiles = projectFiles.filter((file) => file.origin === 'staff');
    const openDocumentRequests = documentRequests.filter((request) => request.status === 'open');
    const clientUploadWindowOpen =
      project.status === 'waiting_docs' || openDocumentRequests.length > 0;
    const clientUploadsRemaining = Math.max(0, CLIENT_MAX_PROJECT_FILES - clientFiles.length);
    const staffUploadsRemaining = Math.max(0, STAFF_MAX_PROJECT_FILES - staffFiles.length);

    const timelineVisibilities = ['public'];
    const includeInternalTimeline = ['admin', 'superadmin', 'redactor'].includes(user.role);
    const includeAdminTimeline = ['admin', 'superadmin'].includes(user.role);
    if (includeInternalTimeline) {
      timelineVisibilities.push('internal');
    }
    if (includeAdminTimeline) {
      timelineVisibilities.push('admin');
    }
    const timelineBatch = await getProjectTimelineEntries(projectId, {
      limit: PROJECT_TIMELINE_PAGE_SIZE + 1,
      offset: 0,
      visibilities: timelineVisibilities
    });
    const hasMoreTimeline = timelineBatch.length > PROJECT_TIMELINE_PAGE_SIZE;
    const baseTimelineEntries = hasMoreTimeline
      ? timelineBatch.slice(0, PROJECT_TIMELINE_PAGE_SIZE)
      : timelineBatch;
    const timelineEntries = baseTimelineEntries.map((entry) => {
      const createdAt = entry.created_at instanceof Date ? entry.created_at : new Date(entry.created_at);
      const isOwnEntry = entry.created_by && entry.created_by === user.id;
      const isValidDate = createdAt instanceof Date && !Number.isNaN(createdAt.getTime());
      const isUnread = !isOwnEntry && (!timelineLastReadAt || (isValidDate && createdAt > timelineLastReadAt));
      return { ...entry, isUnread };
    });
    await markProjectTimelineRead({ projectId, userId: user.id });

    const projectFeedback = req.session.projectFeedback || {};
    const feedbackActiveTab = projectFeedback.activeTab;
    delete projectFeedback.activeTab;
    delete req.session.projectFeedback;

    const allowedTabs = new Set(['detalii', 'timeline', 'fisiere']);
    const requestedTab = typeof req.query.tab === 'string' ? req.query.tab : null;
    let activeTab = 'detalii';
    if (feedbackActiveTab && allowedTabs.has(feedbackActiveTab)) {
      activeTab = feedbackActiveTab;
    } else if (requestedTab && allowedTabs.has(requestedTab)) {
      activeTab = requestedTab;
    }

    const statusMap = buildProjectStatusDictionary();
    const currentStatusInfo = getProjectStatusById(project.status);
    const nextStatus = getNextProjectStatusId(project.status);
    const previousStatus = getPreviousProjectStatusId(project.status);

    const isTimelineLocked = isProjectConversationLocked(project);
    const completionDeadline = getProjectCompletionDeadline(project);

    const completedAt = project.completed_at;
    const finalizedAt = project.finalized_at;

    res.render('pages/project-detail', {
      title: `Proiect ${project.title}`,
      description: 'Detalii actualizate despre stadiul lucrarii de licenta.',
      project,
      team,
      projectStatuses: PROJECT_STATUSES,
      projectStatusFlow: PROJECT_FLOW_STATUSES,
      projectStatusMap: statusMap,
      timelineEntries,
      hasMoreTimeline,
      timelinePageSize: PROJECT_TIMELINE_PAGE_SIZE,
      includeInternalTimeline,
      includeAdminTimeline,
      currentStatusInfo,
      nextStatus,
      nextStatusInfo: nextStatus ? getProjectStatusById(nextStatus) : null,
      previousStatus,
      previousStatusInfo: previousStatus ? getProjectStatusById(previousStatus) : null,
      projectFeedback,
      clientFiles,
      staffFiles,
      documentRequests,
      openDocumentRequests,
      canClientUpload: clientUploadWindowOpen,
      clientUploadsRemaining,
      staffUploadsRemaining,
      clientFileLimit: CLIENT_MAX_PROJECT_FILES,
      staffFileLimit: STAFF_MAX_PROJECT_FILES,
      activeTab,
      isTimelineLocked,
      completionDeadline,
      completionLockHours: PROJECT_COMPLETION_LOCK_HOURS,
      completedAt,
      finalizedAt
    });
  } catch (error) {
    next(error);
  }
});

router.get('/cont/proiecte/:id/timeline', requireActiveLicense(), async (req, res, next) => {
  try {
    const projectId = Number(req.params.id);
    const project = await getProjectById(projectId);
    if (!project) {
      return res.status(404).json({ error: 'Proiectul solicitat nu a fost gasit.' });
    }
    const user = req.session.user;
    if (user.role === 'client' && project.client_id !== user.id) {
      return res.status(403).json({ error: 'Nu aveti acces la acest proiect.' });
    }
    if (user.role === 'redactor' && project.assigned_editor_id !== user.id) {
      return res.status(403).json({ error: 'Nu sunteti asignat pe acest proiect.' });
    }
    if (user.role === 'admin' && project.assigned_admin_id !== user.id && project.assigned_editor_id !== user.id) {
      return res.status(403).json({ error: 'Nu sunteti responsabil de acest proiect.' });
    }

    const rawOffset = Number.parseInt(req.query.offset ?? '0', 10);
    const rawLimit = Number.parseInt(req.query.limit ?? `${PROJECT_TIMELINE_PAGE_SIZE}`, 10);
    const offset = Number.isNaN(rawOffset) ? 0 : Math.max(0, rawOffset);
    const limit = Number.isNaN(rawLimit)
      ? PROJECT_TIMELINE_PAGE_SIZE
      : Math.max(1, Math.min(PROJECT_TIMELINE_PAGE_SIZE, rawLimit));
    const timelineVisibilities = ['public'];
    const includeInternalTimeline = ['admin', 'superadmin', 'redactor'].includes(user.role);
    const includeAdminTimeline = ['admin', 'superadmin'].includes(user.role);
    if (includeInternalTimeline) {
      timelineVisibilities.push('internal');
    }
    if (includeAdminTimeline) {
      timelineVisibilities.push('admin');
    }
    const [timelineBatch, timelineLastReadAt] = await Promise.all([
      getProjectTimelineEntries(projectId, {
        limit: limit + 1,
        offset,
        visibilities: timelineVisibilities
      }),
      getProjectTimelineLastRead(projectId, user.id)
    ]);
    const hasMore = timelineBatch.length > limit;
    const entries = hasMore ? timelineBatch.slice(0, limit) : timelineBatch;
    const normalizedEntries = entries.map((entry) => {
      const createdAt = entry.created_at instanceof Date ? entry.created_at : new Date(entry.created_at);
      const isOwnEntry = entry.created_by && entry.created_by === user.id;
      const isValidDate = createdAt instanceof Date && !Number.isNaN(createdAt.getTime());
      const isUnread = !isOwnEntry && (!timelineLastReadAt || (isValidDate && createdAt > timelineLastReadAt));
      return { ...entry, isUnread };
    });
    res.json({
      entries: normalizedEntries,
      hasMore,
      nextOffset: offset + entries.length
    });
  } catch (error) {
    next(error);
  }
});

router.post('/cont/proiecte/:id/mesaj', requireActiveLicense(), async (req, res, next) => {
  try {
    const schema = z.object({
      message: z.string().min(2)
    });
    const data = schema.parse(req.body);
    const projectId = Number(req.params.id);
    let project = await getProjectById(projectId);
    if (!project) {
      return res.status(404).render('pages/404', {
        title: 'Proiect inexistent',
        description: 'Proiectul solicitat nu a fost gasit.'
      });
    }
    const { project: hydratedProject } = await ensureProjectCompletionFinalized(project);
    project = hydratedProject;
    const user = req.session.user;
    if (user.role === 'client' && project.client_id !== user.id) {
      return res.status(403).render('pages/403', {
        title: 'Acces restrictionat',
        description: 'Nu aveti acces la acest proiect.'
      });
    }
    if (user.role === 'redactor' && project.assigned_editor_id !== user.id) {
      return res.status(403).render('pages/403', {
        title: 'Acces restrictionat',
        description: 'Nu sunteti asignat pe acest proiect.'
      });
    }
    if (user.role === 'admin' && project.assigned_admin_id !== user.id && project.assigned_editor_id !== user.id) {
      return res.status(403).render('pages/403', {
        title: 'Acces restrictionat',
        description: 'Nu sunteti responsabil de acest proiect.'
      });
    }
    if (isProjectConversationLocked(project) && user.role !== 'superadmin') {
      req.session.projectFeedback = {
        error: 'Discuțiile pentru acest proiect au fost închise.',
        activeTab: 'timeline'
      };
      return res.redirect(`/cont/proiecte/${projectId}?tab=timeline`);
    }
    await addProjectComment({
      projectId,
      message: data.message,
      actor: user
    });
    res.redirect(`/cont/proiecte/${projectId}`);
  } catch (error) {
    if (error instanceof z.ZodError || error.message === 'EMPTY_MESSAGE') {
      req.session.projectFeedback = {
        error: 'Te rugam sa introduci un mesaj pentru a-l trimite in timeline.'
      };
      return res.redirect(`/cont/proiecte/${req.params.id}`);
    }
    next(error);
  }
});

export default router;
