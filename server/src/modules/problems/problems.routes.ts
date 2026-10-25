import { Router } from 'express';

import { requireAuth, requirePermission } from '../../core/auth.js';
import { toAuthed } from '../../core/request.js';
import { ProblemsService } from './problems.service.js';
import {
  problemIdParamSchema,
  listProblemsQuerySchema,
  createProblemSchema,
  updateProblemSchema,
  transitionStatusSchema,
  updateRCASchema,
  linkIncidentsSchema,
  unlinkIncidentSchema,
  setWorkaroundSchema,
  linkChangeRequestSchema,
  unlinkChangeRequestSchema,
  getAuditLogSchema,
} from './validators.js';

// Stateless service — one instance serves every request.
const service = new ProblemsService();

export const problemsRouter = Router();

// Reading problems is the floor for the whole router; mutations each add their
// own granular permission from spec Section 8.
problemsRouter.use(requireAuth, requirePermission('problems:read'));

/**
 * GET /api/v1/problems
 * List problems with pagination, filtering, and search.
 */
problemsRouter.get('/', async (req, res, next) => {
  try {
    const actor = toAuthed(req).user!;
    const { query } = listProblemsQuerySchema.parse({ query: req.query });
    const result = await service.list(actor, query);
    res.json({
      data: result.problems,
      meta: { page: result.page, limit: query.limit, total: result.total, pages: result.pages },
    });
  } catch (e) {
    next(e);
  }
});

/**
 * POST /api/v1/problems
 * Create a new problem.
 */
problemsRouter.post('/', requirePermission('problems:create'), async (req, res, next) => {
  try {
    const actor = toAuthed(req).user!;
    const { body } = createProblemSchema.parse({ body: req.body });
    const problem = await service.create(actor, body);
    res.status(201).json({ data: problem });
  } catch (e) {
    next(e);
  }
});

/**
 * GET /api/v1/problems/:id
 * Get a single problem by ID with full detail.
 */
problemsRouter.get('/:id', async (req, res, next) => {
  try {
    const actor = toAuthed(req).user!;
    const { params } = problemIdParamSchema.parse({ params: req.params });
    const problem = await service.get(actor, params.id);
    res.json({ data: problem });
  } catch (e) {
    next(e);
  }
});

/**
 * GET /api/v1/problems/:id/audit
 * Get audit history for a problem.
 */
problemsRouter.get('/:id/audit', async (req, res, next) => {
  try {
    const actor = toAuthed(req).user!;
    const { params, query } = getAuditLogSchema.parse({ params: req.params, query: req.query });
    const audit = await service.getAuditLog(actor, params.id, query);
    res.json(audit);
  } catch (e) {
    next(e);
  }
});

/**
 * PATCH /api/v1/problems/:id
 * Update problem fields.
 */
problemsRouter.patch('/:id', requirePermission('problems:update'), async (req, res, next) => {
  try {
    const actor = toAuthed(req).user!;
    const { params, body } = updateProblemSchema.parse({ params: req.params, body: req.body });
    const problem = await service.update(actor, params.id, body);
    res.json({ data: problem });
  } catch (e) {
    next(e);
  }
});

/**
 * POST /api/v1/problems/:id/status
 * Transition problem status with spec Section 7 validation.
 */
problemsRouter.post('/:id/status', requirePermission('problems:transition'), async (req, res, next) => {
  try {
    const actor = toAuthed(req).user!;
    const { params, body } = transitionStatusSchema.parse({ params: req.params, body: req.body });
    const { status, ...extra } = body;
    const problem = await service.transitionStatus(actor, params.id, status, extra);
    res.json({ data: problem });
  } catch (e) {
    next(e);
  }
});

/**
 * POST /api/v1/problems/:id/incidents
 * Link incidents to problem.
 */
problemsRouter.post('/:id/incidents', requirePermission('problems:link_incidents'), async (req, res, next) => {
  try {
    const actor = toAuthed(req).user!;
    const { params, body } = linkIncidentsSchema.parse({ params: req.params, body: req.body });
    await service.linkIncidents(actor, params.id, body.incidentIds, body.note);
    res.status(204).send();
  } catch (e) {
    next(e);
  }
});

/**
 * DELETE /api/v1/problems/:id/incidents/:incidentId
 * Unlink incident from problem.
 */
problemsRouter.delete('/:id/incidents/:incidentId', requirePermission('problems:link_incidents'), async (req, res, next) => {
  try {
    const actor = toAuthed(req).user!;
    const { params } = unlinkIncidentSchema.parse({ params: req.params, body: req.body ?? {} });
    await service.unlinkIncident(actor, params.id, params.incidentId);
    res.status(204).send();
  } catch (e) {
    next(e);
  }
});

/**
 * POST /api/v1/problems/:id/rca
 * Update RCA information.
 */
problemsRouter.post('/:id/rca', requirePermission('problems:manage_rca'), async (req, res, next) => {
  try {
    const actor = toAuthed(req).user!;
    const { params, body } = updateRCASchema.parse({ params: req.params, body: req.body });
    const problem = await service.updateRCA(actor, params.id, body);
    res.json({ data: problem });
  } catch (e) {
    next(e);
  }
});

/**
 * POST /api/v1/problems/:id/workaround
 * Set workaround on problem.
 */
problemsRouter.post('/:id/workaround', requirePermission('problems:manage_rca'), async (req, res, next) => {
  try {
    const actor = toAuthed(req).user!;
    const { params, body } = setWorkaroundSchema.parse({ params: req.params, body: req.body });
    const problem = await service.setWorkaround(actor, params.id, body.workaround);
    res.json({ data: problem });
  } catch (e) {
    next(e);
  }
});

/**
 * POST /api/v1/problems/:id/changes
 * Link change request to problem.
 */
problemsRouter.post('/:id/changes', requirePermission('problems:update'), async (req, res, next) => {
  try {
    const actor = toAuthed(req).user!;
    const { params, body } = linkChangeRequestSchema.parse({ params: req.params, body: req.body });
    const problem = await service.linkChangeRequest(actor, params.id, body.changeId);
    res.json({ data: problem });
  } catch (e) {
    next(e);
  }
});

/**
 * DELETE /api/v1/problems/:id/changes/:changeId
 * Unlink change request from problem.
 */
problemsRouter.delete('/:id/changes/:changeId', requirePermission('problems:update'), async (req, res, next) => {
  try {
    const actor = toAuthed(req).user!;
    const { params } = unlinkChangeRequestSchema.parse({ params: req.params, body: req.body ?? {} });
    const problem = await service.unlinkChangeRequest(actor, params.id, params.changeId);
    res.json({ data: problem });
  } catch (e) {
    next(e);
  }
});
