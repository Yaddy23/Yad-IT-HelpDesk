import { Router } from 'express';

import { requireAuth, requirePermission } from '../../core/auth.js';
import { toAuthed } from '../../core/request.js';
import {
  listArticles,
  getArticle,
  suggestArticles,
  listCategories,
} from './knowledge.service.js';
import {
  listArticlesQuerySchema,
  suggestArticlesQuerySchema,
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