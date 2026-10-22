import { Router } from 'express';
import { z } from 'zod';

import { recordAudit } from '../../core/audit.js';
import { requireAuth, requirePermission } from '../../core/auth.js';
import { notFound } from '../../core/errors.js';
import { toAuthed } from '../../core/request.js';
import { prisma } from '../../prisma/client.js';

export const slaRouter = Router();
slaRouter.use(requireAuth, requirePermission('settings:manage'));

const appliesToSchema = z
  .object({
    priorities: z.array(z.enum(['low', 'medium', 'high', 'critical'])).max(4).optional(),
    categories: z.array(z.string().max(60)).max(30).optional(),
  })
  .optional();

const createSchema = z.object({
  body: z.object({
    name: z.string().min(2).max(120),
    active: z.boolean().default(true),
    appliesTo: appliesToSchema,
    responseTargetMins: z.number().int().positive().max(60 * 24 * 30).nullable().optional(),
    resolveTargetMins: z.number().int().positive().max(60 * 24 * 90).nullable().optional(),
    warnPercent: z.number().int().min(1).max(99).default(75),
    businessCalendarId: z.string().nullable().optional(),
  }),
});

const updateSchema = z.object({
  params: z.object({ id: z.string().min(1) }),
  body: createSchema.shape.body.partial(),
});

slaRouter.get('/', async (_req, res, next) => {
  try {
    const policies = await prisma.slaPolicy.findMany({
      orderBy: { createdAt: 'asc' },
      include: { businessCalendar: { select: { id: true, name: true } } },
    });
    res.json({ data: policies });
  } catch (e) {
    next(e);
  }
});

slaRouter.post('/', async (req, res, next) => {
  try {
    const { body } = createSchema.parse(req);
    const policy = await prisma.slaPolicy.create({
      data: {
        name: body.name,
        active: body.active,
        appliesTo: (body.appliesTo ?? {}) as never,
        responseTargetMins: body.responseTargetMins ?? null,
        resolveTargetMins: body.resolveTargetMins ?? null,
        warnPercent: body.warnPercent,
        businessCalendarId: body.businessCalendarId ?? null,
      },
    });
    await recordAudit({
      actorId: toAuthed(req).user!.id,
      actorEmail: toAuthed(req).user!.email,
      action: 'sla.policy_created',
      targetType: 'sla_policy',
      targetId: policy.id,
      after: { name: policy.name },
    });
    res.status(201).json({ data: policy });
  } catch (e) {
    next(e);
  }
});

slaRouter.patch('/:id', async (req, res, next) => {
  try {
    const { params, body } = updateSchema.parse({ params: req.params, body: req.body });
    const before = await prisma.slaPolicy.findUnique({ where: { id: params.id } });
    if (!before) throw notFound('Policy not found');
    const policy = await prisma.slaPolicy.update({
      where: { id: params.id },
      data: {
        name: body.name ?? undefined,
        active: body.active ?? undefined,
        appliesTo: body.appliesTo !== undefined ? (body.appliesTo as never) : undefined,
        responseTargetMins: body.responseTargetMins ?? undefined,
        resolveTargetMins: body.resolveTargetMins ?? undefined,
        warnPercent: body.warnPercent ?? undefined,
        businessCalendarId: body.businessCalendarId ?? undefined,
      },
    });
    await recordAudit({
      actorId: toAuthed(req).user!.id,
      actorEmail: toAuthed(req).user!.email,
      action: 'sla.policy_updated',
      targetType: 'sla_policy',
      targetId: policy.id,
      before: { name: before.name, active: before.active, warnPercent: before.warnPercent },
      after: { name: policy.name, active: policy.active, warnPercent: policy.warnPercent },
    });
    res.json({ data: policy });
  } catch (e) {
    next(e);
  }
});
