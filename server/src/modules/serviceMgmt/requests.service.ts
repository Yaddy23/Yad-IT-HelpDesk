import type { Prisma } from '@prisma/client';

import { recordAudit } from '../../core/audit.js';
import { badRequest, conflict, forbidden, notFound } from '../../core/errors.js';
import type { AuthedUser } from '../../core/request.js';
import { prisma } from '../../prisma/client.js';
import { createNotification } from '../notifications/notifications.service.js';
import {
  firstOpenStep,
  instantiateSteps,
  isStaff,
  type InstantiatedStep,
} from './approvals.service.js';
import { validateAnswers, type FormField } from './validators.js';

/**
 * Service requests — submitted against a catalog item, gated by its approval
 * rule. The core invariant: `in_fulfillment` is reachable ONLY through an
 * approved approval request (or when no rule applies), and both paths run
 * inside the same transaction that establishes them.
 */

/* ── Eligibility ──────────────────────────────────────────────────────────── */

interface Eligibility {
  departments?: string[];
  locations?: string[];
  roles?: string[];
}

/**
 * Absent or empty eligibility = everyone. Checks are OR'd (any one match
 * qualifies); an id lists membership by department/location id.
 */
export async function assertEligible(user: AuthedUser, eligibility: unknown) {
  const e = eligibility as Eligibility | null;
  if (!e) return;
  const hasDepartments = Array.isArray(e.departments) && e.departments.length > 0;
  const hasLocations = Array.isArray(e.locations) && e.locations.length > 0;
  const hasRoles = Array.isArray(e.roles) && e.roles.length > 0;
  if (!hasDepartments && !hasLocations && !hasRoles) return;

  const employee = user.employeeId
    ? await prisma.employee.findUnique({
        where: { id: user.employeeId },
        select: { departmentId: true, locationId: true },
      })
    : null;

  const matches =
    (hasDepartments && !!employee?.departmentId && e.departments!.includes(employee.departmentId)) ||
    (hasLocations && !!employee?.locationId && e.locations!.includes(employee.locationId)) ||
    (hasRoles && user.roles.some((r) => e.roles!.includes(r)));
  if (!matches) throw forbidden('This service is not available to you', 'NOT_ELIGIBLE');
}

/* ── Create ───────────────────────────────────────────────────────────────── */

export interface CreateRequestInput {
  catalogItemId: string;
  answers: Record<string, unknown>;
}

export async function createServiceRequest(actor: AuthedUser, input: CreateRequestInput) {
  if (!actor.employeeId) throw forbidden('Only employees with a worker record can submit service requests', 'NO_EMPLOYEE_RECORD');

  const item = await prisma.catalogItem.findUnique({
    where: { id: input.catalogItemId },
    include: { approvalRule: { select: { id: true, steps: true, active: true } } },
  });
  if (!item || !item.active) throw notFound('Catalog item not found');

  await assertEligible(actor, item.eligibility);

  const formSchema = item.formSchema as unknown as FormField[];
  const answerErrors = validateAnswers(formSchema, input.answers ?? {});
  if (answerErrors) {
    throw badRequest(
      `Invalid answers — ${Object.entries(answerErrors)
        .map(([k, v]) => `${k}: ${v}`)
        .join('; ')}`,
      'INVALID_ANSWERS',
    );
  }

  const requesterEmployee = await prisma.employee.findUnique({
    where: { id: actor.employeeId },
    select: { id: true, userId: true },
  });

  const request = await prisma.$transaction(async (tx) => {
    const counter = await tx.serviceRequestCounter.upsert({
      where: { key: 'SR' },
      create: { key: 'SR', next: 2 },
      update: { next: { increment: 1 } },
    });
    const number = `SR-${new Date().getFullYear()}-${String(counter.next - 1).padStart(6, '0')}`;

    // No active rule → no approval needed; the request goes straight to
    // fulfillment. A rule whose steps all resolve to nobody also auto-skips
    // to fulfillment inside instantiateSteps + firstOpenStep.
    const rule = item.approvalRule?.active ? item.approvalRule : null;
    const steps = rule ? await instantiateSteps(rule.steps, requesterEmployee?.id ?? null, new Date()) : [];
    const allSkipped = rule ? firstOpenStep(steps) >= steps.length : true;

    const created = await tx.serviceRequest.create({
      data: {
        number,
        catalogItem: { connect: { id: item.id } },
        requester: { connect: { id: actor.employeeId! } },
        status: allSkipped ? 'in_fulfillment' : 'pending_approval',
        answers: (input.answers ?? {}) as never,
      },
      include: requestInclude,
    });

    // The approval needs the request id as its target, so it is created
    // second and linked — still inside the same transaction.
    if (rule && !allSkipped) {
      const approval = await tx.approvalRequest.create({
        data: {
          targetType: 'service_request',
          targetId: created.id,
          steps: steps as never,
          currentStep: firstOpenStep(steps),
          requestedById: actor.id,
        },
      });
      await tx.serviceRequest.update({ where: { id: created.id }, data: { approvalRequestId: approval.id } });
      created.approvalRequestId = approval.id;
    }
    return created;
  });

  // Notify first-step approvers (post-transaction; failures never fail the submit).
  if (request.status === 'pending_approval' && request.approvalRequestId) {
    const approval = await prisma.approvalRequest.findUnique({ where: { id: request.approvalRequestId } });
    const steps = approval?.steps as unknown as InstantiatedStep[] | undefined;
    const step = steps?.[approval!.currentStep];
    if (step) {
      for (const userId of step.candidates) {
        await createNotification({
          userId,
          type: 'approval.requested',
          title: 'Approval requested',
          body: `${item.name} (${request.number}) is waiting for your decision.`,
          dedupeKey: `approval.requested:${approval!.id}:${approval!.currentStep}:${userId}`,
        }).catch(() => undefined);
      }
    }
  }

  await recordAudit({
    actorId: actor.id,
    actorEmail: actor.email,
    action: 'service_request.created',
    targetType: 'service_request',
    targetId: request.id,
    after: { number: request.number, catalogItem: item.name, status: request.status },
  });

  return { request };
}

/* ── Requester actions ────────────────────────────────────────────────────── */

/** Requester answers an info-request round; back to pending_approval at the same step. */
export async function addRequestInfo(actor: AuthedUser, id: string, note: string) {
  const request = await prisma.serviceRequest.findUnique({ where: { id } });
  if (!request) throw notFound('Service request not found');
  if (request.requesterId !== actor.employeeId) throw notFound('Service request not found');
  if (request.status !== 'info_requested') throw conflict('This request is not waiting for information');

  const rounds = (request.infoRequests ?? []) as Array<{ round: number; note: string; at: string; by: string }>;
  const nextRound = rounds.length + 1;

  const updated = await prisma.serviceRequest.update({
    where: { id },
    data: {
      status: 'pending_approval',
      infoRequests: [...rounds, { round: nextRound, note, at: new Date().toISOString(), by: 'requester' }] as never,
    },
    include: requestInclude,
  });

  await recordAudit({
    actorId: actor.id,
    actorEmail: actor.email,
    action: 'service_request.info_added',
    targetType: 'service_request',
    targetId: id,
    after: { round: nextRound },
  });

  return updated;
}

/** Requester cancels while it is still theirs to cancel (pre-fulfillment). */
export async function cancelRequest(actor: AuthedUser, id: string) {
  const request = await prisma.serviceRequest.findUnique({ where: { id } });
  if (!request) throw notFound('Service request not found');
  const isRequester = request.requesterId === actor.employeeId;
  if (!isRequester && !isStaff(actor)) throw notFound('Service request not found');
  if (request.status === 'fulfilled' || request.status === 'canceled') {
    throw conflict(`This request is already ${request.status}`);
  }
  if (request.status === 'rejected') throw conflict('This request was already rejected');

  const updated = await prisma.serviceRequest.update({
    where: { id },
    data: { status: 'canceled' },
    include: requestInclude,
  });
  // Cancel the approval too, if one is still open.
  if (updated.approvalRequestId) {
    await prisma.approvalRequest.updateMany({
      where: { id: updated.approvalRequestId, status: 'pending' },
      data: { status: 'canceled', decidedAt: new Date() },
    });
  }

  await recordAudit({
    actorId: actor.id,
    actorEmail: actor.email,
    action: 'service_request.canceled',
    targetType: 'service_request',
    targetId: id,
    after: { number: request.number, by: isRequester ? 'requester' : 'staff' },
  });

  return updated;
}

/* ── Fulfillment (staff) ──────────────────────────────────────────────────── */

/**
 * The ONLY manual transition into `fulfilled`, and only from
 * `in_fulfillment` — which itself is only reachable through approval.
 */
export async function fulfillRequest(actor: AuthedUser, id: string, note?: string) {
  const request = await prisma.serviceRequest.findUnique({ where: { id } });
  if (!request) throw notFound('Service request not found');
  if (request.status !== 'in_fulfillment') {
    throw conflict(`Request is ${request.status} — only in_fulfillment requests can be fulfilled`, 'NOT_IN_FULFILLMENT');
  }

  const updated = await prisma.serviceRequest.update({
    where: { id },
    data: { status: 'fulfilled', fulfilledAt: new Date(), fulfillNote: note ?? null },
    include: requestInclude,
  });

  const requesterUserId = await prisma.employee.findUnique({
    where: { id: request.requesterId },
    select: { userId: true },
  });
  if (requesterUserId?.userId) {
    await createNotification({
      userId: requesterUserId.userId,
      type: 'service_request.fulfilled',
      title: 'Request fulfilled',
      body: `${request.number} has been fulfilled${note ? `: ${note}` : '.'}`,
      dedupeKey: `sr.fulfilled:${request.id}`,
    }).catch(() => undefined);
  }

  await recordAudit({
    actorId: actor.id,
    actorEmail: actor.email,
    action: 'service_request.fulfilled',
    targetType: 'service_request',
    targetId: id,
    after: { number: request.number, note: note ?? null },
  });

  return updated;
}

/* ── Reads ────────────────────────────────────────────────────────────────── */

const requestInclude = {
  catalogItem: { select: { id: true, name: true, category: true, icon: true, formSchema: true } },
  requester: { select: { id: true, employeeId: true, name: true, email: true, department: { select: { id: true, name: true } } } },
  approval: {
    select: { id: true, status: true, currentStep: true, steps: true, decidedAt: true },
  },
} satisfies Prisma.ServiceRequestInclude;

/** List filter: `mine` (requester), `queue` (to-fulfill / open), all for staff. */
export async function listRequests(
  actor: AuthedUser,
  query: { status?: string; mine?: boolean; queue?: 'open' | 'fulfillment' },
) {
  const where: Prisma.ServiceRequestWhereInput = {};
  if (query.mine) {
    where.requesterId = actor.employeeId ?? { in: [] };
  } else if (!isStaff(actor) && !actor.roles.includes('approver')) {
    where.requesterId = actor.employeeId ?? { in: [] };
  }
  if (query.status) where.status = query.status as never;
  if (query.queue === 'open') where.status = { in: ['pending_approval', 'info_requested', 'in_fulfillment'] };
  if (query.queue === 'fulfillment') where.status = 'in_fulfillment';

  return prisma.serviceRequest.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: 100,
    include: {
      ...requestInclude,
      requester: { select: { id: true, employeeId: true, name: true, email: true } },
    },
  });
}

/** Requester, current-step approver, past decider, or staff may view; others get a 404. */
export async function getRequest(actor: AuthedUser, id: string) {
  const request = await prisma.serviceRequest.findUnique({
    where: { id },
    include: {
      ...requestInclude,
      approval: {
        select: {
          id: true,
          status: true,
          currentStep: true,
          steps: true,
          decidedAt: true,
          requestedById: true,
          delegations: true,
          decisions: { include: { approver: { select: { id: true, name: true, email: true } } } },
        },
      },
    },
  });
  if (!request) throw notFound('Service request not found');

  const approval = request.approval;
  const steps = (approval?.steps ?? []) as unknown as InstantiatedStep[];
  const currentStep = approval && approval.status === 'pending' ? steps[approval.currentStep] : undefined;
  const involved =
    request.requesterId === actor.employeeId ||
    isStaff(actor) ||
    (!!approval && approval.requestedById === actor.id) ||
    (!!approval && approval.decisions.some((d) => d.approverId === actor.id)) ||
    (!!currentStep &&
      (currentStep.candidates.includes(actor.id) ||
        (approval!.delegations as Record<string, { from: string; to: string }> | null)?.[String(approval!.currentStep)]?.to === actor.id));
  if (!involved) throw notFound('Service request not found');

  return request;
}
