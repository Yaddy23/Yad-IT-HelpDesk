import type { Prisma } from '@prisma/client';

import { recordAudit } from '../../core/audit.js';
import { badRequest, conflict, notFound } from '../../core/errors.js';
import type { AuthedUser } from '../../core/request.js';
import { prisma } from '../../prisma/client.js';

/* ── Vendors ──────────────────────────────────────────────────────────────── */

export async function createVendor(user: AuthedUser, input: { name: string; contact?: string; email?: string; phone?: string; notes?: string }) {
  const vendor = await prisma.vendor.create({ data: input });
  await recordAudit({ actorId: user.id, action: 'vendor.created', targetType: 'vendor', targetId: vendor.id, meta: { name: vendor.name } });
  return vendor;
}

export async function listVendors(opts: { activeOnly?: boolean }) {
  return prisma.vendor.findMany({
    where: opts.activeOnly ? { active: true } : {},
    orderBy: { name: 'asc' },
  });
}

export async function updateVendor(user: AuthedUser, id: string, input: Partial<{ name: string; contact: string; email: string; phone: string; notes: string; active: boolean }>) {
  const existing = await prisma.vendor.findUnique({ where: { id } });
  if (!existing) throw notFound('Vendor not found');
  const vendor = await prisma.vendor.update({ where: { id }, data: input });
  await recordAudit({ actorId: user.id, action: 'vendor.updated', targetType: 'vendor', targetId: id });
  return vendor;
}

/* ── Maintenance schedules ────────────────────────────────────────────────── */

function addDays(from: Date, days: number): Date {
  return new Date(from.getTime() + days * 86400000);
}

export async function createSchedule(
  user: AuthedUser,
  assetId: string,
  input: { name: string; intervalDays: number; firstDueAt?: string },
) {
  const asset = await prisma.asset.findUnique({ where: { id: assetId } });
  if (!asset) throw notFound('Asset not found');
  const schedule = await prisma.maintenanceSchedule.create({
    data: {
      assetId,
      name: input.name,
      intervalDays: input.intervalDays,
      nextDueAt: input.firstDueAt ? new Date(input.firstDueAt) : addDays(new Date(), input.intervalDays),
    },
  });
  await recordAudit({ actorId: user.id, action: 'asset.schedule_created', targetType: 'asset', targetId: assetId, meta: { scheduleId: schedule.id, intervalDays: input.intervalDays } });
  return schedule;
}

/** Recording work against a schedule advances it; standalone records don't. */
export async function completeSchedule(user: AuthedUser, scheduleId: string, input: { summary: string; cost?: number; vendorId?: string; performedBy?: string }) {
  const schedule = await prisma.maintenanceSchedule.findUnique({ where: { id: scheduleId }, include: { asset: true } });
  if (!schedule) throw notFound('Schedule not found');
  if (!schedule.active) throw conflict('Schedule is inactive');

  const record = await prisma.$transaction(async (tx) => {
    const performedAt = new Date();
    const row = await tx.assetMaintenanceRecord.create({
      data: {
        assetId: schedule.assetId,
        scheduleId,
        type: 'preventive',
        performedAt,
        summary: input.summary,
        cost: input.cost,
        vendorId: input.vendorId,
        performedBy: input.performedBy,
        createdById: user.id,
      },
    });
    return tx.maintenanceSchedule.update({
      where: { id: scheduleId },
      data: {
        lastCompletedAt: performedAt,
        nextDueAt: addDays(schedule.nextDueAt < performedAt ? performedAt : schedule.nextDueAt, schedule.intervalDays),
      },
    }).then((updated) => ({ record: row, schedule: updated }));
  });

  await recordAudit({ actorId: user.id, action: 'asset.maintenance_logged', targetType: 'asset', targetId: schedule.assetId, meta: { scheduleId, recordId: record.record.id } });
  return record;
}

/* ── Maintenance records ──────────────────────────────────────────────────── */

export async function createMaintenanceRecord(
  user: AuthedUser,
  assetId: string,
  input: { type: 'preventive' | 'repair' | 'inspection' | 'upgrade'; summary: string; cost?: number; vendorId?: string; performedBy?: string; performedAt?: string },
) {
  const asset = await prisma.asset.findUnique({ where: { id: assetId } });
  if (!asset) throw notFound('Asset not found');
  const record = await prisma.assetMaintenanceRecord.create({
    data: {
      assetId,
      type: input.type,
      summary: input.summary,
      cost: input.cost,
      vendorId: input.vendorId,
      performedBy: input.performedBy,
      performedAt: input.performedAt ? new Date(input.performedAt) : undefined,
      createdById: user.id,
    },
    include: { vendor: { select: { id: true, name: true } }, createdBy: { select: { id: true, name: true } } },
  });
  await recordAudit({ actorId: user.id, action: 'asset.maintenance_logged', targetType: 'asset', targetId: assetId, meta: { recordId: record.id, type: input.type } });
  return record;
}

/* ── Global list endpoints (Maintenance tab) ──────────────────────────────── */

export async function listAllSchedules(opts: { dueWithinDays?: number; page: number; limit: number }) {
  const where = {
    active: true,
    ...(opts.dueWithinDays !== undefined
      ? { nextDueAt: { lte: new Date(Date.now() + opts.dueWithinDays * 86400000) } }
      : {}),
  };
  const [data, total] = await Promise.all([
    prisma.maintenanceSchedule.findMany({
      where,
      include: { asset: { select: { id: true, number: true, name: true, status: true } } },
      orderBy: { nextDueAt: 'asc' },
      skip: (opts.page - 1) * opts.limit,
      take: opts.limit,
    }),
    prisma.maintenanceSchedule.count({ where }),
  ]);
  return { data, meta: { total, page: opts.page, limit: opts.limit, pages: Math.ceil(total / opts.limit) } };
}

export async function listAllRecords(opts: { type?: string; page: number; limit: number }) {
  const where = opts.type ? { type: opts.type as never } : {};
  const [data, total] = await Promise.all([
    prisma.assetMaintenanceRecord.findMany({
      where,
      include: {
        asset: { select: { id: true, number: true, name: true } },
        vendor: { select: { id: true, name: true } },
        createdBy: { select: { id: true, name: true } },
      },
      orderBy: { performedAt: 'desc' },
      skip: (opts.page - 1) * opts.limit,
      take: opts.limit,
    }),
    prisma.assetMaintenanceRecord.count({ where }),
  ]);
  return { data, meta: { total, page: opts.page, limit: opts.limit, pages: Math.ceil(total / opts.limit) } };
}

export async function listAllClaims(opts: { status?: string; page: number; limit: number }) {
  const where = opts.status ? { status: opts.status as never } : {};
  const [data, total] = await Promise.all([
    prisma.warrantyClaim.findMany({
      where,
      include: {
        asset: { select: { id: true, number: true, name: true } },
        vendor: { select: { id: true, name: true } },
        createdBy: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
      skip: (opts.page - 1) * opts.limit,
      take: opts.limit,
    }),
    prisma.warrantyClaim.count({ where }),
  ]);
  return { data, meta: { total, page: opts.page, limit: opts.limit, pages: Math.ceil(total / opts.limit) } };
}

const CLAIM_TRANSITIONS: Record<string, string[]> = {
  open: ['submitted', 'resolved', 'rejected'],
  submitted: ['approved', 'rejected', 'resolved'],
  approved: ['resolved', 'rejected'],
  rejected: [],
  resolved: [],
};

export async function createWarrantyClaim(
  user: AuthedUser,
  assetId: string,
  input: { issue: string; vendorId?: string },
) {
  const asset = await prisma.asset.findUnique({ where: { id: assetId } });
  if (!asset) throw notFound('Asset not found');
  const claim = await prisma.warrantyClaim.create({
    data: { assetId, issue: input.issue, vendorId: input.vendorId, createdById: user.id },
    include: { vendor: { select: { id: true, name: true } }, createdBy: { select: { id: true, name: true } } },
  });
  await recordAudit({ actorId: user.id, action: 'asset.warranty_claimed', targetType: 'asset', targetId: assetId, meta: { claimId: claim.id } });
  return claim;
}

export async function updateWarrantyClaim(
  user: AuthedUser,
  claimId: string,
  input: { status?: string; resolution?: string },
) {
  const claim = await prisma.warrantyClaim.findUnique({ where: { id: claimId } });
  if (!claim) throw notFound('Warranty claim not found');

  const data: Prisma.WarrantyClaimUpdateInput = {};
  if (input.status) {
    const allowed = CLAIM_TRANSITIONS[claim.status] ?? [];
    if (!allowed.includes(input.status)) {
      throw badRequest(`Cannot move claim from ${claim.status} to ${input.status}`);
    }
    data.status = input.status as never;
    if (input.status === 'resolved') {
      data.resolvedAt = new Date();
      if (!input.resolution) throw badRequest('Resolution note is required when resolving a claim');
    }
  }
  if (input.resolution !== undefined) data.resolution = input.resolution;

  const updated = await prisma.warrantyClaim.update({
    where: { id: claimId },
    data,
    include: { vendor: { select: { id: true, name: true } }, createdBy: { select: { id: true, name: true } } },
  });
  await recordAudit({ actorId: user.id, action: 'asset.warranty_updated', targetType: 'warranty_claim', targetId: claimId, meta: { status: updated.status } });
  return updated;
}
