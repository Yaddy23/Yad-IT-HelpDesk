import { recordAudit } from '../../core/audit.js';
import { badRequest, conflict, notFound } from '../../core/errors.js';
import type { AuthedUser } from '../../core/request.js';
import { prisma } from '../../prisma/client.js';

/* ── Licenses ─────────────────────────────────────────────────────────────── */

export async function createLicense(
  user: AuthedUser,
  input: { name: string; vendorId?: string; licenseKey?: string; type?: 'perpetual' | 'subscription' | 'oem' | 'volume'; seats: number; expiresAt?: string; cost?: number; notes?: string },
) {
  const license = await prisma.softwareLicense.create({
    data: {
      name: input.name,
      vendorId: input.vendorId,
      licenseKey: input.licenseKey,
      type: input.type,
      seats: input.seats,
      expiresAt: input.expiresAt ? new Date(input.expiresAt) : undefined,
      cost: input.cost,
      notes: input.notes,
    },
    include: { vendor: { select: { id: true, name: true } } },
  });
  await recordAudit({ actorId: user.id, action: 'license.created', targetType: 'software_license', targetId: license.id, meta: { name: license.name, seats: license.seats } });
  return license;
}

export async function listLicenses(opts: { q?: string; page: number; limit: number }) {
  const where = opts.q
    ? {
        OR: [
          { name: { contains: opts.q, mode: 'insensitive' as const } },
          { licenseKey: { contains: opts.q, mode: 'insensitive' as const } },
        ],
      }
    : {};
  const [data, total] = await Promise.all([
    prisma.softwareLicense.findMany({
      where,
      include: {
        vendor: { select: { id: true, name: true } },
        _count: { select: { assignments: { where: { status: 'active' } } } },
      },
      orderBy: { name: 'asc' },
      skip: (opts.page - 1) * opts.limit,
      take: opts.limit,
    }),
    prisma.softwareLicense.count({ where }),
  ]);
  return {
    data: data.map((l) => ({ ...l, seatsInUse: l._count.assignments, _count: undefined })),
    meta: { total, page: opts.page, limit: opts.limit, pages: Math.ceil(total / opts.limit) },
  };
}

export async function getLicense(id: string) {
  const license = await prisma.softwareLicense.findUnique({
    where: { id },
    include: {
      vendor: { select: { id: true, name: true } },
      assignments: {
        orderBy: { assignedAt: 'desc' },
        include: { employee: { select: { id: true, employeeId: true, name: true, email: true } }, assignedBy: { select: { id: true, name: true } } },
      },
    },
  });
  if (!license) throw notFound('License not found');
  const seatsInUse = license.assignments.filter((a) => a.status === 'active').length;
  return { ...license, seatsInUse };
}

export async function updateLicense(
  user: AuthedUser,
  id: string,
  input: Partial<{ name: string; vendorId: string | null; licenseKey: string | null; type: 'perpetual' | 'subscription' | 'oem' | 'volume'; seats: number; expiresAt: string | null; cost: number | null; notes: string | null }>,
) {
  const { expiresAt, ...rest } = input;
  // Seat-cut guard runs inside a transaction that locks the license row
  // FOR UPDATE, so a concurrent assignLicense (which takes the same lock
  // before counting) cannot slip an assignment past the check.
  const license = await prisma.$transaction(async (tx) => {
    const [locked] = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "SoftwareLicense" WHERE id = ${id} FOR UPDATE`;
    if (!locked) throw notFound('License not found');
    const activeCount = await tx.licenseAssignment.count({ where: { licenseId: id, status: 'active' } });
    if (input.seats !== undefined && input.seats < activeCount) {
      throw conflict(`Cannot cut seats to ${input.seats}: ${activeCount} are currently assigned`);
    }
    return tx.softwareLicense.update({
      where: { id },
      data: { ...rest, ...(expiresAt !== undefined ? { expiresAt: expiresAt ? new Date(expiresAt) : null } : {}) },
      include: { vendor: { select: { id: true, name: true } } },
    });
  });
  await recordAudit({ actorId: user.id, action: 'license.updated', targetType: 'software_license', targetId: id });
  return license;
}

/* ── Seat assignments ─────────────────────────────────────────────────────── */

export async function assignLicense(
  user: AuthedUser,
  licenseId: string,
  input: { employeeId: string; note?: string },
) {
  const license = await prisma.softwareLicense.findUnique({ where: { id: licenseId } });
  if (!license) throw notFound('License not found');
  const employee = await prisma.employee.findUnique({ where: { id: input.employeeId } });
  if (!employee) throw notFound('Employee not found');

  // Seat guard + one-active-seat-per-employee both checked in-transaction;
  // the license row is locked FOR UPDATE first so concurrent assigns for
  // different employees serialize — two racing requests cannot both pass
  // the seat check. activeKey = "licenseId:employeeId" so the nullable-unique
  // index blocks a second active row for the same pair at the DB level.
  const assignment = await prisma.$transaction(async (tx) => {
    const [locked] = await tx.$queryRaw<{ id: string; seats: number }[]>`SELECT id, seats FROM "SoftwareLicense" WHERE id = ${licenseId} FOR UPDATE`;
    if (!locked) throw notFound('License not found');
    const activeCount = await tx.licenseAssignment.count({ where: { licenseId, status: 'active' } });
    if (activeCount >= locked.seats) {
      throw conflict(`No seats left: ${activeCount}/${locked.seats} in use`);
    }
    const duplicate = await tx.licenseAssignment.findFirst({ where: { licenseId, employeeId: input.employeeId, status: 'active' } });
    if (duplicate) throw conflict('Employee already holds an active seat on this license');

    return tx.licenseAssignment.create({
      data: {
        licenseId,
        employeeId: input.employeeId,
        assignedById: user.id,
        note: input.note,
        activeKey: `${licenseId}:${input.employeeId}`,
      },
      include: { employee: { select: { id: true, employeeId: true, name: true, email: true } }, assignedBy: { select: { id: true, name: true } } },
    });
  });

  await recordAudit({ actorId: user.id, action: 'license.assigned', targetType: 'software_license', targetId: licenseId, meta: { assignmentId: assignment.id, employeeId: input.employeeId } });
  return assignment;
}

export async function returnLicense(user: AuthedUser, assignmentId: string, note?: string) {
  const assignment = await prisma.licenseAssignment.findUnique({ where: { id: assignmentId } });
  if (!assignment) throw notFound('Assignment not found');
  if (assignment.status === 'returned') throw badRequest('Seat already returned');

  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.licenseAssignment.update({
      where: { id: assignmentId },
      data: { status: 'returned', returnedAt: new Date(), activeKey: null, ...(note ? { note } : {}) },
      include: { employee: { select: { id: true, employeeId: true, name: true, email: true } }, assignedBy: { select: { id: true, name: true } } },
    });
    return row;
  });

  await recordAudit({ actorId: user.id, action: 'license.returned', targetType: 'software_license', targetId: updated.licenseId, meta: { assignmentId, employeeId: updated.employeeId } });
  return updated;
}

export async function listAssignments(opts: { licenseId?: string; employeeId?: string; active?: boolean; page: number; limit: number }) {
  const where = {
    ...(opts.licenseId ? { licenseId: opts.licenseId } : {}),
    ...(opts.employeeId ? { employeeId: opts.employeeId } : {}),
    ...(opts.active !== undefined ? { status: opts.active ? ('active' as const) : ('returned' as const) } : {}),
  };
  const [data, total] = await Promise.all([
    prisma.licenseAssignment.findMany({
      where,
      orderBy: { assignedAt: 'desc' },
      include: {
        license: { select: { id: true, name: true, seats: true } },
        employee: { select: { id: true, employeeId: true, name: true, email: true } },
        assignedBy: { select: { id: true, name: true } },
      },
      skip: (opts.page - 1) * opts.limit,
      take: opts.limit,
    }),
    prisma.licenseAssignment.count({ where }),
  ]);
  return { data, meta: { total, page: opts.page, limit: opts.limit, pages: Math.ceil(total / opts.limit) } };
}
