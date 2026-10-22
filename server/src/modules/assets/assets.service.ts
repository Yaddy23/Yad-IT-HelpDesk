import type { Prisma } from '@prisma/client';

import { recordAudit } from '../../core/audit.js';
import { badRequest, conflict, forbidden, notFound } from '../../core/errors.js';
import { hasPermission, type Permission } from '../../core/permissions.js';
import type { AuthedUser } from '../../core/request.js';
import { prisma } from '../../prisma/client.js';

/** hasPermission with the auth-context role list (typed string[] → Role[]). */
export function can(user: AuthedUser, permission: Permission): boolean {
  return hasPermission({ roles: user.roles as never }, permission);
}

/* ── Lifecycle state machine ──────────────────────────────────────────────── */

import type { AssetStatus } from '@prisma/client';

const TRANSITIONS: Record<AssetStatus, AssetStatus[]> = {
  in_stock: ['deployed', 'in_maintenance', 'retired', 'lost'],
  deployed: ['in_repair', 'in_maintenance', 'retired', 'lost'],
  in_repair: ['in_stock', 'deployed', 'retired', 'lost'],
  in_maintenance: ['in_stock', 'deployed', 'retired'],
  retired: [],
  lost: [],
};

const assetListWhere = (q?: string, status?: string, category?: string, custodianId?: string) => {
  const where: Prisma.AssetWhereInput = {};
  if (status) where.status = status as AssetStatus;
  if (category) where.category = category as Prisma.EnumAssetCategoryFilter['equals'];
  if (custodianId) where.custodianId = custodianId;
  if (q) {
    where.OR = [
      { number: { contains: q, mode: 'insensitive' } },
      { name: { contains: q, mode: 'insensitive' } },
      { serialNumber: { contains: q, mode: 'insensitive' } },
      { manufacturer: { contains: q, mode: 'insensitive' } },
      { model: { contains: q, mode: 'insensitive' } },
    ];
  }
  return where;
};

const assetDetailInclude = {
  custodian: { select: { id: true, employeeId: true, name: true, email: true } },
  location: { select: { id: true, name: true } },
  department: { select: { id: true, name: true } },
  vendor: { select: { id: true, name: true } },
} satisfies Prisma.AssetInclude;

/* ── Assets ───────────────────────────────────────────────────────────────── */

export async function createAsset(
  user: AuthedUser,
  input: {
    name: string;
    category: string;
    manufacturer?: string;
    model?: string;
    serialNumber?: string;
    purchasedAt?: string;
    purchaseCost?: number;
    warrantyExpiry?: string;
    notes?: string;
    locationId?: string;
    departmentId?: string;
    vendorId?: string;
  },
) {
  const { asset, number } = await prisma.$transaction(async (tx) => {
    const counter = await tx.assetCounter.upsert({
      where: { key: 'AST' },
      create: { key: 'AST', next: 2 },
      update: { next: { increment: 1 } },
    });
    const number = `AST-${new Date().getFullYear()}-${String(counter.next - 1).padStart(6, '0')}`;
    const asset = await tx.asset.create({
      data: {
        number,
        name: input.name,
        category: input.category as never,
        manufacturer: input.manufacturer,
        model: input.model,
        serialNumber: input.serialNumber,
        purchasedAt: input.purchasedAt ? new Date(input.purchasedAt) : undefined,
        purchaseCost: input.purchaseCost,
        warrantyExpiry: input.warrantyExpiry ? new Date(input.warrantyExpiry) : undefined,
        notes: input.notes,
        locationId: input.locationId,
        departmentId: input.departmentId,
        vendorId: input.vendorId,
      },
      include: assetDetailInclude,
    });
    return { asset, number };
  });
  await recordAudit({ actorId: user.id, action: 'asset.created', targetType: 'asset', targetId: asset.id, meta: { number } });
  return asset;
}

export async function listAssets(opts: { q?: string; status?: string; category?: string; custodianId?: string; page: number; limit: number }) {
  const where = assetListWhere(opts.q, opts.status, opts.category, opts.custodianId);
  const [data, total] = await Promise.all([
    prisma.asset.findMany({
      where,
      include: assetDetailInclude,
      orderBy: { createdAt: 'desc' },
      skip: (opts.page - 1) * opts.limit,
      take: opts.limit,
    }),
    prisma.asset.count({ where }),
  ]);
  return { data, meta: { total, page: opts.page, limit: opts.limit, pages: Math.ceil(total / opts.limit) } };
}

export async function getAsset(id: string) {
  const asset = await prisma.asset.findUnique({
    where: { id },
    include: {
      ...assetDetailInclude,
      assignments: {
        orderBy: { assignedAt: 'desc' },
        include: {
          employee: { select: { id: true, employeeId: true, name: true, email: true } },
          assignedBy: { select: { id: true, name: true } },
        },
      },
      maintenanceRecords: {
        orderBy: { performedAt: 'desc' },
        include: { vendor: { select: { id: true, name: true } }, createdBy: { select: { id: true, name: true } } },
      },
      maintenanceSchedules: { orderBy: { nextDueAt: 'asc' } },
      warrantyClaims: {
        orderBy: { claimedAt: 'desc' },
        include: { vendor: { select: { id: true, name: true } }, createdBy: { select: { id: true, name: true } } },
      },
    },
  });
  if (!asset) throw notFound('Asset not found');
  return asset;
}

export async function updateAsset(
  user: AuthedUser,
  id: string,
  input: Partial<{
    name: string;
    category: string;
    manufacturer: string;
    model: string;
    serialNumber: string;
    purchasedAt: string;
    purchaseCost: number;
    warrantyExpiry: string;
    notes: string;
    locationId: string;
    departmentId: string;
    vendorId: string;
  }>,
) {
  const existing = await prisma.asset.findUnique({ where: { id } });
  if (!existing) throw notFound('Asset not found');
  const data: Prisma.AssetUpdateInput = {};
  for (const key of ['name', 'manufacturer', 'model', 'serialNumber', 'notes'] as const) {
    if (input[key] !== undefined) data[key] = input[key];
  }
  for (const key of ['category', 'locationId', 'departmentId', 'vendorId'] as const) {
    if (input[key] !== undefined) (data as Record<string, unknown>)[key] = input[key];
  }
  if (input.purchasedAt !== undefined) data.purchasedAt = input.purchasedAt ? new Date(input.purchasedAt) : null;
  if (input.warrantyExpiry !== undefined) data.warrantyExpiry = input.warrantyExpiry ? new Date(input.warrantyExpiry) : null;
  if (input.purchaseCost !== undefined) data.purchaseCost = input.purchaseCost;

  const asset = await prisma.asset.update({ where: { id }, data, include: assetDetailInclude });
  await recordAudit({ actorId: user.id, action: 'asset.updated', targetType: 'asset', targetId: id });
  return asset;
}

export async function transitionAsset(user: AuthedUser, id: string, to: string, reason?: string) {
  const asset = await prisma.$transaction(async (tx) => {
    const current = await tx.asset.findUnique({ where: { id } });
    if (!current) throw notFound('Asset not found');
    if (current.status === to) throw badRequest(`Asset is already ${to}`);
    const allowed = TRANSITIONS[current.status as AssetStatus] ?? [];
    if (!allowed.includes(to as AssetStatus)) {
      throw badRequest(`Cannot transition from ${current.status} to ${to}`);
    }
    return tx.asset.update({ where: { id }, data: { status: to as AssetStatus }, include: assetDetailInclude });
  });
  await recordAudit({
    actorId: user.id,
    action: 'asset.status_changed',
    targetType: 'asset',
    targetId: id,
    meta: { to, reason: reason ?? null },
  });
  return asset;
}

/* ── Custody assignments ──────────────────────────────────────────────────── */

async function requireAssetForAssignment(tx: Prisma.TransactionClient, assetId: string) {
  const asset = await tx.asset.findUnique({ where: { id: assetId } });
  if (!asset) throw notFound('Asset not found');
  if (['retired', 'lost'].includes(asset.status)) {
    throw conflict(`Asset is ${asset.status} and cannot be assigned`);
  }
  return asset;
}

/**
 * Assign the asset to an employee. If the asset is already actively assigned,
 * the existing assignment is closed ("reassigned") and a new one created —
 * both inside one transaction. Sets the asset's custodian and marks it
 * deployed if it came from stock.
 */
export async function assignAsset(
  user: AuthedUser,
  assetId: string,
  input: { employeeId: string; note?: string; dueAt?: string },
) {
  const employee = await prisma.employee.findUnique({ where: { id: input.employeeId } });
  if (!employee) throw badRequest('Unknown employee');

  let wasReassignment = false;
  const assignment = await prisma.$transaction(async (tx) => {
    await requireAssetForAssignment(tx, assetId);

    const active = await tx.assetAssignment.findFirst({ where: { assetId, activeKey: assetId } });
    wasReassignment = Boolean(active);
    if (active) {
      await tx.assetAssignment.update({
        where: { id: active.id },
        data: { status: 'returned', returnedAt: new Date(), returnNote: 'Reassigned', activeKey: null },
      });
    }

    const created = await tx.assetAssignment.create({
      data: {
        assetId,
        employeeId: input.employeeId,
        assignedById: user.id,
        note: input.note,
        dueAt: input.dueAt ? new Date(input.dueAt) : null,
        activeKey: assetId, // DB-level single-active-assignment constraint
      },
      include: {
        employee: { select: { id: true, employeeId: true, name: true, email: true } },
        assignedBy: { select: { id: true, name: true } },
        asset: { select: { id: true, number: true, name: true, status: true } },
      },
    });

    await tx.asset.update({
      where: { id: assetId },
      data: {
        custodianId: input.employeeId,
        ...(active ? {} : { status: 'deployed' as const }),
      },
    });
    return created;
  });

  await recordAudit({
    actorId: user.id,
    action: wasReassignment ? 'asset.reassigned' : 'asset.assigned',
    targetType: 'asset',
    targetId: assetId,
    meta: { assignmentId: assignment.id, employeeId: input.employeeId },
  });
  return assignment;
}

/** Custodian confirms receipt of an assigned asset. */
export async function acknowledgeAssignment(user: AuthedUser, assignmentId: string) {
  const assignment = await prisma.assetAssignment.findUnique({ where: { id: assignmentId } });
  if (!assignment) throw notFound('Assignment not found');
  if (assignment.employeeId !== user.employeeId) throw forbidden('Only the assignee can acknowledge this assignment');
  if (assignment.acknowledgedAt) throw badRequest('Assignment already acknowledged');
  return prisma.assetAssignment.update({
    where: { id: assignmentId },
    data: { acknowledgedAt: new Date() },
  });
}

/** Return an asset to stock (or hand back to IT). Clears the custodian. */
export async function returnAsset(
  user: AuthedUser,
  assignmentId: string,
  input: { note?: string },
) {
  const assignment = await prisma.assetAssignment.findUnique({ where: { id: assignmentId }, include: { asset: true } });
  if (!assignment) throw notFound('Assignment not found');
  const isAssignee = assignment.employeeId === user.employeeId;
  if (!isAssignee && !can(user, 'assets:assign')) {
    throw forbidden('Only IT or the assignee can return this asset');
  }
  if (assignment.status !== 'active') throw conflict('Assignment is not active');

  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.assetAssignment.update({
      where: { id: assignmentId },
      data: { status: 'returned', returnedAt: new Date(), returnNote: input.note, activeKey: null },
    });
    await tx.asset.update({
      where: { id: assignment.assetId },
      data: { custodianId: null, status: 'in_stock' },
    });
    return row;
  });
  await recordAudit({
    actorId: user.id,
    action: 'asset.returned',
    targetType: 'asset',
    targetId: assignment.assetId,
    meta: { assignmentId },
  });
  return updated;
}

export async function listAssignments(opts: { employeeId?: string; active?: boolean; assetId?: string; page: number; limit: number }) {
  const where: Prisma.AssetAssignmentWhereInput = {};
  if (opts.employeeId) where.employeeId = opts.employeeId;
  if (opts.assetId) where.assetId = opts.assetId;
  if (opts.active !== undefined) {
    where.status = opts.active ? 'active' : 'returned';
  }
  const [data, total] = await Promise.all([
    prisma.assetAssignment.findMany({
      where,
      orderBy: { assignedAt: 'desc' },
      include: {
        asset: { select: { id: true, number: true, name: true, category: true, status: true } },
        employee: { select: { id: true, employeeId: true, name: true, email: true } },
        assignedBy: { select: { id: true, name: true } },
      },
      skip: (opts.page - 1) * opts.limit,
      take: opts.limit,
    }),
    prisma.assetAssignment.count({ where }),
  ]);
  return { data, meta: { total, page: opts.page, limit: opts.limit, pages: Math.ceil(total / opts.limit) } };
}

/** An employee's view: their own assignments only (asset basics included). */
export async function listMyAssignments(user: AuthedUser) {
  if (!user.employeeId) return [];
  return prisma.assetAssignment.findMany({
    where: { employeeId: user.employeeId },
    orderBy: [{ status: 'asc' }, { assignedAt: 'desc' }],
    include: {
      asset: { select: { id: true, number: true, name: true, category: true } },
    },
    take: 100,
  });
}
