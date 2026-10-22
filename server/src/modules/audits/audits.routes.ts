import { Router } from 'express';
import { z } from 'zod';

import { requireAuth, requirePermission } from '../../core/auth.js';
import { toAuthed } from '../../core/request.js';
import { closeSession, createSession, getSession, listSessions, markItem } from './audits.service.js';

export const assetAuditsRouter = Router();

assetAuditsRouter.use(requireAuth);

const createSchema = z.object({
  body: z.object({
    name: z.string().min(1).max(200),
    scopeType: z.enum(['location', 'department', 'all']).default('all'),
    scopeId: z.string().min(1).optional(),
  }),
});

const listSchema = z.object({
  query: z.object({
    status: z.enum(['open', 'closed']).optional(),
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(25),
  }),
});

const markSchema = z.object({
  params: z.object({ id: z.string().min(1) }), // session id
  body: z.object({
    assetId: z.string().min(1),
    status: z.enum(['found', 'missing', 'unexpected']),
    note: z.string().max(2000).optional(),
  }),
});

assetAuditsRouter.get('/', requirePermission('assets:read'), async (req, res, next) => {
  try {
    const parsed = listSchema.parse({ query: req.query });
    res.json(await listSessions(parsed.query));
  } catch (e) {
    next(e);
  }
});

assetAuditsRouter.post('/', requirePermission('assets:update'), async (req, res, next) => {
  try {
    const parsed = createSchema.parse({ body: req.body });
    const session = await createSession(toAuthed(req).user!, parsed.body);
    res.status(201).json({ data: session });
  } catch (e) {
    next(e);
  }
});

assetAuditsRouter.get('/:id', requirePermission('assets:read'), async (req, res, next) => {
  try {
    const parsed = z.object({ params: z.object({ id: z.string().min(1) }) }).parse({ params: req.params });
    res.json({ data: await getSession(parsed.params.id) });
  } catch (e) {
    next(e);
  }
});

assetAuditsRouter.post('/:id/items', requirePermission('assets:update'), async (req, res, next) => {
  try {
    const parsed = markSchema.parse({ params: req.params, body: req.body });
    const item = await markItem(toAuthed(req).user!, parsed.params.id, parsed.body.assetId, parsed.body);
    res.json({ data: item });
  } catch (e) {
    next(e);
  }
});

assetAuditsRouter.post('/:id/close', requirePermission('assets:update'), async (req, res, next) => {
  try {
    const parsed = z.object({ params: z.object({ id: z.string().min(1) }) }).parse({ params: req.params });
    res.json({ data: await closeSession(toAuthed(req).user!, parsed.params.id) });
  } catch (e) {
    next(e);
  }
});
