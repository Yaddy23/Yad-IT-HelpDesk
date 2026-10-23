import { Router } from 'express';

import { recordAudit } from '../../core/audit.js';
import { requireAuth, requirePermission } from '../../core/auth.js';
import { notFound } from '../../core/errors.js';
import { toAuthed } from '../../core/request.js';
import { prisma } from '../../prisma/client.js';
import { catalogCreateSchema, catalogUpdateSchema, ruleUpsertSchema } from './validators.js';

/** Catalog admin + read endpoints. Managing requires `catalog:manage`. */
export const catalogRouter = Router();

/* Public-to-authenticated: the browsable catalog. */
catalogRouter.get('/', requireAuth, async (req, res, next) => {
  try {
    const actor = toAuthed(req).user!;
    const includeInactive = actor.roles.includes('super_admin') || actor.roles.includes('it_admin');
    const items = await prisma.catalogItem.findMany({
      where: includeInactive ? {} : { active: true },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      include: { approvalRule: { select: { id: true, name: true, active: true } } },
    });
    res.json({ data: items });
  } catch (e) {
    next(e);
  }
});

catalogRouter.get('/:id', requireAuth, async (req, res, next) => {
  try {
    const item = await prisma.catalogItem.findUnique({
      where: { id: String(req.params.id) },
      include: { approvalRule: true },
    });
    if (!item || (!item.active && !toAuthed(req).user!.roles.includes('it_admin'))) {
      throw notFound('Catalog item not found');
    }
    res.json({ data: item });
  } catch (e) {
    next(e);
  }
});

function toUpdateData(body: Record<string, unknown>): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  for (const key of ['name', 'description', 'category', 'icon', 'sortOrder', 'active', 'eligibility', 'formSchema']) {
    if (key in body) data[key] = body[key];
  }
  return data;
}

catalogRouter.post('/', requireAuth, requirePermission('catalog:manage'), async (req, res, next) => {
  try {
    const actor = toAuthed(req).user!;
    const { body } = catalogCreateSchema.parse({ body: req.body });
    const item = await prisma.catalogItem.create({ data: body as never });
    await recordAudit({
      actorId: actor.id,
      actorEmail: actor.email,
      action: 'catalog.created',
      targetType: 'catalog_item',
      targetId: item.id,
      after: { name: item.name },
    });
    res.status(201).json({ data: item });
  } catch (e) {
    next(e);
  }
});

catalogRouter.patch('/:id', requireAuth, requirePermission('catalog:manage'), async (req, res, next) => {
  try {
    const actor = toAuthed(req).user!;
    const { params, body } = catalogUpdateSchema.parse({ params: req.params, body: req.body });
    const existing = await prisma.catalogItem.findUnique({ where: { id: params.id } });
    if (!existing) throw notFound('Catalog item not found');
    const item = await prisma.catalogItem.update({
      where: { id: params.id },
      data: toUpdateData(body) as never,
    });
    await recordAudit({
      actorId: actor.id,
      actorEmail: actor.email,
      action: 'catalog.updated',
      targetType: 'catalog_item',
      targetId: item.id,
      before: { name: existing.name, active: existing.active },
      after: { name: item.name, active: item.active },
    });
    res.json({ data: item });
  } catch (e) {
    next(e);
  }
});

/** Approval rule for an item — upsert (one rule per item, enforced by the unique FK). */
catalogRouter.put('/:id/rule', requireAuth, requirePermission('catalog:manage'), async (req, res, next) => {
  try {
    const actor = toAuthed(req).user!;
    const { params, body } = ruleUpsertSchema.parse({ params: req.params, body: req.body });
    const item = await prisma.catalogItem.findUnique({ where: { id: params.id } });
    if (!item) throw notFound('Catalog item not found');

    const rule = await prisma.approvalRule.upsert({
      where: { catalogItemId: params.id },
      create: { catalogItemId: params.id, name: body.name ?? `Approval for ${item.name}`, steps: body.steps as never, active: body.active },
      update: { name: body.name ?? `Approval for ${item.name}`, steps: body.steps as never, active: body.active },
    });
    await recordAudit({
      actorId: actor.id,
      actorEmail: actor.email,
      action: 'catalog.rule_upserted',
      targetType: 'catalog_item',
      targetId: params.id,
      after: { ruleId: rule.id, steps: body.steps.length, active: rule.active },
    });
    res.json({ data: rule });
  } catch (e) {
    next(e);
  }
});

catalogRouter.delete('/:id/rule', requireAuth, requirePermission('catalog:manage'), async (req, res, next) => {
  try {
    const actor = toAuthed(req).user!;
    const rule = await prisma.approvalRule.findUnique({ where: { catalogItemId: String(req.params.id) } });
    if (!rule) throw notFound('No approval rule on this item');
    await prisma.approvalRule.delete({ where: { id: rule.id } });
    await recordAudit({
      actorId: actor.id,
      actorEmail: actor.email,
      action: 'catalog.rule_deleted',
      targetType: 'catalog_item',
      targetId: String(req.params.id),
      before: { ruleId: rule.id },
    });
    res.json({ data: { deleted: true } });
  } catch (e) {
    next(e);
  }
});
