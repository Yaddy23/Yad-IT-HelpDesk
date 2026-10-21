import { Router } from 'express';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';

import { recordAudit } from '../../core/audit.js';
import { notFound } from '../../core/errors.js';
import { requirePermission } from '../../core/auth.js';
import { requireAuth } from '../../core/auth.js';
import { toAuthed } from '../../core/request.js';
import { prisma } from '../../prisma/client.js';
import type { AuthedRequest } from '../../core/request.js';

const pagingSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  active: z.enum(['true', 'false']).optional(),
  q: z.string().max(120).optional(),
});

function paged<T>(items: T[], page: number, limit: number, total: number) {
  return { data: items, page, pages: Math.ceil(total / limit) || 1, total };
}

async function audit(
  req: AuthedRequest,
  action: string,
  targetType: string,
  targetId: string,
  after?: unknown,
) {
  await recordAudit({
    actorId: req.user?.id,
    actorEmail: req.user?.email,
    action,
    targetType,
    targetId,
    after: after as Record<string, unknown>,
    ip: req.ip,
  });
}

/* ── Departments ──────────────────────────────────────────────────────────── */

const departmentSchema = z.object({
  name: z.string().min(2).max(120),
  code: z.string().min(2).max(20).transform((s) => s.toUpperCase()),
  managerId: z.string().optional(),
  officeLocationId: z.string().optional(),
  timezone: z.string().max(60).optional(),
  supportGroupId: z.string().optional(),
  active: z.boolean().optional(),
});

export const departmentsRouter = Router();
departmentsRouter.use(requireAuth);

departmentsRouter.get('/', requirePermission('org:manage'), async (req, res, next) => {
  try {
    const { page, limit, active, q } = pagingSchema.parse(req.query);
    const where: Prisma.DepartmentWhereInput = {};
    if (active !== undefined) where.active = active === 'true';
    if (q) where.OR = [{ name: { contains: q, mode: 'insensitive' } }, { code: { contains: q, mode: 'insensitive' } }];
    const [total, items] = await Promise.all([
      prisma.department.count({ where }),
      prisma.department.findMany({
        where,
        include: { manager: { select: { id: true, name: true, employeeId: true } }, officeLocation: { select: { id: true, name: true, code: true } }, supportGroup: { select: { id: true, name: true, code: true } } },
        orderBy: { name: 'asc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);
    res.json(paged(items, page, limit, total));
  } catch (e) {
    next(e);
  }
});

departmentsRouter.post('/', requirePermission('org:manage'), async (req, res, next) => {
  try {
    const body = departmentSchema.parse(req.body);
    const doc = await prisma.department.create({ data: body });
    await audit(toAuthed(req), 'department.created', 'department', doc.id, body);
    res.status(201).json({ data: doc });
  } catch (e) {
    next(e);
  }
});

departmentsRouter.patch('/:id', requirePermission('org:manage'), async (req, res, next) => {
  try {
    const body = departmentSchema.partial().refine((b) => Object.keys(b).length > 0, { message: 'No changes' }).parse(req.body);
    const doc = await prisma.department.update({ where: { id: String(req.params.id) }, data: body });
    await audit(toAuthed(req), 'department.updated', 'department', doc.id, body);
    res.json({ data: doc });
  } catch (e) {
    next(e);
  }
});

/* ── Locations ────────────────────────────────────────────────────────────── */

const locationSchema = z.object({
  name: z.string().min(2).max(120),
  code: z.string().min(2).max(20).transform((s) => s.toUpperCase()),
  address: z.string().max(300).optional(),
  timezone: z.string().max(60).optional(),
  active: z.boolean().optional(),
});

export const locationsRouter = Router();
locationsRouter.use(requireAuth);

locationsRouter.get('/', requirePermission('org:manage'), async (req, res, next) => {
  try {
    const { page, limit, active, q } = pagingSchema.parse(req.query);
    const where: Prisma.LocationWhereInput = {};
    if (active !== undefined) where.active = active === 'true';
    if (q) where.OR = [{ name: { contains: q, mode: 'insensitive' } }, { code: { contains: q, mode: 'insensitive' } }];
    const [total, items] = await Promise.all([
      prisma.location.count({ where }),
      prisma.location.findMany({ where, orderBy: { name: 'asc' }, skip: (page - 1) * limit, take: limit }),
    ]);
    res.json(paged(items, page, limit, total));
  } catch (e) {
    next(e);
  }
});

locationsRouter.post('/', requirePermission('org:manage'), async (req, res, next) => {
  try {
    const body = locationSchema.parse(req.body);
    const doc = await prisma.location.create({ data: body });
    await audit(toAuthed(req), 'location.created', 'location', doc.id, body);
    res.status(201).json({ data: doc });
  } catch (e) {
    next(e);
  }
});

locationsRouter.patch('/:id', requirePermission('org:manage'), async (req, res, next) => {
  try {
    const body = locationSchema.partial().refine((b) => Object.keys(b).length > 0, { message: 'No changes' }).parse(req.body);
    const doc = await prisma.location.update({ where: { id: String(req.params.id) }, data: body });
    await audit(toAuthed(req), 'location.updated', 'location', doc.id, body);
    res.json({ data: doc });
  } catch (e) {
    next(e);
  }
});

/* ── Assignment groups ────────────────────────────────────────────────────── */

const groupSchema = z.object({
  name: z.string().min(2).max(120),
  code: z.string().min(2).max(20).transform((s) => s.toUpperCase()),
  description: z.string().max(500).optional(),
  managerId: z.string().optional(),
  memberIds: z.array(z.string()).max(200).optional(),
  active: z.boolean().optional(),
});

export const groupsRouter = Router();
groupsRouter.use(requireAuth);

groupsRouter.get('/', requirePermission('org:manage'), async (req, res, next) => {
  try {
    const { page, limit, active, q } = pagingSchema.parse(req.query);
    const where: Prisma.AssignmentGroupWhereInput = {};
    if (active !== undefined) where.active = active === 'true';
    if (q) where.OR = [{ name: { contains: q, mode: 'insensitive' } }, { code: { contains: q, mode: 'insensitive' } }];
    const [total, items] = await Promise.all([
      prisma.assignmentGroup.count({ where }),
      prisma.assignmentGroup.findMany({
        where,
        include: {
          manager: { select: { id: true, name: true, email: true } },
          members: { where: { leftAt: null }, include: { user: { select: { id: true, name: true, email: true } } } },
        },
        orderBy: { name: 'asc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);
    res.json(paged(items, page, limit, total));
  } catch (e) {
    next(e);
  }
});

groupsRouter.post('/', requirePermission('org:manage'), async (req, res, next) => {
  try {
    const body = groupSchema.parse(req.body);
    const doc = await prisma.assignmentGroup.create({
      data: {
        name: body.name,
        code: body.code,
        description: body.description,
        managerId: body.managerId,
        active: body.active,
        members: { create: (body.memberIds ?? []).map((userId) => ({ userId })) },
      },
    });
    await audit(toAuthed(req), 'group.created', 'assignment_group', doc.id, body);
    res.status(201).json({ data: doc });
  } catch (e) {
    next(e);
  }
});

groupsRouter.patch('/:id', requirePermission('org:manage'), async (req, res, next) => {
  try {
    const body = groupSchema.partial().refine((b) => Object.keys(b).length > 0, { message: 'No changes' }).parse(req.body);
    const before = await prisma.assignmentGroup.findUnique({
      where: { id: String(req.params.id) },
      include: { members: { where: { leftAt: null } } },
    });
    if (!before) throw notFound('Assignment group not found');

    const previousIds = new Set<string>(before.members.map((m: { userId: string }) => m.userId));
    const doc = await prisma.$transaction(async (tx) => {
      if (body.memberIds) {
        const nextIds = new Set(body.memberIds);
        const added = [...nextIds].filter((id) => !previousIds.has(id));
        const removed = [...previousIds].filter((id) => !nextIds.has(id));
        if (added.length) {
          await tx.assignmentGroupMember.createMany({
            data: added.map((userId) => ({ groupId: before.id, userId })),
          });
        }
        if (removed.length) {
          await tx.assignmentGroupMember.updateMany({
            where: { groupId: before.id, userId: { in: removed }, leftAt: null },
            data: { leftAt: new Date() },
          });
        }
      }
      return tx.assignmentGroup.update({
        where: { id: before.id },
        data: {
          ...(body.name !== undefined ? { name: body.name } : {}),
          ...(body.description !== undefined ? { description: body.description } : {}),
          ...(body.managerId !== undefined ? { managerId: body.managerId } : {}),
          ...(body.active !== undefined ? { active: body.active } : {}),
        },
      });
    });

    await audit(toAuthed(req), 'group.updated', 'assignment_group', doc.id, {
      beforeMembers: [...previousIds],
      after: body,
    });
    res.json({ data: doc });
  } catch (e) {
    next(e);
  }
});
