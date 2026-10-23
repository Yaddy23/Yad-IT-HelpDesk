import type { Prisma, Role } from '@prisma/client';

import { recordAudit } from '../../core/audit.js';
import { badRequest, notFound } from '../../core/errors.js';
import { hashPassword } from '../../core/password.js';
import { prisma } from '../../prisma/client.js';
import type { AuthedRequest } from '../../core/request.js';

const userPublicSelect = {
  id: true,
  email: true,
  name: true,
  active: true,
  lastLoginAt: true,
  createdAt: true,
  roles: { select: { role: true } },
  // managerId is part of the list payload: the admin edit form prefills from it.
  employee: {
    select: { id: true, employeeId: true, name: true, jobTitle: true, departmentId: true, locationId: true, managerId: true },
  },
} satisfies Prisma.UserSelect;

type PublicUser = Prisma.UserGetPayload<{ select: typeof userPublicSelect }>;

function strip(user: PublicUser) {
  const { roles, ...rest } = user;
  return { ...rest, roles: roles.map((r) => r.role) };
}

export interface ListUsersQuery {
  page: number;
  limit: number;
  role?: Role;
  q?: string;
}

export async function listUsers(query: ListUsersQuery) {
  const { page, limit, role, q } = query;
  const where: Prisma.UserWhereInput = {};
  if (role) where.roles = { some: { role } };
  if (q) where.OR = [{ email: { contains: q, mode: 'insensitive' } }, { name: { contains: q, mode: 'insensitive' } }];

  const [total, users] = await Promise.all([
    prisma.user.count({ where }),
    prisma.user.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
      select: userPublicSelect,
    }),
  ]);
  return { data: users.map(strip), page, pages: Math.ceil(total / limit) || 1, total };
}

export async function getUser(id: string) {
  const user = await prisma.user.findUnique({
    where: { id },
    select: {
      ...userPublicSelect,
      employee: {
        select: {
          id: true,
          employeeId: true,
          name: true,
          jobTitle: true,
          departmentId: true,
          managerId: true,
          locationId: true,
          employmentStatus: true,
        },
      },
    },
  });
  if (!user) throw notFound('User not found');
  return strip(user);
}

/** `null` on an optional reference means "explicitly none" (a cleared form field). */
export interface CreateUserInput {
  email: string;
  name: string;
  password: string;
  roles: Role[];
  jobTitle?: string | null;
  departmentId?: string | null;
  locationId?: string | null;
  managerEmployeeId?: string | null;
}

export async function createUser(req: AuthedRequest, input: CreateUserInput) {
  const actor = req.user!;
  const email = input.email.toLowerCase();
  if (await prisma.user.findUnique({ where: { email } })) {
    throw badRequest('A user with this email already exists', 'EMAIL_TAKEN');
  }

  const user = await prisma.$transaction(async (tx) => {
    const employeeCount = await tx.employee.count();
    return tx.user.create({
      data: {
        email,
        name: input.name,
        passwordHash: await hashPassword(input.password),
        roles: { create: input.roles.map((role) => ({ role })) },
        employee: {
          create: {
            employeeId: `EMP-${String(employeeCount + 1).padStart(6, '0')}`,
            name: input.name,
            email,
            jobTitle: input.jobTitle,
            departmentId: input.departmentId,
            locationId: input.locationId,
            managerId: input.managerEmployeeId,
          },
        },
      },
      select: userPublicSelect,
    });
  });

  await recordAudit({
    actorId: actor.id,
    actorEmail: actor.email,
    action: 'user.created',
    targetType: 'user',
    targetId: user.id,
    after: { email: user.email, roles: input.roles },
    ip: req.ip,
  });
  return strip(user);
}

/**
 * A person cannot report to themselves, and a reporting chain must not loop —
 * an approval route that cycles never terminates. Walks the proposed manager's
 * own chain upward; the visited set also stops a walk through pre-existing bad
 * data, so the depth is bounded by the org size rather than by a magic number.
 */
async function assertManagerAssignable(employeeId: string | null, managerEmployeeId: string | null | undefined) {
  if (!managerEmployeeId) return;
  if (managerEmployeeId === employeeId) {
    throw badRequest('A person cannot be their own manager', 'SELF_MANAGER');
  }

  const visited = new Set<string>();
  let cursor: string | null = managerEmployeeId;
  while (cursor && !visited.has(cursor)) {
    visited.add(cursor);
    const node: { managerId: string | null } | null = await prisma.employee.findUnique({
      where: { id: cursor },
      select: { managerId: true },
    });
    cursor = node?.managerId ?? null;
    if (cursor && cursor === employeeId) {
      throw badRequest('That manager already reports to this person', 'MANAGER_CYCLE');
    }
  }
}

export interface UpdateUserInput {
  name?: string;
  roles?: Role[];
  active?: boolean;
  jobTitle?: string | null;
  departmentId?: string | null;
  locationId?: string | null;
  managerEmployeeId?: string | null;
}

/** Role changes are the canonical privilege-escalation vector — always audited with before/after. */
export async function updateUser(req: AuthedRequest, id: string, input: UpdateUserInput) {
  const actor = req.user!;
  const existing = await prisma.user.findUnique({
    where: { id },
    select: { id: true, roles: { select: { role: true } }, active: true, name: true, employee: { select: { id: true } } },
  });
  if (!existing) throw notFound('User not found');

  if (typeof input.active === 'boolean' && !input.active) {
    if (id === actor.id) throw badRequest('You cannot deactivate your own account', 'SELF_DEACTIVATION');
  }

  await assertManagerAssignable(existing.employee?.id ?? null, input.managerEmployeeId);

  const user = await prisma.$transaction(async (tx) => {
    if (typeof input.active === 'boolean' && !input.active) {
      // Deactivation revokes sessions immediately.
      await tx.session.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } });
    }
    return tx.user.update({
      where: { id },
      data: {
        ...(input.roles
          ? { roles: { deleteMany: {}, create: input.roles.map((role) => ({ role })) } }
          : {}),
        ...(typeof input.active === 'boolean' ? { active: input.active } : {}),
        ...(input.name ? { name: input.name } : {}),
        ...(input.name || input.jobTitle !== undefined || input.departmentId !== undefined ||
        input.locationId !== undefined || input.managerEmployeeId !== undefined
          ? {
              employee: {
                update: {
                  ...(input.name ? { name: input.name } : {}),
                  ...(input.jobTitle !== undefined ? { jobTitle: input.jobTitle } : {}),
                  ...(input.departmentId !== undefined ? { departmentId: input.departmentId } : {}),
                  ...(input.locationId !== undefined ? { locationId: input.locationId } : {}),
                  ...(input.managerEmployeeId !== undefined ? { managerId: input.managerEmployeeId } : {}),
                },
              },
            }
          : {}),
      },
      select: userPublicSelect,
    });
  });

  await recordAudit({
    actorId: actor.id,
    actorEmail: actor.email,
    action: 'user.updated',
    targetType: 'user',
    targetId: id,
    before: { roles: existing.roles.map((r) => r.role), active: existing.active },
    after: { roles: input.roles, active: input.active },
    ip: req.ip,
  });
  return strip(user);
}

export async function resetPassword(req: AuthedRequest, id: string, newPassword: string) {
  const actor = req.user!;
  const existing = await prisma.user.findUnique({ where: { id }, select: { id: true } });
  if (!existing) throw notFound('User not found');

  await prisma.$transaction([
    prisma.user.update({ where: { id }, data: { passwordHash: await hashPassword(newPassword) } }),
    prisma.session.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } }),
  ]);
  await recordAudit({
    actorId: actor.id,
    actorEmail: actor.email,
    action: 'user.password_reset',
    targetType: 'user',
    targetId: id,
    ip: req.ip,
  });
}

/** Dropdown data for the user form (departments, locations, employees as managers). */
export async function orgOptions() {
  const [departments, locations, employees] = await Promise.all([
    prisma.department.findMany({ where: { active: true }, select: { id: true, name: true, code: true }, orderBy: { name: 'asc' } }),
    prisma.location.findMany({ where: { active: true }, select: { id: true, name: true, code: true }, orderBy: { name: 'asc' } }),
    prisma.employee.findMany({
      where: { employmentStatus: 'active' },
      select: { id: true, employeeId: true, name: true },
      orderBy: { name: 'asc' },
      take: 500,
    }),
  ]);
  return { departments, locations, employees };
}
