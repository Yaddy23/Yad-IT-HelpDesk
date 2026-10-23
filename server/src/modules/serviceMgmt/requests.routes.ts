import { Router } from 'express';
import { z } from 'zod';

import { requireAuth, requirePermission } from '../../core/auth.js';
import { toAuthed } from '../../core/request.js';
import {
  addRequestInfo,
  cancelRequest,
  createServiceRequest,
  fulfillRequest,
  getRequest,
  listRequests,
} from './requests.service.js';

export const requestsRouter = Router();
requestsRouter.use(requireAuth);

const createSchema = z.object({
  body: z.object({
    catalogItemId: z.string().min(1),
    answers: z.record(z.unknown()).default({}),
  }),
});

const infoSchema = z.object({
  params: z.object({ id: z.string().min(1) }),
  body: z.object({ note: z.string().min(1).max(5000) }),
});

const fulfillSchema = z.object({
  params: z.object({ id: z.string().min(1) }),
  body: z.object({ note: z.string().max(2000).optional() }),
});

requestsRouter.get('/', async (req, res, next) => {
  try {
    const actor = toAuthed(req).user!;
    const querySchema = z.object({
      status: z.string().optional(),
      mine: z.string().optional(),
      queue: z.enum(['open', 'fulfillment']).optional(),
    });
    const q = querySchema.parse(req.query);
    const data = await listRequests(actor, {
      status: q.status,
      mine: q.mine === 'true',
      queue: q.queue,
    });
    res.json({ data });
  } catch (e) {
    next(e);
  }
});

requestsRouter.get('/:id', async (req, res, next) => {
  try {
    const actor = toAuthed(req).user!;
    res.json({ data: await getRequest(actor, req.params.id) });
  } catch (e) {
    next(e);
  }
});

requestsRouter.post('/', async (req, res, next) => {
  try {
    const actor = toAuthed(req).user!;
    const { body } = createSchema.parse({ body: req.body });
    const { request } = await createServiceRequest(actor, body);
    res.status(201).json({ data: request });
  } catch (e) {
    next(e);
  }
});

requestsRouter.post('/:id/info', async (req, res, next) => {
  try {
    const actor = toAuthed(req).user!;
    const { params, body } = infoSchema.parse({ params: req.params, body: req.body });
    res.json({ data: await addRequestInfo(actor, params.id, body.note) });
  } catch (e) {
    next(e);
  }
});

const paramsSchema = z.object({ params: z.object({ id: z.string().min(1) }) });

requestsRouter.post('/:id/cancel', async (req, res, next) => {
  try {
    const actor = toAuthed(req).user!;
    const { params } = paramsSchema.parse({ params: req.params });
    res.json({ data: await cancelRequest(actor, params.id) });
  } catch (e) {
    next(e);
  }
});

requestsRouter.post('/:id/fulfill', requirePermission('tickets:update'), async (req, res, next) => {
  try {
    const actor = toAuthed(req).user!;
    const { params, body } = fulfillSchema.parse({ params: req.params, body: req.body ?? {} });
    res.json({ data: await fulfillRequest(actor, params.id, body.note) });
  } catch (e) {
    next(e);
  }
});
