import type { Role } from '@prisma/client';

import { recordAudit } from '../../core/audit.js';
import { badRequest, conflict, forbidden, notFound } from '../../core/errors.js';
import type { AuthedUser } from '../../core/request.js';
import { prisma } from '../../prisma/client.js';
import { createNotification } from '../notifications/notifications.service.js';

/**
 * The approval engine — one reusable engine for service requests (and, from
 * Phase 5 change management, changes). A rule's steps are instantiated onto
 * each request at submission (candidates resolved once, stored on the step);
 * decisions are append-only and the DB-unique (request, step, approver)
 * constraint makes duplicates impossible. `in_fulfillment` on the target is
 * reachable ONLY from an approved approval request — decided inside the same
 * transaction as the final decision.
 */

export interface ApproverSpec {
  type: 'user' | 'manager' | 'role';
  value?: string;
}

export interface InstantiatedStep {
  name: string;
  mode: 'single' | 'all' | 'any' | 'sequential';
  approver: ApproverSpec;
  deadlineHours?: number;
  /** Absolute deadline, derived from submission time. */
  deadlineAt?: string;
  /** Resolved user ids at instantiation time. */
  candidates: string[];
  /** True when no eligible approver could be resolved — the step is skipped. */
  skipped: boolean;
  skipNote?: string;
}

/** Roles that see (and may cancel/fulfill) everything regardless of ownership. */
export const STAFF_ROLES = ['super_admin', 'it_admin', 'it_manager'];

export function isStaff(user: AuthedUser): boolean {
  return user.roles.some((r) => (STAFF_ROLES as string[]).includes(r));
}

/* ── Step instantiation ────────────────────────────────────────────────────── */

/** Resolve an approver spec to concrete user ids. `manager` resolves through the requester's employee record. */
export async function resolveCandidates(spec: ApproverSpec, requesterEmployeeId: string | null): Promise<string[]> {
  if (spec.type === 'user') return spec.value ? [spec.value] : [];
  if (spec.type === 'manager') {
    if (!requesterEmployeeId) return [];
    const emp = await prisma.employee.findUnique({
      where: { id: requesterEmployeeId },
      select: { manager: { select: { userId: true } } },
    });
    return emp?.manager?.userId ? [emp.manager.userId] : [];
  }
  const rows = await prisma.userRole.findMany({
    where: { role: spec.value as Role, user: { active: true } },
    select: { userId: true },
  });
  return rows.map((r) => r.userId);
}

/**
 * Instantiate a rule's steps against a requester. Candidates are resolved
 * eagerly (auditable, and the decide-time check needs no re-resolution);
 * a step with no candidates is marked skipped so it can never wedge a chain.
 */
export async function instantiateSteps(
  ruleSteps: unknown,
  requesterEmployeeId: string | null,
  submittedAt: Date,
): Promise<InstantiatedStep[]> {
  const specs = ruleSteps as Array<Pick<InstantiatedStep, 'name' | 'mode' | 'approver' | 'deadlineHours'>>;
  const steps: InstantiatedStep[] = [];
  for (const spec of specs) {
    const candidates = await resolveCandidates(spec.approver, requesterEmployeeId);
    steps.push({
      name: spec.name,
      mode: spec.mode,
      approver: spec.approver,
      deadlineHours: spec.deadlineHours,
      deadlineAt: spec.deadlineHours
        ? new Date(submittedAt.getTime() + spec.deadlineHours * 3_600_000).toISOString()
        : undefined,
      candidates,
      skipped: candidates.length === 0,
      skipNote: candidates.length === 0 ? 'No eligible approver resolved — skipped' : undefined,
    });
  }
  return steps;
}

/** Index of the first step that actually needs decisions, or steps.length when all are skipped. */
export function firstOpenStep(steps: InstantiatedStep[]): number {
  const i = steps.findIndex((s) => !s.skipped);
  return i === -1 ? steps.length : i;
}

/** Next open step at or after `from`, or -1 when the chain is complete. */
function nextOpenIndex(steps: InstantiatedStep[], from: number): number {
  for (let i = from; i < steps.length; i++) {
    if (!steps[i].skipped) return i;
  }
  return -1;
}

/** delegation map accessor — jsonb `{ [stepIndex]: { from, to } }`. */
function delegateEntryFor(approval: { delegations: unknown }, stepIndex: number): { from: string; to: string } | undefined {
  const map = (approval.delegations ?? {}) as Record<string, { from: string; to: string }>;
  return map[String(stepIndex)];
}

/* ── Decisions ─────────────────────────────────────────────────────────────── */

export type DecisionValue = 'approved' | 'rejected' | 'info_requested';

export interface DecideInput {
  stepIndex: number;
  decision: DecisionValue;
  reason?: string;
}

/**
 * Is the step complete once this decision (and prior ones on the same step)
 * is taken? Rejections are handled before this — any rejection settles the
 * whole approval in every mode. A delegate's approval covers the delegating
 * candidate (`from`) in every mode.
 */
function stepComplete(
  step: InstantiatedStep,
  decisions: Array<{ approverId: string; decision: DecisionValue }>,
  delegation?: { from: string; to: string },
): boolean {
  const approved = new Set(decisions.filter((d) => d.decision === 'approved').map((d) => d.approverId));
  const covered = (c: string) => approved.has(c) || (!!delegation && delegation.from === c && approved.has(delegation.to));
  switch (step.mode) {
    case 'single':
    case 'any':
      return approved.size > 0;
    case 'all':
    case 'sequential':
      return step.candidates.every(covered);
  }
}

/**
 * Record a decision on a step. Runs the state machine inside one transaction:
 * the decision insert and the resulting settlement/advance are atomic, so a
 * request can never be in fulfillment with an unapproved approval.
 */
export async function decideApproval(actor: AuthedUser, approvalId: string, input: DecideInput) {
  const approval = await prisma.approvalRequest.findUnique({
    where: { id: approvalId },
    include: { decisions: true },
  });
  if (!approval) throw notFound('Approval request not found');
  if (approval.status !== 'pending') throw conflict('This approval has already been settled');
  if (input.stepIndex !== approval.currentStep) throw badRequest('That step is not open for decisions');
  // Separation of duties: whoever submitted can never be an approver.
  if (actor.id === approval.requestedById) throw forbidden('You cannot decide on your own request', 'SELF_APPROVAL');

  const steps = approval.steps as unknown as InstantiatedStep[];
  const step = steps[input.stepIndex];
  if (!step) throw badRequest('Unknown step');

  const entry = delegateEntryFor(approval, input.stepIndex);
  if (!step.candidates.includes(actor.id) && entry?.to !== actor.id) {
    throw forbidden('You are not an approver for this step');
  }

  // A prior TERMINAL decision blocks a second one; info_requested rows are
  // history — the approver decides again once the requester responds.
  const stepDecisions = approval.decisions.filter((d) => d.stepIndex === input.stepIndex);
  if (stepDecisions.some((d) => d.approverId === actor.id && d.decision !== 'info_requested')) {
    throw conflict('You have already decided on this step');
  }

  if (input.decision === 'rejected' && !input.reason) throw badRequest('A rejection needs a reason', 'REASON_REQUIRED');

  if (step.mode === 'sequential') {
    // A delegate decides at the delegating candidate's position in the chain.
    const myPos = step.candidates.indexOf(actor.id !== entry?.to ? actor.id : entry.from);
    const earlier = myPos === -1 ? step.candidates : step.candidates.slice(0, myPos);
    const approvedIds = new Set(stepDecisions.filter((d) => d.decision === 'approved').map((d) => d.approverId));
    if (!earlier.every((c) => approvedIds.has(c))) {
      throw badRequest('Earlier approvers in the sequence have not approved yet');
    }
  }

  const result = await prisma.$transaction(async (tx) => {
    await tx.approvalDecision.create({
      data: {
        requestId: approvalId,
        stepIndex: input.stepIndex,
        approverId: actor.id,
        decision: input.decision,
        reason: input.reason ?? null,
      },
    });

    const request = await tx.serviceRequest.findUnique({
      where: { id: approval.targetId },
      select: {
        id: true,
        number: true,
        status: true,
        catalogItem: { select: { name: true } },
        requester: { select: { userId: true, name: true } },
      },
    });

    if (input.decision === 'info_requested') {
      if (request && request.status === 'pending_approval') {
        await tx.serviceRequest.update({ where: { id: request.id }, data: { status: 'info_requested' } });
      }
      return { settled: false as const, request, nextStep: null };
    }

    if (input.decision === 'rejected') {
      await tx.approvalRequest.update({ where: { id: approvalId }, data: { status: 'rejected', decidedAt: new Date() } });
      if (request) {
        await tx.serviceRequest.update({
          where: { id: request.id },
          data: { status: 'rejected', rejectionReason: input.reason ?? `Rejected at step: ${step.name}` },
        });
      }
      return { settled: true as const, request, nextStep: null };
    }

    if (!stepComplete(step, [...stepDecisions, { approverId: actor.id, decision: input.decision }], entry)) {
      return { settled: false as const, request, nextStep: null };
    }

    const next = nextOpenIndex(steps, input.stepIndex + 1);
    if (next === -1) {
      // Last step approved — the fulfillment gate opens, atomically.
      await tx.approvalRequest.update({ where: { id: approvalId }, data: { status: 'approved', decidedAt: new Date() } });
      if (request) {
        await tx.serviceRequest.update({ where: { id: request.id }, data: { status: 'in_fulfillment' } });
      }
      return { settled: true as const, request, nextStep: null };
    }
    await tx.approvalRequest.update({ where: { id: approvalId }, data: { currentStep: next } });
    return { settled: false as const, request, nextStep: steps[next] };
  });

  // Notifications trail the transaction and never fail it.
  const requesterUserId = result.request?.requester.userId ?? null;
  const label = `${result.request?.catalogItem.name ?? 'request'} (${result.request?.number ?? ''})`.trim();
  try {
    if (input.decision === 'info_requested' && requesterUserId) {
      await createNotification({
        userId: requesterUserId,
        type: 'approval.info_requested',
        title: 'More information requested',
        body: `Additional information is needed on ${label}: ${input.reason ?? 'see the approval for details'}`,
        dedupeKey: `approval.info:${approvalId}:${input.stepIndex}`,
      });
    } else if (input.decision === 'rejected' && requesterUserId) {
      await createNotification({
        userId: requesterUserId,
        type: 'approval.rejected',
        title: 'Request rejected',
        body: `${label} was rejected: ${input.reason ?? 'no reason given'}`,
        dedupeKey: `approval.rejected:${approvalId}:${input.stepIndex}`,
      });
    } else if (result.settled && requesterUserId) {
      await createNotification({
        userId: requesterUserId,
        type: 'approval.approved',
        title: 'Request approved',
        body: `${label} was approved and is now in fulfillment.`,
        dedupeKey: `approval.approved:${approvalId}:${input.stepIndex}`,
      });
    } else if (result.nextStep) {
      const nextIndex = steps.indexOf(result.nextStep);
      const nextEntry = delegateEntryFor(approval, nextIndex);
      const targets = new Set([...result.nextStep.candidates, nextEntry?.to].filter(Boolean) as string[]);
      for (const userId of targets) {
        await createNotification({
          userId,
          type: 'approval.requested',
          title: 'Approval requested',
          body: `Step "${result.nextStep.name}" of ${label} is waiting for your decision.`,
          dedupeKey: `approval.requested:${approvalId}:${nextIndex}:${userId}`,
        });
      }
    }
  } catch {
    // notification failures are logged inside createNotification; nothing else to do
  }

  await recordAudit({
    actorId: actor.id,
    actorEmail: actor.email,
    action: 'approval.decided',
    targetType: 'approval_request',
    targetId: approvalId,
    after: { stepIndex: input.stepIndex, decision: input.decision, reason: input.reason ?? null, request: result.request?.number ?? null },
  });

  return result;
}

/* ── Delegation ────────────────────────────────────────────────────────────── */

/** A current-step candidate may add a delegate who decides in their place. */
export async function delegateStep(actor: AuthedUser, approvalId: string, stepIndex: number, delegateUserId: string) {
  const approval = await prisma.approvalRequest.findUnique({ where: { id: approvalId } });
  if (!approval) throw notFound('Approval request not found');
  if (approval.status !== 'pending') throw conflict('This approval has already been settled');
  if (stepIndex !== approval.currentStep) throw badRequest('That step is not open for decisions');

  const steps = approval.steps as unknown as InstantiatedStep[];
  const step = steps[stepIndex];
  if (!step) throw badRequest('Unknown step');
  if (!step.candidates.includes(actor.id)) throw forbidden('Only a current approver for this step may delegate');
  if (delegateUserId === actor.id) throw badRequest('You cannot delegate to yourself', 'SELF_DELEGATION');
  if (delegateUserId === approval.requestedById) throw forbidden('The requester cannot be delegated to', 'SOD_DELEGATION');

  const delegate = await prisma.user.findUnique({ where: { id: delegateUserId }, select: { id: true, name: true, active: true } });
  if (!delegate || !delegate.active) throw badRequest('Delegate user not found or inactive');

  const map = (approval.delegations ?? {}) as Record<string, { from: string; to: string }>;
  map[String(stepIndex)] = { from: actor.id, to: delegateUserId };

  const updated = await prisma.approvalRequest.update({ where: { id: approvalId }, data: { delegations: map as never } });

  await createNotification({
    userId: delegateUserId,
    type: 'approval.delegated',
    title: 'Approval delegated to you',
    body: `Step "${step.name}" of an approval was delegated to you by ${actor.email}.`,
    dedupeKey: `approval.delegated:${approvalId}:${stepIndex}:${delegateUserId}`,
  }).catch(() => undefined);

  await recordAudit({
    actorId: actor.id,
    actorEmail: actor.email,
    action: 'approval.delegated',
    targetType: 'approval_request',
    targetId: approvalId,
    after: { stepIndex, delegateUserId },
  });

  return updated;
}

/* ── Queues & detail ───────────────────────────────────────────────────────── */

const approvalInclude = {
  decisions: {
    include: { approver: { select: { id: true, name: true, email: true } } },
    orderBy: { createdAt: 'asc' as const },
  },
  requestedBy: { select: { id: true, name: true, email: true } },
  serviceRequests: {
    select: {
      id: true,
      number: true,
      status: true,
      answers: true,
      infoRequests: true,
      rejectionReason: true,
      catalogItem: { select: { id: true, name: true, category: true } },
      requester: { select: { id: true, name: true, email: true, employeeId: true } },
    },
  },
} as const;

export async function myApprovalQueue(userId: string) {
  const pendings = await prisma.approvalRequest.findMany({
    where: { status: 'pending' },
    orderBy: { createdAt: 'asc' },
    take: 200,
    include: approvalInclude,
  });
  const mine = [];
  for (const a of pendings) {
    const steps = a.steps as unknown as InstantiatedStep[];
    const step = steps[a.currentStep];
    if (!step) continue;
    if (!step.candidates.includes(userId) && delegateEntryFor(a, a.currentStep)?.to !== userId) continue;
    mine.push({
      id: a.id,
      stepIndex: a.currentStep,
      stepName: step.name,
      mode: step.mode,
      deadlineAt: step.deadlineAt ?? null,
      createdAt: a.createdAt,
      target: a.serviceRequests[0] ?? null,
    });
  }
  return mine;
}

/** Candidate, requester, previous decider, or staff may see an approval; everyone else gets a 404. */
export async function approvalDetail(actor: AuthedUser, id: string) {
  const approval = await prisma.approvalRequest.findUnique({
    where: { id },
    include: approvalInclude,
  });
  if (!approval) throw notFound('Approval request not found');

  const steps = approval.steps as unknown as InstantiatedStep[];
  const current = steps[approval.currentStep];
  const involved =
    approval.requestedById === actor.id ||
    approval.decisions.some((d) => d.approverId === actor.id) ||
    isStaff(actor) ||
    (approval.status === 'pending' &&
      !!current &&
      (current.candidates.includes(actor.id) || delegateEntryFor(approval, approval.currentStep)?.to === actor.id));
  if (!involved) throw notFound('Approval request not found');

  return {
    id: approval.id,
    targetType: approval.targetType,
    status: approval.status,
    steps,
    currentStep: approval.currentStep,
    delegations: approval.delegations ?? {},
    decidedAt: approval.decidedAt,
    createdAt: approval.createdAt,
    requestedBy: approval.requestedBy,
    decisions: approval.decisions,
    target: approval.serviceRequests[0] ?? null,
  };
}

/* ── Deadline sweep ────────────────────────────────────────────────────────── */

/**
 * Reminder sweep for overdue steps. Idempotent: notification dedupeKeys
 * (`approval.overdue:{requestId}:{stepIndex}:{userId}`) make reruns harmless.
 */
export async function runApprovalSweep(): Promise<{ checked: number; reminded: number }> {
  const pendings = await prisma.approvalRequest.findMany({ where: { status: 'pending' }, take: 500 });
  const now = Date.now();
  let reminded = 0;
  for (const a of pendings) {
    const steps = a.steps as unknown as InstantiatedStep[];
    const step = steps[a.currentStep];
    if (!step?.deadlineAt) continue;
    if (Date.parse(step.deadlineAt) >= now) continue;
    const targets = new Set(
      [...step.candidates, delegateEntryFor(a, a.currentStep)?.to].filter(Boolean) as string[],
    );
    for (const userId of targets) {
      await createNotification({
        userId,
        type: 'approval.overdue',
        title: 'Approval overdue',
        body: `Step "${step.name}" passed its deadline and is still waiting for a decision.`,
        dedupeKey: `approval.overdue:${a.id}:${a.currentStep}:${userId}`,
      });
      reminded++;
    }
  }
  return { checked: pendings.length, reminded };
}
