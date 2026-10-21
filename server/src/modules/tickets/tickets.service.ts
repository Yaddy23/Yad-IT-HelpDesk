import type { Prisma, Role, TicketStatus } from '@prisma/client';

import { recordAudit } from '../../core/audit.js';
import { badRequest, forbidden, notFound, conflict } from '../../core/errors.js';
import { hasPermission, type Permission } from '../../core/permissions.js';
import type { AuthedUser } from '../../core/request.js';
import { prisma } from '../../prisma/client.js';
import { calculatePriority } from '../settings/priorityMatrix.js';
import { getSystemSettings } from '../settings/settings.routes.js';
import { OPEN_STATUSES } from './tickets.statuses.js';

/** hasPermission with the auth-context role list (typed string[] → Role[]). */
function can(user: AuthedUser, permission: Permission): boolean {
  return hasPermission({ roles: user.roles as Role[] }, permission);
}

/* ── Access scope ─────────────────────────────────────────────────────────── */

/** Roles that see every ticket regardless of group/assignment. */
const GLOBAL_VIEW_ROLES = ['super_admin', 'it_admin', 'it_manager'];

async function activeGroupIds(userId: string): Promise<string[]> {
  const memberships = await prisma.assignmentGroupMember.findMany({
    where: { userId, leftAt: null },
    select: { groupId: true },
  });
  return memberships.map((m) => m.groupId);
}

/** Row-level WHERE clause for list queries, derived from the user's roles. */
export async function ticketScopeWhere(user: AuthedUser): Promise<Prisma.TicketWhereInput> {
  if (user.roles.some((r) => GLOBAL_VIEW_ROLES.includes(r))) return {};

  const groupIds = await activeGroupIds(user.id);
  const empId = user.employeeId;

  // Technicians: own requests + assigned to them + their groups' queue.
  if (empId && (groupIds.length > 0 || can(user, 'tickets:update'))) {
    return {
      OR: [
        { requesterId: empId },
        { assigneeId: empId },
        ...(groupIds.length > 0 ? [{ groupId: { in: groupIds } }] : []),
      ],
    };
  }
  // Plain employees: only what they requested.
  return empId ? { requesterId: empId } : { id: { in: [] } };
}

export async function assertCanView(user: AuthedUser, ticket: { requesterId: string; assigneeId: string | null; groupId: string | null }) {
  if (user.roles.some((r) => GLOBAL_VIEW_ROLES.includes(r))) return;
  const groupIds = await activeGroupIds(user.id);
  const involved =
    ticket.requesterId === user.employeeId ||
    ticket.assigneeId === user.employeeId ||
    (ticket.groupId !== null && groupIds.includes(ticket.groupId));
  if (!involved) throw notFound('Ticket not found');
}

/* ── State machine ────────────────────────────────────────────────────────── */

const TRANSITIONS: Record<TicketStatus, TicketStatus[]> = {
  new: ['in_progress', 'pending_employee', 'pending_vendor', 'resolved', 'canceled'],
  in_progress: ['pending_employee', 'pending_vendor', 'resolved', 'canceled'],
  pending_employee: ['in_progress', 'resolved', 'canceled'],
  pending_vendor: ['in_progress', 'resolved', 'canceled'],
  resolved: ['closed', 'in_progress'], // in_progress = reopen
  closed: [],
  canceled: [],
};

/* ── Helpers ──────────────────────────────────────────────────────────────── */

const ticketDetailInclude = {
  requester: { select: { id: true, employeeId: true, name: true, email: true, department: { select: { name: true } } } },
  assignee: { select: { id: true, employeeId: true, name: true, email: true } },
  group: { select: { id: true, name: true, code: true } },
} satisfies Prisma.TicketInclude;

function ticketPublicSelect() {
  return {
    id: true,
    number: true,
    title: true,
    description: true,
    category: true,
    status: true,
    impact: true,
    urgency: true,
    priority: true,
    priorityOverrideReason: true,
    resolutionNote: true,
    resolvedAt: true,
    closedAt: true,
    reopenedCount: true,
    version: true,
    createdAt: true,
    updatedAt: true,
    requester: true,
    assignee: true,
    group: true,
  } satisfies Prisma.TicketSelect;
}

type TicketDetail = Prisma.TicketGetPayload<{ include: typeof ticketDetailInclude }>;

/* ── Service ──────────────────────────────────────────────────────────────── */

export async function createTicket(
  user: AuthedUser,
  input: {
    title: string;
    description: string;
    category: string;
    impact: 'low' | 'medium' | 'high';
    urgency: 'low' | 'medium' | 'high';
    requesterId?: string;
    groupId?: string;
  },
): Promise<TicketDetail> {
  // Employees always file for themselves; agents may file on behalf of others.
  let requesterId = user.employeeId;
  if (input.requesterId && input.requesterId !== user.employeeId) {
    if (!can(user, 'tickets:update')) {
      throw forbidden('You can only file tickets for yourself');
    }
    requesterId = input.requesterId;
  }
  if (!requesterId) throw forbidden('Your account has no employee record');

  const settings = await getSystemSettings();
  const priority = calculatePriority(settings.priorityMatrix, input.impact, input.urgency);

  const { ticket, number } = await prisma.$transaction(async (tx) => {
    const counter = await tx.ticketCounter.upsert({
      where: { key: 'INC' },
      create: { key: 'INC', next: 2 },
      update: { next: { increment: 1 } },
    });
    const number = `INC-${new Date().getFullYear()}-${String(counter.next - 1).padStart(6, '0')}`;
    const ticket = await tx.ticket.create({
      data: {
        number,
        title: input.title,
        description: input.description,
        category: input.category,
        impact: input.impact,
        urgency: input.urgency,
        priority,
        requesterId,
        groupId: input.groupId ?? null,
        activities: {
          create: {
            actorId: user.id,
            action: 'created',
            detail: { priority, impact: input.impact, urgency: input.urgency },
          },
        },
      },
      include: ticketDetailInclude,
    });
    return { ticket, number };
  });

  await recordAudit({
    actorId: user.id,
    actorEmail: user.email,
    action: 'ticket.created',
    targetType: 'ticket',
    targetId: ticket.id,
    meta: { number, priority },
  });
  return ticket;
}

export async function listTickets(
  user: AuthedUser,
  query: {
    page: number;
    limit: number;
    queue: 'unassigned' | 'my' | 'group' | 'mine' | 'all';
    status?: TicketStatus[];
    priority?: string[];
    category?: string;
    q?: string;
    sort: 'newest' | 'oldest' | 'priority';
  },
) {
  const scope = await ticketScopeWhere(user);

  const queueWhere: Prisma.TicketWhereInput = {};
  switch (query.queue) {
    case 'mine':
      queueWhere.requesterId = user.employeeId ?? { in: [] };
      break;
    case 'my':
      queueWhere.assigneeId = user.employeeId ?? { in: [] };
      break;
    case 'group': {
      const groupIds = await activeGroupIds(user.id);
      queueWhere.groupId = { in: groupIds }; // empty list matches nothing
      break;
    }
    case 'unassigned':
      queueWhere.assigneeId = null;
      queueWhere.groupId = null;
      break;
    case 'all':
      break;
  }

  const searchWhere: Prisma.TicketWhereInput = query.q
    ? { OR: [{ title: { contains: query.q, mode: 'insensitive' } }, { number: { contains: query.q, mode: 'insensitive' } }] }
    : {};

  const where: Prisma.TicketWhereInput = {
    AND: [
      scope,
      queueWhere,
      query.status?.length ? { status: { in: query.status } } : {},
      query.priority?.length ? { priority: { in: query.priority as never } } : {},
      query.category ? { category: { equals: query.category, mode: 'insensitive' } } : {},
      searchWhere,
    ],
  };

  const orderBy:
    | Prisma.TicketOrderByWithRelationInput
    | Prisma.TicketOrderByWithRelationInput[] =
    query.sort === 'oldest'
      ? { createdAt: 'asc' }
      : query.sort === 'priority'
        ? [{ priority: 'desc' as const }, { createdAt: 'desc' as const }]
        : { createdAt: 'desc' as const };

  const [total, items] = await prisma.$transaction([
    prisma.ticket.count({ where }),
    prisma.ticket.findMany({
      where,
      orderBy,
      skip: (query.page - 1) * query.limit,
      take: query.limit,
      select: { ...ticketPublicSelect(), description: false, _count: { select: { comments: true } } },
    }),
  ]);

  return { items, total, page: query.page, limit: query.limit, pages: Math.max(1, Math.ceil(total / query.limit)) };
}

export async function getTicket(user: AuthedUser, id: string) {
  const ticket = await prisma.ticket.findUnique({
    where: { id },
    include: {
      ...ticketDetailInclude,
      comments: {
        orderBy: { createdAt: 'asc' },
        // Internal work notes are invisible without the worknotes permission.
        where: can(user, 'tickets:worknotes') ? {} : { isInternal: false },
        include: { author: { select: { id: true, name: true } } },
      },
      activities: {
        orderBy: { createdAt: 'asc' },
        include: { actor: { select: { id: true, name: true } } },
      },
      assignments: {
        orderBy: { createdAt: 'desc' },
        include: {
          assignee: { select: { id: true, employeeId: true, name: true } },
          group: { select: { id: true, name: true } },
          assignedBy: { select: { id: true, name: true } },
        },
      },
      attachments: {
        orderBy: { createdAt: 'desc' },
        include: { uploadedBy: { select: { id: true, name: true } } },
      },
    },
  });
  if (!ticket) throw notFound('Ticket not found');
  await assertCanView(user, ticket);
  return ticket;
}

export async function assignTicket(
  user: AuthedUser,
  id: string,
  input: { assigneeId?: string; groupId?: string; note?: string },
) {
  const ticket = await prisma.ticket.findUnique({ where: { id } });
  if (!ticket) throw notFound('Ticket not found');
  if (ticket.status === 'closed' || ticket.status === 'canceled') {
    throw conflict('Closed tickets cannot be reassigned');
  }
  if (input.assigneeId) {
    const assignee = await prisma.employee.findUnique({ where: { id: input.assigneeId } });
    if (!assignee) throw notFound('Assignee not found');
  }
  if (input.groupId) {
    const group = await prisma.assignmentGroup.findUnique({ where: { id: input.groupId } });
    if (!group || !group.active) throw notFound('Assignment group not found');
  }

  const updated = await prisma.$transaction(async (tx) => {
    const next = await tx.ticket.update({
      where: { id },
      data: {
        assigneeId: input.assigneeId ?? null,
        groupId: input.groupId ?? ticket.groupId,
        status: ticket.status === 'new' ? 'in_progress' : ticket.status,
        activities: {
          create: {
            actorId: user.id,
            action: 'assigned',
            detail: {
              from: { assigneeId: ticket.assigneeId, groupId: ticket.groupId },
              to: { assigneeId: input.assigneeId ?? null, groupId: input.groupId ?? ticket.groupId },
              note: input.note ?? null,
            },
          },
        },
        assignments: {
          create: {
            assigneeId: input.assigneeId ?? null,
            groupId: input.groupId ?? null,
            assignedById: user.id,
            note: input.note ?? null,
          },
        },
      },
      include: ticketDetailInclude,
    });
    return next;
  });

  await recordAudit({
    actorId: user.id,
    actorEmail: user.email,
    action: 'ticket.assigned',
    targetType: 'ticket',
    targetId: id,
    meta: { number: ticket.number, assigneeId: input.assigneeId ?? null, groupId: input.groupId ?? null },
  });
  return updated;
}

export async function transitionTicket(
  user: AuthedUser,
  id: string,
  input: { status: 'in_progress' | 'pending_employee' | 'pending_vendor' | 'resolved' | 'closed' | 'canceled'; resolutionNote?: string; version: number },
) {
  const ticket = await prisma.ticket.findUnique({ where: { id } });
  if (!ticket) throw notFound('Ticket not found');

  const isAgent = can(user, 'tickets:update');
  const isRequester = ticket.requesterId === user.employeeId;

  if (!isAgent) {
    // Requester-only actions: cancel while untouched, reopen within the window.
    if (!isRequester) throw notFound('Ticket not found');
    const requesterAllowed: TicketStatus[] = ['in_progress', 'canceled'];
    if (input.status === 'canceled' && ticket.status !== 'new') {
      throw conflict('Only untouched tickets can be canceled by the requester');
    }
    if (input.status === 'in_progress') {
      // Reopen: allowed only from resolved, inside the reopen window.
      if (ticket.status !== 'resolved') throw conflict('Ticket can only be reopened while resolved');
      const settings = await getSystemSettings();
      const deadline = ticket.resolvedAt!.getTime() + settings.reopenWindowDays * 24 * 60 * 60 * 1000;
      if (Date.now() > deadline) {
        throw conflict(`Reopen window (${settings.reopenWindowDays} days) has passed — please file a new ticket`);
      }
    }
    if (!requesterAllowed.includes(input.status)) throw forbidden('Not allowed');
  }

  if (!TRANSITIONS[ticket.status].includes(input.status)) {
    throw conflict(`Cannot move a ${ticket.status} ticket to ${input.status}`);
  }
  if (input.status === 'resolved' && !input.resolutionNote && !ticket.resolutionNote) {
    throw badRequest('A resolution note is required to resolve a ticket', 'RESOLUTION_NOTE_REQUIRED');
  }
  if (input.status === 'resolved' && !can(user, 'tickets:resolve')) {
    throw forbidden('Missing permission: tickets:resolve');
  }
  if (input.status === 'closed' && !can(user, 'tickets:close')) {
    throw forbidden('Missing permission: tickets:close');
  }

  const isReopen = ticket.status === 'resolved' && input.status === 'in_progress';

  try {
    const updated = await prisma.$transaction(async (tx) =>
      tx.ticket.update({
        // Optimistic concurrency: stale versions produce P2025 → 409 below.
        where: { id, version: input.version },
        data: {
          status: input.status,
          version: { increment: 1 },
          resolutionNote: input.resolutionNote ?? ticket.resolutionNote,
          resolvedAt: input.status === 'resolved' ? new Date() : isReopen ? null : ticket.resolvedAt,
          closedAt: input.status === 'closed' ? new Date() : null,
          reopenedCount: isReopen ? { increment: 1 } : undefined,
          activities: {
            create: {
              actorId: user.id,
              action: isReopen ? 'reopened' : 'status_changed',
              detail: {
                from: ticket.status,
                to: input.status,
                resolutionNote: input.resolutionNote ?? undefined,
              },
            },
          },
        },
        include: ticketDetailInclude,
      }),
    );

    await recordAudit({
      actorId: user.id,
      actorEmail: user.email,
      action: `ticket.${isReopen ? 'reopened' : input.status}`,
      targetType: 'ticket',
      targetId: id,
      meta: { number: ticket.number, from: ticket.status, to: input.status },
    });
    return updated;
  } catch {
    throw conflict('Ticket was modified by someone else — reload and retry', 'STALE_VERSION');
  }
}

export async function overridePriority(
  user: AuthedUser,
  id: string,
  input: { impact?: 'low' | 'medium' | 'high'; urgency?: 'low' | 'medium' | 'high'; priority?: 'low' | 'medium' | 'high' | 'critical'; reason: string },
) {
  const ticket = await prisma.ticket.findUnique({ where: { id } });
  if (!ticket) throw notFound('Ticket not found');
  if (['closed', 'canceled', 'resolved'].includes(ticket.status)) {
    throw conflict('Priority can only be changed on open tickets');
  }

  const impact = input.impact ?? ticket.impact;
  const urgency = input.urgency ?? ticket.urgency;
  let priority = input.priority;
  let overrideReason: string | null = null;
  if (priority) {
    // Explicit override — recorded and audited.
    overrideReason = input.reason;
  } else {
    const settings = await getSystemSettings();
    priority = calculatePriority(settings.priorityMatrix, impact, urgency);
    if (priority !== ticket.priority) overrideReason = null; // matrix recompute, no override
  }

  if (priority === ticket.priority && impact === ticket.impact && urgency === ticket.urgency) {
    throw conflict('Nothing to change — ticket already has this priority');
  }

  const updated = await prisma.ticket.update({
    where: { id },
    data: {
      impact,
      urgency,
      priority,
      priorityOverrideReason: overrideReason,
      activities: {
        create: {
          actorId: user.id,
          action: 'priority_changed',
          detail: {
            from: { impact: ticket.impact, urgency: ticket.urgency, priority: ticket.priority },
            to: { impact, urgency, priority },
            reason: input.reason,
          },
        },
      },
    },
    include: ticketDetailInclude,
  });

  await recordAudit({
    actorId: user.id,
    actorEmail: user.email,
    action: 'ticket.priority_changed',
    targetType: 'ticket',
    targetId: id,
    before: { impact: ticket.impact, urgency: ticket.urgency, priority: ticket.priority },
    after: { impact, urgency, priority },
    meta: { number: ticket.number, reason: input.reason },
  });
  return updated;
}

export async function addComment(
  user: AuthedUser,
  id: string,
  input: { body: string; isInternal: boolean },
) {
  const ticket = await prisma.ticket.findUnique({ where: { id }, select: { id: true, requesterId: true, assigneeId: true, groupId: true, status: true } });
  if (!ticket) throw notFound('Ticket not found');
  await assertCanView(user, ticket);

  if (input.isInternal && !can(user, 'tickets:worknotes')) {
    throw forbidden('Missing permission: tickets:worknotes');
  }
  if (['closed', 'canceled'].includes(ticket.status)) {
    throw conflict('Cannot comment on a closed ticket');
  }

  return prisma.ticketComment.create({
    data: { ticketId: id, authorId: user.id, body: input.body, isInternal: input.isInternal },
    include: { author: { select: { id: true, name: true } } },
  });
}

/** Queue counts for dashboard/header badges — scope-limited like the list. */
export async function queueCounts(user: AuthedUser) {
  const scope = await ticketScopeWhere(user);
  const groupCounts = await prisma.ticket.groupBy({
    by: ['status'],
    where: { AND: [scope, { status: { in: OPEN_STATUSES } }] },
    _count: { _all: true },
  });
  const unassigned = await prisma.ticket.count({
    where: { AND: [scope, { assigneeId: null, groupId: null }, { status: { in: OPEN_STATUSES } }] },
  });
  const assignedToMe = await prisma.ticket.count({
    where: { AND: [scope, { assigneeId: user.employeeId ?? { in: [] } }, { status: { in: OPEN_STATUSES } }] },
  });
  const open = groupCounts.reduce((sum, g) => sum + g._count._all, 0);
  return { open, unassigned, assignedToMe };
}
