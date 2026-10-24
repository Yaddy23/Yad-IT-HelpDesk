import { Router } from 'express';

import { requireAuth, requirePermission } from '../../core/auth.js';
import { toAuthed } from '../../core/request.js';
import {
  listArticles,
  getArticle,
  suggestArticles,
  listCategories,
  createArticle,
  updateArticle,
  submitForReview,
  publishArticle,
  rejectArticle,
  archiveArticle,
  restoreArticle,
  restoreRevision,
  listRevisions,
  getRevision,
} from './knowledge.service.js';
import {
  listArticlesQuerySchema,
  suggestArticlesQuerySchema,
  articleCreateSchema,
  articleUpdateSchema,
  articleSubmitSchema,
  articlePublishSchema,
  articleRejectSchema,
  articleArchiveSchema,
  articleRestoreArticleSchema,
  revisionRestoreSchema,
} from './validators.js';

export const knowledgeRouter = Router();

knowledgeRouter.use(requireAuth, requirePermission('kb:read'));

/**
 * GET /api/v1/knowledge
 * List articles with pagination, filtering, and search.
 */
knowledgeRouter.get('/', async (req, res, next) => {
  try {
    const actor = toAuthed(req).user!;
    const query = listArticlesQuerySchema.parse(req.query);
    const result = await listArticles(actor, query);
    res.json({ data: result.articles, page: result.page, pages: result.pages, total: result.total });
  } catch (e) {
    next(e);
  }
});

/**
 * GET /api/v1/knowledge/categories
 * List distinct categories from published articles visible to the user.
 */
knowledgeRouter.get('/categories', async (req, res, next) => {
  try {
    const actor = toAuthed(req).user!;
    const categories = await listCategories(actor);
    res.json({ data: categories });
  } catch (e) {
    next(e);
  }
});

/**
 * GET /api/v1/knowledge/suggest
 * Suggest published articles for a query (used in ticket deflection).
 */
knowledgeRouter.get('/suggest', async (req, res, next) => {
  try {
    const actor = toAuthed(req).user!;
    const query = suggestArticlesQuerySchema.parse(req.query);
    const articles = await suggestArticles(actor, query.q, query.category, query.limit);
    res.json({ data: articles });
  } catch (e) {
    next(e);
  }
});

/**
 * GET /api/v1/knowledge/:id
 * Get a single article by ID, enforcing visibility.
 * Returns 404 if not found or not visible (never 403).
 */
knowledgeRouter.get('/:id', async (req, res, next) => {
  try {
    const actor = toAuthed(req).user!;
    const article = await getArticle(actor, req.params.id);
    res.json({ data: article });
  } catch (e) {
    next(e);
  }
});

/**
 * POST /api/v1/knowledge
 * Create a new draft article.
 * Requires kb:author.
 */
knowledgeRouter.post('/', requirePermission('kb:author'), async (req, res, next) => {
  try {
    const actor = toAuthed(req).user!;
    const input = articleCreateSchema.parse(req.body);
    const article = await createArticle(actor, input);
    res.status(201).json({ data: article });
  } catch (e) {
    next(e);
  }
});

/**
 * PATCH /api/v1/knowledge/:id
 * Update article content with optimistic concurrency.
 * Creates a new revision. Published articles revert to draft.
 * Requires kb:author AND (author/owner OR kb:publish).
 */
knowledgeRouter.patch('/:id', requirePermission('kb:author'), async (req, res, next) => {
  try {
    const actor = toAuthed(req).user!;
    const { params, body } = articleUpdateSchema.parse({ params: req.params, body: req.body });
    const article = await updateArticle(actor, params.id, body);
    res.json({ data: article });
  } catch (e) {
    next(e);
  }
});

/**
 * POST /api/v1/knowledge/:id/submit
 * Submit a draft article for review (draft → in_review).
 * Requires kb:author AND author/owner.
 */
knowledgeRouter.post('/:id/submit', requirePermission('kb:author'), async (req, res, next) => {
  try {
    const actor = toAuthed(req).user!;
    const { params } = articleSubmitSchema.parse({ params: req.params, body: req.body ?? {} });
    const article = await submitForReview(actor, params.id);
    res.json({ data: article });
  } catch (e) {
    next(e);
  }
});

/**
 * POST /api/v1/knowledge/:id/publish
 * Publish an in_review article (in_review → published).
 * Requires kb:publish. Stamps publishedAt and reviewDueAt.
 */
knowledgeRouter.post('/:id/publish', requirePermission('kb:publish'), async (req, res, next) => {
  try {
    const actor = toAuthed(req).user!;
    const { params } = articlePublishSchema.parse({ params: req.params, body: req.body ?? {} });
    const article = await publishArticle(actor, params.id);
    res.json({ data: article });
  } catch (e) {
    next(e);
  }
});

/**
 * POST /api/v1/knowledge/:id/reject
 * Reject an in_review article back to draft (in_review → draft).
 * Requires kb:publish and a non-empty note.
 */
knowledgeRouter.post('/:id/reject', requirePermission('kb:publish'), async (req, res, next) => {
  try {
    const actor = toAuthed(req).user!;
    const { params, body } = articleRejectSchema.parse({ params: req.params, body: req.body });
    const article = await rejectArticle(actor, params.id, body.note);
    res.json({ data: article });
  } catch (e) {
    next(e);
  }
});

/**
 * POST /api/v1/knowledge/:id/archive
 * Archive a published article (published → archived).
 * Requires kb:publish.
 */
knowledgeRouter.post('/:id/archive', requirePermission('kb:publish'), async (req, res, next) => {
  try {
    const actor = toAuthed(req).user!;
    const { params } = articleArchiveSchema.parse({ params: req.params, body: req.body ?? {} });
    const article = await archiveArticle(actor, params.id);
    res.json({ data: article });
  } catch (e) {
    next(e);
  }
});

/**
 * POST /api/v1/knowledge/:id/restore
 * Restore an archived article to published (archived → published).
 * Requires kb:publish.
 */
knowledgeRouter.post('/:id/restore', requirePermission('kb:publish'), async (req, res, next) => {
  try {
    const actor = toAuthed(req).user!;
    const { params } = articleRestoreArticleSchema.parse({ params: req.params, body: req.body ?? {} });
    const article = await restoreArticle(actor, params.id);
    res.json({ data: article });
  } catch (e) {
    next(e);
  }
});

/**
 * GET /api/v1/knowledge/:id/revisions
 * List all revisions for an article.
 * Requires kb:read and article must be visible.
 */
knowledgeRouter.get('/:id/revisions', async (req, res, next) => {
  try {
    const actor = toAuthed(req).user!;
    const revisions = await listRevisions(actor, req.params.id);
    res.json({ data: revisions });
  } catch (e) {
    next(e);
  }
});

/**
 * GET /api/v1/knowledge/:id/revisions/:revisionNumber
 * Get a specific revision by number.
 * Requires kb:read and article must be visible.
 */
knowledgeRouter.get('/:id/revisions/:revisionNumber', async (req, res, next) => {
  try {
    const actor = toAuthed(req).user!;
    const revisionNumber = parseInt(req.params.revisionNumber, 10);
    const revision = await getRevision(actor, req.params.id, revisionNumber);
    res.json({ data: revision });
  } catch (e) {
    next(e);
  }
});

/**
 * POST /api/v1/knowledge/:id/revisions/:revisionNumber/restore
 * Restore an old revision as a new revision (history is never mutated).
 * Requires kb:author AND (author/owner OR kb:publish).
 */
knowledgeRouter.post('/:id/revisions/:revisionNumber/restore', requirePermission('kb:author'), async (req, res, next) => {
  try {
    const actor = toAuthed(req).user!;
    const { params } = revisionRestoreSchema.parse({ params: req.params, body: req.body ?? {} });
    const article = await restoreRevision(actor, params.id, params.revisionNumber);
    res.json({ data: article });
  } catch (e) {
    next(e);
  }
});