import { Router } from 'express';

import { requireAuth, requirePermission } from '../../core/auth.js';
import { toAuthed } from '../../core/request.js';
import { KnownErrorsService } from './knownErrors.service.js';
import {
  createKnownErrorSchema,
  knownErrorIdParamSchema,
  listKnownErrorsQuerySchema,
  publishKnownErrorSchema,
  searchKnownErrorsQuerySchema,
  transitionKnownErrorSchema,
  updateKnownErrorSchema,
} from './validators.js';

// Stateless service — one instance serves every request.
const service = new KnownErrorsService();

export const knownErrorsRouter = Router();

// Spec Section 8: every IT role holds `known_errors:read`. Mutations each add
// their own granular permission from the Section 5.3 endpoint table.
knownErrorsRouter.use(requireAuth, requirePermission('known_errors:read'));

/**
 * GET /api/v1/known-errors/search
 * Search published workarounds. Registered BEFORE `/:id` so Express does not
 * treat "search" as a known error id.
 */
knownErrorsRouter.get('/search', async (req, res, next) => {
  try {
    const actor = toAuthed(req).user!;
    const { query } = searchKnownErrorsQuerySchema.parse({ query: req.query });
    const knownErrors = await service.search(actor, query);
    res.json({ data: knownErrors });
  } catch (e) {
    next(e);
  }
});

/**
 * GET /api/v1/known-errors
 * List known errors with pagination, filtering, and search.
 */
knownErrorsRouter.get('/', async (req, res, next) => {
  try {
    const actor = toAuthed(req).user!;
    const { query } = listKnownErrorsQuerySchema.parse({ query: req.query });
    const result = await service.list(actor, query);
    res.json({
      data: result.knownErrors,
      meta: { page: result.page, limit: query.limit, total: result.total, pages: result.pages },
    });
  } catch (e) {
    next(e);
  }
});

/**
 * POST /api/v1/known-errors
 * Create a known error from a problem.
 */
knownErrorsRouter.post('/', requirePermission('known_errors:create'), async (req, res, next) => {
  try {
    const actor = toAuthed(req).user!;
    const { body } = createKnownErrorSchema.parse({ body: req.body });
    const knownError = await service.create(actor, body);
    res.status(201).json({ data: knownError });
  } catch (e) {
    next(e);
  }
});

/**
 * GET /api/v1/known-errors/:id
 * Get a known error with its problem and published-article links.
 */
knownErrorsRouter.get('/:id', async (req, res, next) => {
  try {
    const actor = toAuthed(req).user!;
    const { params } = knownErrorIdParamSchema.parse({ params: req.params });
    const knownError = await service.get(actor, params.id);
    res.json({ data: knownError });
  } catch (e) {
    next(e);
  }
});

/**
 * PATCH /api/v1/known-errors/:id
 * Update known error content.
 */
knownErrorsRouter.patch('/:id', requirePermission('known_errors:update'), async (req, res, next) => {
  try {
    const actor = toAuthed(req).user!;
    const { params, body } = updateKnownErrorSchema.parse({ params: req.params, body: req.body });
    const knownError = await service.update(actor, params.id, body);
    res.json({ data: knownError });
  } catch (e) {
    next(e);
  }
});

/**
 * POST /api/v1/known-errors/:id/status
 * Transition status with approval.
 */
knownErrorsRouter.post('/:id/status', requirePermission('known_errors:approve'), async (req, res, next) => {
  try {
    const actor = toAuthed(req).user!;
    const { params, body } = transitionKnownErrorSchema.parse({ params: req.params, body: req.body });
    const knownError = await service.transitionStatus(actor, params.id, body.status, {
      reviewNotes: body.reviewNotes,
    });
    res.json({ data: knownError });
  } catch (e) {
    next(e);
  }
});

/**
 * POST /api/v1/known-errors/:id/publish-kb
 * Publish the workaround as a knowledge base article.
 */
knownErrorsRouter.post('/:id/publish-kb', requirePermission('known_errors:publish'), async (req, res, next) => {
  try {
    const actor = toAuthed(req).user!;
    const { params, body } = publishKnownErrorSchema.parse({ params: req.params, body: req.body });
    const knownError = await service.publishKB(actor, params.id, body);
    res.json({ data: knownError });
  } catch (e) {
    next(e);
  }
});
