import { Router } from 'express';
import { z } from 'zod';
import { ensureAuthenticated, ensureRole } from '../middleware/auth.js';
import {
  listProjectsForUser,
  updateProjectStatus,
  getProjectById,
  assignProject,
  createProject
} from '../services/projectService.js';
import { listTicketsForUser, createTicket, getTicketWithReplies, addReply, updateTicketStatus } from '../services/ticketService.js';
import { listEditorsAndAdmins, listClients } from '../services/userService.js';

const router = Router();

router.use(ensureAuthenticated);

router.get('/cont', async (req, res, next) => {
  try {
    const [projects, tickets] = await Promise.all([
      listProjectsForUser(req.session.user),
      listTicketsForUser(req.session.user)
    ]);
    res.render('pages/dashboard', {
      title: 'Panou de control',
      description: 'Monitorizeaza proiectele, contractele si discutiile cu echipa Dtoro.',
      projects,
      tickets
    });
  } catch (error) {
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
    if (user.role === 'editor' && ticket.project_id && ticket.assigned_editor_id && ticket.assigned_editor_id !== user.id) {
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
    res.render('pages/ticket-detail', {
      title: `Ticket ${ticket.subject}`,
      description: 'Comunicare rapida cu echipa de proiect.',
      ticket,
      replies
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
    if (user.role === 'editor' && ticket.project_id && ticket.assigned_editor_id && ticket.assigned_editor_id !== user.id) {
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
  .post(ensureRole('admin', 'superadmin', 'editor'), async (req, res, next) => {
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
      if (user.role === 'editor' && project.assigned_editor_id !== user.id) {
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
    const [project, team] = await Promise.all([getProjectById(projectId), listEditorsAndAdmins()]);
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
    if (user.role === 'editor' && project.assigned_editor_id !== user.id) {
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
      const [clients, team] = await Promise.all([listClients(), listEditorsAndAdmins()]);
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
        assignedEditorId: z.string().optional()
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
        assignedEditorId: data.assignedEditorId ? Number(data.assignedEditorId) : null
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
        editorId: z.string().optional()
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
        editorId: data.editorId ? Number(data.editorId) : null
      });
      res.redirect('/cont');
    } catch (error) {
      next(error);
    }
  });

export default router;
