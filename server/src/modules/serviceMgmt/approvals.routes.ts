import { Router } from 'express';
import { z } from 'zod';

import { requireAuth, requirePermission } from '../../core/auth.js';
import { toAuthed } from '../../core/request.js';
import {
  approvalDetail,
  decideApproval,
  delegateStep,
  myApprovalQueue,
} from './approvals.service.js';

/** The approval inbox + decision endpoints. Deciding requires `approvals:decide`. */
export const approvalsRouter = Router();
approvalsRouter.use(requireAuth);

const decideSchema = z.object({
  params: z.object({ id: z.string().min(1) }),
  body: z.object({
    stepIndex: z.number().int().min(0),
    decision: z.enum(['approved', 'rejected', 'info_requested']),
    reason: z.string().max(2000).optional(),
  }),
});

const delegateSchema = z.object({
  params: z.object({ id: z.string().min(1) }),
  body: z.object({
    stepIndex: z.number().int().min(0),
    delegateUserId: z.string().min(1),
  }),
});

approvalsRouter.get('/queue', requirePermission('approvals:decide'), async (req, res, next) => {
  try {
    const actor = toAuthed(req).user!;
    res.json({ data: await myApprovalQueue(actor.id) });
  } catch (e) {
    next(e);
  }
});

approvalsRouter.get('/:id', async (req, res, next) => {
  try {
    const actor = toAuthed(req).user!;
    res.json({ data: await approvalDetail(actor, req.params.id) });
  } catch (e) {
    next(e);
  }
});

approvalsRouter.post('/:id/decide', requirePermission('approvals:decide'), async (req, res, next) => {
  try {
    const actor = toAuthed(req).user!;
    const { params, body } = decideSchema.parse({ params: req.params, body: req.body });
    const result = await decideApproval(actor, params.id, body);
    res.json({
      data: {
        settled: result.settled,
        nextStepName: result.nextStep?.name ?? null,
        request: result.request ? { id: result.request.id, number: result.request.number, status: result.request.status } : null,
      },
    });
  } catch (e) {
    next(e);
  }
});

approvalsRouter.post('/:id/delegate', requirePermission('approvals:decide'), async (req, res, next) => {
  try {
    const actor = toAuthed(req).user!;
    const { params, body } = delegateSchema.parse({ params: req.params, body: req.body });
    const updated = await delegateStep(actor, params.id, body.stepIndex, body.delegateUserId);
    res.json({ data: { id: updated.id, delegations: updated.delegations ?? {} } });
  } catch (e) {
    next(e);
  }
});
