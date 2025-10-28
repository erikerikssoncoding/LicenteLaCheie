import { Router } from 'express';
import { z } from 'zod';
import { ensureAuthenticated, ensureRole } from '../middleware/auth.js';
import {
  listProjectsForUser,
  updateProjectStatus,
  getProjectById,
  assignProject,
  createProject,
  getClientProjectHighlights,
  getRedactorProjectHighlights,
  getAdminProjectHighlights
} from '../services/projectService.js';
import {
  listTicketsForUser,
  createTicket,
  getTicketWithReplies,
  addReply,
  updateTicketStatus,
  listPendingSupportTicketsForAdmin,
  listPendingSupportTicketsForRedactor,
  listRecentTicketRepliesForUser
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
  PROTECTED_USER_ID
} from '../services/userService.js';
import {
  getOfferByTicketId,
  attachOfferDetails,
  acceptOffer,
  refuseOffer,
  requestCounterOffer,
  submitCounterOffer,
  listOffersForUser,
  listPendingOffersForAdmin,
  MIN_OFFER_EXPIRATION_HOURS
} from '../services/offerService.js';

const router = Router();

router.use(ensureAuthenticated);

router
  .route('/cont/setari')
  .get(async (req, res, next) => {
    try {
      const profile = await getUserById(req.session.user.id);
      const successMessages = {
        profile: 'Datele tale au fost actualizate.',
        password: 'Parola a fost schimbata cu succes.'
      };
      const errorMessages = {
        'invalid-password': 'Parola curenta nu este corecta.',
        form: 'Completeaza corect toate campurile obligatorii.'
      };
      res.render('pages/account-settings', {
        title: 'Setari cont',
        description: 'Actualizeaza-ti datele de contact si parola pentru a proteja accesul la proiecte.',
        profile,
        successMessage: successMessages[req.query.success] || null,
        errorMessage: errorMessages[req.query.error] || null
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
        return res.redirect('/cont/setari?error=form');
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
    res.redirect('/cont/setari?success=password');
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.redirect('/cont/setari?error=form');
    }
    if (error.message === 'INVALID_PASSWORD') {
      return res.redirect('/cont/setari?error=invalid-password');
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
      description: 'Monitorizeaza proiectele, contractele si discutiile cu echipa Licente la Cheie.',
      projects,
      tickets,
      offers: [],
      clientHighlights: { nextDeadline: null, admins: [], redactors: [] },
      redactorHighlights: { statusCounts: [], upcomingDeadlines: [] },
      adminHighlights: { statusCounts: [], recentProjects: [] },
      pendingSupportTickets: [],
      pendingOffers: [],
      recentReplies: []
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

    res.render('pages/dashboard', viewModel);
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
      title: 'Administrare utilizatori',
      description: 'Creeaza conturi pentru echipa si gestioneaza accesul clientilor.',
      users,
      filters,
      flashMessage: flash.success || null,
      errorMessage: flash.error || null,
      generatedCredentials: flash.credentials || null
    });
  } catch (error) {
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
      title: 'Administrare tichete',
      description: 'Vizualizeaza rapid solicitarile clientilor si actualizeaza statusurile direct din panoul de control.',
      tickets: filteredTickets,
      filters
    });
  } catch (error) {
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
    await updateUserRole(targetId, role);
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
    if (targetId === PROTECTED_USER_ID) {
      req.session.flash = { error: 'Acest utilizator este protejat si nu poate fi dezactivat.' };
      return res.redirect('/cont/utilizatori');
    }
    if (targetId === req.session.user.id) {
      req.session.flash = { error: 'Nu iti poti dezactiva propriul cont.' };
      return res.redirect('/cont/utilizatori');
    }
    const schema = z.object({ isActive: z.enum(['0', '1']) });
    const { isActive } = schema.parse(req.body);
    await setUserActiveStatus(targetId, isActive === '1');
    req.session.flash = { success: 'Statusul contului a fost actualizat.' };
    res.redirect('/cont/utilizatori');
  } catch (error) {
    if (error instanceof z.ZodError) {
      req.session.flash = { error: 'Solicitarea nu este valida.' };
      return res.redirect('/cont/utilizatori');
    }
    if (error.message === 'PROTECTED_USER') {
      req.session.flash = { error: 'Acest utilizator este protejat si nu poate fi dezactivat.' };
      return res.redirect('/cont/utilizatori');
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
        projects
      });
    } catch (error) {
      next(error);
    }
  })
  .post(async (req, res, next) => {
    try {
      const schema = z.object({
        projectId: z.string().optional(),
        subject: z.string().min(5),
        message: z.string().min(10)
      });
      const data = schema.parse(req.body);
      const projectId = data.projectId ? Number(data.projectId) : null;
      await createTicket({
        projectId,
        userId: req.session.user.id,
        subject: data.subject,
        message: data.message
      });
      res.redirect('/cont');
    } catch (error) {
      next(error);
    }
  });

router.get('/cont/tichete/:id', async (req, res, next) => {
  try {
    const { ticket, replies } = await getTicketWithReplies(Number(req.params.id));
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
    if (user.role === 'admin' && ticket.project_id && ticket.assigned_admin_id && ticket.assigned_admin_id !== user.id) {
      return res.status(403).render('pages/403', {
        title: 'Acces restrictionat',
        description: 'Ticketul nu este gestionat de tine.'
      });
    }
    const offer = ticket.kind === 'offer' ? await getOfferByTicketId(ticket.id) : null;
    const feedback = req.session.ticketFeedback || {};
    delete req.session.ticketFeedback;
    res.render('pages/ticket-detail', {
      title: `Ticket ${ticket.subject}`,
      description: 'Comunicare rapida cu echipa de proiect.',
      ticket,
      replies,
      offer,
      offerMinHours: MIN_OFFER_EXPIRATION_HOURS,
      feedback
    });
  } catch (error) {
    next(error);
  }
});

router.post('/cont/tichete/:id/raspuns', async (req, res, next) => {
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
    if (user.role === 'admin' && ticket.project_id && ticket.assigned_admin_id && ticket.assigned_admin_id !== user.id) {
      return res.status(403).render('pages/403', {
        title: 'Acces restrictionat',
        description: 'Ticketul nu este gestionat de tine.'
      });
    }
    await addReply({
      ticketId: ticket.id,
      userId: user.id,
      message: data.message
    });
    res.redirect(`/cont/tichete/${req.params.id}`);
  } catch (error) {
    next(error);
  }
});

router.post('/cont/tichete/:id/oferta/detalii', ensureRole('admin', 'superadmin'), async (req, res, next) => {
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
      ticket.assigned_admin_id !== user.id
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
        ticketId: ticketId,
        userId: user.id,
        message: `Oferta transmisa: ${amount.toFixed(2)} EUR. ${data.message}`
      });
    }
    req.session.ticketFeedback = { success: 'Oferta a fost transmisa clientului.' };
    res.redirect(`/cont/tichete/${ticketId}`);
  } catch (error) {
    if (error instanceof z.ZodError) {
      req.session.ticketFeedback = { error: 'Completeaza corect campurile ofertei.' };
      return res.redirect(`/cont/tichete/${req.params.id}`);
    }
    next(error);
  }
});

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
    await addReply({
      ticketId,
      userId: user.id,
      message: 'Oferta a fost acceptata. Astept instructiunile de contract.'
    });
    req.session.ticketFeedback = { success: 'Ai acceptat oferta. Un consultant te va contacta pentru contract.' };
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
      message: `Contraoferta propusa: ${amount.toFixed(2)} EUR.`
    });
    req.session.ticketFeedback = { success: 'Contraoferta a fost trimisa administratorului.' };
    res.redirect(`/cont/tichete/${ticketId}`);
  } catch (error) {
    if (error instanceof z.ZodError) {
      req.session.ticketFeedback = { error: 'Completeaza valoarea contraofertei.' };
      return res.redirect(`/cont/tichete/${req.params.id}`);
    }
    next(error);
  }
});

router.post('/cont/tichete/:id/status', ensureRole('admin', 'superadmin'), async (req, res, next) => {
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
    await updateTicketStatus(ticket.id, data.status);
    res.redirect(`/cont/tichete/${req.params.id}`);
  } catch (error) {
    next(error);
  }
});

router
  .route('/cont/proiecte/:id/status')
  .post(ensureRole('admin', 'superadmin', 'redactor'), async (req, res, next) => {
    try {
      const schema = z.object({
        status: z.enum(['initiated', 'in-progress', 'needs-review', 'completed', 'delivered']),
        notes: z.string().optional()
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
      if (user.role === 'redactor' && project.assigned_editor_id !== user.id) {
        return res.status(403).render('pages/403', {
          title: 'Acces restrictionat',
          description: 'Nu sunteti asignat pe acest proiect.'
        });
      }
      if (user.role === 'admin' && project.assigned_admin_id !== user.id) {
        return res.status(403).render('pages/403', {
          title: 'Acces restrictionat',
          description: 'Nu sunteti responsabil de acest proiect.'
        });
      }
      await updateProjectStatus(project.id, data.status, data.notes || null);
      res.redirect('/cont');
    } catch (error) {
      next(error);
    }
  });

router.get('/cont/proiecte/:id', async (req, res, next) => {
  try {
    const projectId = Number(req.params.id);
    const [project, team] = await Promise.all([getProjectById(projectId), listTeamMembers()]);
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
    if (user.role === 'admin' && project.assigned_admin_id !== user.id) {
      return res.status(403).render('pages/403', {
        title: 'Acces restrictionat',
        description: 'Nu sunteti responsabil de acest proiect.'
      });
    }
    res.render('pages/project-detail', {
      title: `Proiect ${project.title}`,
      description: 'Detalii actualizate despre stadiul lucrarii de licenta.',
      project,
      team
    });
  } catch (error) {
    next(error);
  }
});

router
  .route('/cont/proiecte/creeaza')
  .get(ensureRole('admin', 'superadmin'), async (req, res, next) => {
    try {
      const [clients, team] = await Promise.all([listClients(), listTeamMembers()]);
      res.render('pages/project-create', {
        title: 'Creaza proiect nou',
        description: 'Inregistreaza o lucrare de licenta si aloca echipa.',
        clients,
        team
      });
    } catch (error) {
      next(error);
    }
  })
  .post(ensureRole('admin', 'superadmin'), async (req, res, next) => {
    try {
      const schema = z.object({
        title: z.string().min(5),
        description: z.string().min(10),
        degreeLevel: z.string().min(3),
        deadline: z.string().min(4),
        clientId: z.string(),
        assignedAdminId: z.string().optional(),
        assignedRedactorId: z.string().optional()
      });
      const data = schema.parse(req.body);
      const user = req.session.user;
      const assignedAdminId = data.assignedAdminId
        ? Number(data.assignedAdminId)
        : user.role === 'admin'
        ? user.id
        : null;
      await createProject({
        title: data.title,
        description: data.description,
        degreeLevel: data.degreeLevel,
        deadline: data.deadline,
        clientId: Number(data.clientId),
        assignedAdminId,
        assignedRedactorId: data.assignedRedactorId ? Number(data.assignedRedactorId) : null
      });
      res.redirect('/cont');
    } catch (error) {
      next(error);
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
      if (user.role === 'admin' && project.assigned_admin_id !== user.id) {
        return res.status(403).render('pages/403', {
          title: 'Acces restrictionat',
          description: 'Nu sunteti responsabil de acest proiect.'
        });
      }
      await assignProject(Number(req.params.id), {
        adminId: data.adminId ? Number(data.adminId) : null,
        redactorId: data.redactorId ? Number(data.redactorId) : null
      });
      res.redirect('/cont');
    } catch (error) {
      next(error);
    }
  });

export default router;
