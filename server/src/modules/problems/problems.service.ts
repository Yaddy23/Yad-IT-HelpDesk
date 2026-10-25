import type { Prisma, ProblemStatus, ProblemPriority, RCAType } from '@prisma/client';

import { recordAudit } from '../../core/audit.js';
import { badRequest, forbidden, notFound, conflict } from '../../core/errors.js';
import type { AuthedUser } from '../../core/request.js';
import { prisma } from '../../prisma/client.js';
import { generateProblemNumber } from './numberGenerator.js';
import { PROBLEM_STATUS_TRANSITIONS } from './config.js';

const problemDetailInclude = {
  owner: { select: { id: true, name: true, email: true } },
  incidents: {
    include: {
      incident: {
        select: { id: true, number: true, title: true, status: true, category: true },
      },
      linkedBy: { select: { id: true, name: true } },
    },
    orderBy: { linkedAt: 'desc' },
  },
  rca: true,
  auditLogs: {
    orderBy: { createdAt: 'desc' },
    include: { actor: { select: { id: true, name: true, email: true } } },
    take: 50,
  },
} as const satisfies Prisma.ProblemInclude;

type ProblemDetail = Prisma.ProblemGetPayload<{ include: typeof problemDetailInclude }>;

interface ProblemSummary {
  id: string;
  number: string;
  title: string;
  description: string;
  status: ProblemStatus;
  priority: ProblemPriority;
  rcaType: RCAType;
  ownerId: string;
  owner: { id: string; name: string; email: string };
  affectedServices: string[];
  affectedAssets: string[];
  affectedCIs: string[];
  businessImpact: string;
  identifiedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const problemSummarySelect = {
  id: true,
  number: true,
  title: true,
  description: true,
  status: true,
  priority: true,
  rcaType: true,
  ownerId: true,
  owner: { select: { id: true, name: true, email: true } },
  affectedServices: true,
  affectedAssets: true,
  affectedCIs: true,
  businessImpact: true,
  identifiedAt: true,
  createdAt: true,
  updatedAt: true,
} as const satisfies Prisma.ProblemSelect;

/** Roles that see every problem; everyone else is scoped to their own. */
const MANAGER_ROLES = ['it_manager', 'it_admin', 'super_admin'];

/**
 * Manager/admin detection is by ROLE, not by permission: `problems:update` is
 * granted to it_technician too (spec Section 8 grants it to the record owner),
 * so testing that permission would silently disable all scoping.
 */
export function isManagerRole(user: AuthedUser): boolean {
  return user.roles.some((role) => MANAGER_ROLES.includes(role));
}

/**
 * Record-level scoping (spec Section 8): managers/admins see all problems,
 * everyone else only the ones they own.
 *
 * The spec also allows access via incidents the technician can reach. That
 * needs a User→Employee resolution on every check, so it is deferred (SDD
 * ledger) rather than paid for on each read.
 */
function assertProblemAccess(user: AuthedUser, problem: { ownerId: string }): void {
  if (isManagerRole(user) || problem.ownerId === user.id) return;
  throw forbidden('Not authorized to access this problem');
}

/**
 * Prisma's `InputJsonValue` excludes a top-level null, but audit payloads hold
 * nullable columns (fiveWhys, fishbone, rootCause). Widen to the JSON input
 * type; the values themselves are already JSON-safe.
 */
function json(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

export class ProblemsService {
  /**
   * List problems with pagination, filtering, and search.
   */
  async list(user: AuthedUser, query: {
    page: number;
    limit: number;
    sort: string;
    order: 'asc' | 'desc';
    search?: string;
    status?: string[];
    priority?: string[];
    ownerId?: string;
    affectedService?: string;
    identifiedAfter?: string;
    identifiedBefore?: string;
  }): Promise<{ problems: ProblemSummary[]; total: number; page: number; pages: number }> {
    const { page, limit, sort, order, search, status, priority, ownerId, affectedService, identifiedAfter, identifiedBefore } = query;

    // Build where clause with RBAC. `AND` is typed as object-or-array by
    // Prisma, so accumulate into a plain array and hand that to the query.
    const and: Prisma.ProblemWhereInput[] = [];
    const where: Prisma.ProblemWhereInput = {
      deletedAt: null,
      AND: and,
    };

    // Scope: Technicians see problems they own. Managers/Admins see all.
    if (!isManagerRole(user)) {
      and.push({ ownerId: user.id });
    }

    if (ownerId) {
      and.push({ ownerId });
    }

    if (status?.length) {
      and.push({ status: { in: status as ProblemStatus[] } });
    }

    if (priority?.length) {
      and.push({ priority: { in: priority as ProblemPriority[] } });
    }

    if (affectedService) {
      and.push({ affectedServices: { has: affectedService } });
    }

    if (identifiedAfter) {
      and.push({ identifiedAt: { gte: new Date(identifiedAfter) } });
    }

    if (identifiedBefore) {
      and.push({ identifiedAt: { lte: new Date(identifiedBefore) } });
    }

    if (search?.trim()) {
      const escaped = search.trim();
      and.push({
        OR: [
          { title: { contains: escaped, mode: 'insensitive' } },
          { description: { contains: escaped, mode: 'insensitive' } },
          { rootCause: { contains: escaped, mode: 'insensitive' } },
          { workaround: { contains: escaped, mode: 'insensitive' } },
        ],
      });
    }

    const orderBy: Prisma.ProblemOrderByWithRelationInput = { [sort]: order };

    const [problems, total] = await Promise.all([
      prisma.problem.findMany({
        where,
        select: problemSummarySelect,
        orderBy,
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.problem.count({ where }),
    ]);

    return {
      problems,
      total,
      page,
      pages: Math.max(1, Math.ceil(total / limit)),
    };
  }

  /**
   * Get a single problem by ID with full detail.
   */
  async get(user: AuthedUser, id: string): Promise<ProblemDetail> {
    const problem = await prisma.problem.findFirst({
      where: { id, deletedAt: null },
      include: problemDetailInclude,
    });

    if (!problem) throw notFound('Problem not found');
    assertProblemAccess(user, problem);

    return problem;
  }

  /**
   * Create a new problem with PRB number and identifiedAt timestamp.
   * Requires problems:create permission.
   */
  async create(
    user: AuthedUser,
    input: {
      title: string;
      description: string;
      ownerId: string;
      priority?: ProblemPriority;
      affectedServices?: string[];
      affectedAssets?: string[];
      affectedCIs?: string[];
      businessImpact?: string;
      rcaType?: RCAType;
    }
  ): Promise<ProblemDetail> {
    // Validate owner exists
    const owner = await prisma.user.findUnique({ where: { id: input.ownerId } });
    if (!owner) throw notFound('Owner not found');

    const { problem, number } = await prisma.$transaction(async (tx) => {
      const number = await generateProblemNumber(tx);
      const problem = await tx.problem.create({
        data: {
          number,
          title: input.title,
          description: input.description,
          ownerId: input.ownerId,
          priority: input.priority ?? 'MEDIUM',
          affectedServices: input.affectedServices ?? [],
          affectedAssets: input.affectedAssets ?? [],
          affectedCIs: input.affectedCIs ?? [],
          businessImpact: input.businessImpact ?? '',
          rcaType: input.rcaType ?? 'NONE',
          status: 'IDENTIFIED',
          identifiedAt: new Date(),
        },
        include: problemDetailInclude,
      });
      return { problem, number };
    });

    await recordAudit({
      actorId: user.id,
      actorEmail: user.email,
      action: 'problem.created',
      targetType: 'problem',
      targetId: problem.id,
      meta: { number, priority: problem.priority },
    });

    // Fire-and-forget live update to the problem owner.
    try {
      const { emitToUser } = await import('../../core/socket.js');
      emitToUser(problem.ownerId, 'problem:created', {
        problemId: problem.id,
        number: problem.number,
        title: problem.title,
      });
    } catch {
      // Socket.IO may not be available in tests
    }

    return problem;
  }

  /**
   * Update problem fields (title, description, priority, owner, etc.)
   * Requires problems:update permission.
   */
  async update(
    user: AuthedUser,
    id: string,
    input: {
      title?: string;
      description?: string;
      priority?: ProblemPriority;
      ownerId?: string;
      affectedServices?: string[];
      affectedAssets?: string[];
      affectedCIs?: string[];
      businessImpact?: string;
      rcaType?: RCAType;
    }
  ): Promise<ProblemDetail> {
    const problem = await prisma.problem.findUnique({ where: { id } });
    if (!problem) throw notFound('Problem not found');
    assertProblemAccess(user, problem);

    const oldValues = {
      title: problem.title,
      description: problem.description,
      priority: problem.priority,
      ownerId: problem.ownerId,
      affectedServices: problem.affectedServices,
      affectedAssets: problem.affectedAssets,
      affectedCIs: problem.affectedCIs,
      businessImpact: problem.businessImpact,
      rcaType: problem.rcaType,
    };

    if (input.ownerId) {
      const owner = await prisma.user.findUnique({ where: { id: input.ownerId } });
      if (!owner) throw notFound('New owner not found');
    }

    const updated = await prisma.problem.update({
      where: { id },
      data: {
        title: input.title ?? problem.title,
        description: input.description ?? problem.description,
        priority: input.priority ?? problem.priority,
        ownerId: input.ownerId ?? problem.ownerId,
        affectedServices: input.affectedServices ?? problem.affectedServices,
        affectedAssets: input.affectedAssets ?? problem.affectedAssets,
        affectedCIs: input.affectedCIs ?? problem.affectedCIs,
        businessImpact: input.businessImpact ?? problem.businessImpact,
        rcaType: input.rcaType ?? problem.rcaType,
      },
      include: problemDetailInclude,
    });

    await recordAudit({
      actorId: user.id,
      actorEmail: user.email,
      action: 'problem.updated',
      targetType: 'problem',
      targetId: id,
      before: oldValues,
      after: {
        title: updated.title,
        description: updated.description,
        priority: updated.priority,
        ownerId: updated.ownerId,
        affectedServices: updated.affectedServices,
        affectedAssets: updated.affectedAssets,
        affectedCIs: updated.affectedCIs,
        businessImpact: updated.businessImpact,
        rcaType: updated.rcaType,
      },
    });

    try {
      const { emitToUser } = await import('../../core/socket.js');
      emitToUser(updated.ownerId, 'problem:updated', { problemId: id, changes: input });
    } catch { }

    return updated;
  }

  /**
   * Transition problem status with validation rules from spec Section 7.
   * Requires problems:transition permission.
   */
  async transitionStatus(
    user: AuthedUser,
    id: string,
    status: ProblemStatus,
    extra?: {
      verifiedFix?: boolean;
      resolutionSummary?: string;
      exceptionReason?: string;
    }
  ): Promise<ProblemDetail> {
    const problem = await prisma.problem.findUnique({ where: { id } });
    if (!problem) throw notFound('Problem not found');
    assertProblemAccess(user, problem);

    // CLOSED is terminal — checked before the generic transition table so the
    // caller gets the specific reason rather than "cannot move X to Y".
    if (problem.status === 'CLOSED') {
      throw conflict('Cannot transition from CLOSED');
    }

    // Check if transition is allowed
    const allowed = PROBLEM_STATUS_TRANSITIONS[problem.status];
    if (!allowed?.includes(status)) {
      throw conflict(`Cannot move a ${problem.status} problem to ${status}`);
    }

    // Validation rules per spec Section 7
    const now = new Date();
    const updateData: Prisma.ProblemUpdateInput = { status };

    switch (status) {
      case 'INVESTIGATION':
        updateData.investigationStartedAt = now;
        break;
      case 'ROOT_CAUSE_KNOWN':
        if (!problem.rootCause || !problem.confirmedRootCause) {
          throw badRequest('Root cause must be documented and confirmed', 'ROOT_CAUSE_REQUIRED');
        }
        updateData.rootCauseIdentifiedAt = now;
        break;
      case 'WORKAROUND_DOCUMENTED':
        if (!problem.workaround) {
          throw badRequest('Workaround must be documented', 'WORKAROUND_REQUIRED');
        }
        updateData.workaroundDocumentedAt = now;
        break;
      case 'PENDING_CHANGE':
        if (!problem.changeRequestIds || problem.changeRequestIds.length === 0) {
          throw badRequest('At least one change request must be linked', 'CHANGE_REQUEST_REQUIRED');
        }
        updateData.changeInitiatedAt = now;
        break;
      case 'RESOLVED': {
        const verifiedFix = extra?.verifiedFix ?? false;
        const resolutionSummary = extra?.resolutionSummary;
        const exceptionReason = extra?.exceptionReason;

        if (!resolutionSummary || (!verifiedFix && !exceptionReason)) {
          throw badRequest('Resolution summary and verified fix or exception reason required', 'RESOLUTION_REQUIRED');
        }

        // Resolving without a verified fix needs a manager to sign off.
        if (!verifiedFix && exceptionReason && !isManagerRole(user)) {
          throw forbidden('Exception resolution requires manager role', 'MANAGER_REQUIRED');
        }

        updateData.resolvedAt = now;
        updateData.resolutionSummary = resolutionSummary;
        break;
      }
      case 'CLOSED':
        updateData.closedAt = now;
        break;
    }

    try {
      const updated = await prisma.$transaction(async (tx) => {
        const updatedProblem = await tx.problem.update({
          where: { id },
          data: updateData,
          include: problemDetailInclude,
        });

        // Create audit log entry
        await tx.problemAuditLog.create({
          data: {
            problemId: id,
            action: 'STATUS_CHANGED',
            oldValue: { status: problem.status },
            newValue: { status, ...extra },
            actorId: user.id,
          },
        });

        return updatedProblem;
      });

      await recordAudit({
        actorId: user.id,
        actorEmail: user.email,
        action: `problem.${status.toLowerCase()}`,
        targetType: 'problem',
        targetId: id,
        meta: { number: problem.number, from: problem.status, to: status, ...extra },
      });

      try {
        const { emitToUser } = await import('../../core/socket.js');
        emitToUser(updated.ownerId, 'problem:status_changed', {
          problemId: id,
          oldStatus: problem.status,
          newStatus: status,
        });
      } catch { }

      return updated;
    } catch (err: any) {
      if (err.code === 'P2025' || err.code === 'P2016') {
        throw conflict('Problem was modified by someone else — reload and retry', 'STALE_VERSION');
      }
      throw err;
    }
  }

  /**
   * Link incidents to a problem.
   * Requires problems:link_incidents permission.
   */
  async linkIncidents(
    user: AuthedUser,
    id: string,
    incidentIds: string[],
    note?: string
  ): Promise<void> {
    const problem = await prisma.problem.findUnique({ where: { id } });
    if (!problem) throw notFound('Problem not found');
    assertProblemAccess(user, problem);

    // Verify all incidents exist
    const incidents = await prisma.ticket.findMany({
      where: { id: { in: incidentIds } },
      select: { id: true, number: true },
    });
    if (incidents.length !== incidentIds.length) {
      throw notFound('One or more incidents not found');
    }

    await prisma.$transaction(async (tx) => {
      for (const incidentId of incidentIds) {
        await tx.problemIncident.create({
          data: {
            problemId: id,
            incidentId,
            linkedById: user.id,
            note,
          },
        }).catch((err: any) => {
          if (err.code === 'P2002') {
            // Already linked, skip
            return;
          }
          throw err;
        });
      }

      await tx.problemAuditLog.create({
        data: {
          problemId: id,
          action: 'INCIDENT_LINKED',
          newValue: { incidentIds, note },
          actorId: user.id,
        },
      });

      // Linking is an answer: any live suggestion proposing these incidents
      // for this problem has been acted on. Leaving it pending would ask the
      // reviewer twice (the same bookkeeping `createProblemFromIncidents`
      // does when it accepts a suggestion).
      await tx.detectionSuggestion.updateMany({
        where: { status: 'PENDING', problemId: id, incidentIds: { hasSome: incidentIds } },
        data: { status: 'ACCEPTED', reviewedById: user.id, reviewedAt: new Date() },
      });
    });

    await recordAudit({
      actorId: user.id,
      actorEmail: user.email,
      action: 'problem.incidents_linked',
      targetType: 'problem',
      targetId: id,
      meta: { number: problem.number, incidentIds },
    });

    try {
      const { emitToUser } = await import('../../core/socket.js');
      for (const incidentId of incidentIds) {
        const inc = incidents.find(i => i.id === incidentId);
        emitToUser(problem.ownerId, 'problem:incident_linked', {
          problemId: id,
          incidentId,
          incidentNumber: inc?.number,
        });
      }
    } catch { }
  }

  /**
   * Unlink an incident from a problem.
   */
  async unlinkIncident(
    user: AuthedUser,
    id: string,
    incidentId: string
  ): Promise<void> {
    const problem = await prisma.problem.findUnique({ where: { id } });
    if (!problem) throw notFound('Problem not found');
    assertProblemAccess(user, problem);

    await prisma.$transaction(async (tx) => {
      const deleted = await tx.problemIncident.deleteMany({
        where: { problemId: id, incidentId },
      });

      if (deleted.count === 0) {
        throw notFound('Incident link not found');
      }

      await tx.problemAuditLog.create({
        data: {
          problemId: id,
          action: 'INCIDENT_UNLINKED',
          oldValue: { incidentId },
          actorId: user.id,
        },
      });
    });

    await recordAudit({
      actorId: user.id,
      actorEmail: user.email,
      action: 'problem.incident_unlinked',
      targetType: 'problem',
      targetId: id,
      meta: { number: problem.number, incidentId },
    });
  }

  /**
   * Update RCA information.
   * Requires problems:manage_rca permission.
   */
  async updateRCA(
    user: AuthedUser,
    id: string,
    input: {
      rootCause?: string;
      resolutionSummary?: string;
      rcaNotes?: string;
      fiveWhys?: unknown;
      fishbone?: unknown;
      confirmedRootCause?: boolean;
      rcaType?: RCAType;
    }
  ): Promise<ProblemDetail> {
    const problem = await prisma.problem.findUnique({ where: { id } });
    if (!problem) throw notFound('Problem not found');
    assertProblemAccess(user, problem);

    const oldValues = {
      rootCause: problem.rootCause,
      resolutionSummary: problem.resolutionSummary,
      rcaNotes: problem.rcaNotes,
      fiveWhys: problem.fiveWhys,
      fishbone: problem.fishbone,
      confirmedRootCause: problem.confirmedRootCause,
      rcaType: problem.rcaType,
    };

    const updated = await prisma.$transaction(async (tx) => {
      const updatedProblem = await tx.problem.update({
        where: { id },
        data: {
          rootCause: input.rootCause ?? problem.rootCause,
          resolutionSummary: input.resolutionSummary ?? problem.resolutionSummary,
          rcaNotes: input.rcaNotes ?? problem.rcaNotes,
          fiveWhys: json(input.fiveWhys ?? problem.fiveWhys),
          fishbone: json(input.fishbone ?? problem.fishbone),
          confirmedRootCause: input.confirmedRootCause ?? problem.confirmedRootCause,
          rcaType: input.rcaType ?? problem.rcaType,
        },
        include: problemDetailInclude,
      });

      await tx.problemAuditLog.create({
        data: {
          problemId: id,
          action: 'RCA_UPDATED',
          oldValue: json(oldValues),
          newValue: json({
            rootCause: updatedProblem.rootCause,
            resolutionSummary: updatedProblem.resolutionSummary,
            rcaNotes: updatedProblem.rcaNotes,
            fiveWhys: updatedProblem.fiveWhys,
            fishbone: updatedProblem.fishbone,
            confirmedRootCause: updatedProblem.confirmedRootCause,
            rcaType: updatedProblem.rcaType,
          }),
          actorId: user.id,
        },
      });

      return updatedProblem;
    });

    await recordAudit({
      actorId: user.id,
      actorEmail: user.email,
      action: 'problem.rca_updated',
      targetType: 'problem',
      targetId: id,
      before: oldValues,
      after: {
        rootCause: updated.rootCause,
        resolutionSummary: updated.resolutionSummary,
        rcaNotes: updated.rcaNotes,
        fiveWhys: updated.fiveWhys,
        fishbone: updated.fishbone,
        confirmedRootCause: updated.confirmedRootCause,
        rcaType: updated.rcaType,
      },
    });

    return updated;
  }

  /**
   * Set workaround on a problem.
   * Requires problems:manage_rca permission.
   */
  async setWorkaround(
    user: AuthedUser,
    id: string,
    workaround: string
  ): Promise<ProblemDetail> {
    const problem = await prisma.problem.findUnique({ where: { id } });
    if (!problem) throw notFound('Problem not found');
    assertProblemAccess(user, problem);

    const updated = await prisma.$transaction(async (tx) => {
      const updatedProblem = await tx.problem.update({
        where: { id },
        data: { workaround },
        include: problemDetailInclude,
      });

      await tx.problemAuditLog.create({
        data: {
          problemId: id,
          action: 'WORKAROUND_SET',
          oldValue: { workaround: problem.workaround },
          newValue: { workaround },
          actorId: user.id,
        },
      });

      return updatedProblem;
    });

    await recordAudit({
      actorId: user.id,
      actorEmail: user.email,
      action: 'problem.workaround_set',
      targetType: 'problem',
      targetId: id,
      before: { workaround: problem.workaround },
      after: { workaround },
    });

    return updated;
  }

  /**
   * Link a change request to a problem.
   */
  async linkChangeRequest(
    user: AuthedUser,
    id: string,
    changeId: string
  ): Promise<ProblemDetail> {
    // include: the early "already linked" return hands the same shape back as
    // the update path, so the declared ProblemDetail return type holds.
    const problem = await prisma.problem.findUnique({ where: { id }, include: problemDetailInclude });
    if (!problem) throw notFound('Problem not found');
    assertProblemAccess(user, problem);

    if (problem.changeRequestIds.includes(changeId)) {
      return problem; // Already linked
    }

    const updated = await prisma.$transaction(async (tx) => {
      const updatedProblem = await tx.problem.update({
        where: { id },
        data: { changeRequestIds: { push: changeId } },
        include: problemDetailInclude,
      });

      await tx.problemAuditLog.create({
        data: {
          problemId: id,
          action: 'CHANGE_LINKED',
          newValue: { changeId },
          actorId: user.id,
        },
      });

      return updatedProblem;
    });

    await recordAudit({
      actorId: user.id,
      actorEmail: user.email,
      action: 'problem.change_linked',
      targetType: 'problem',
      targetId: id,
      meta: { number: problem.number, changeId },
    });

    return updated;
  }

  /**
   * Unlink a change request from a problem.
   */
  async unlinkChangeRequest(
    user: AuthedUser,
    id: string,
    changeId: string
  ): Promise<ProblemDetail> {
    // include: same shape on the early "not linked" return as the update path.
    const problem = await prisma.problem.findUnique({ where: { id }, include: problemDetailInclude });
    if (!problem) throw notFound('Problem not found');
    assertProblemAccess(user, problem);

    if (!problem.changeRequestIds.includes(changeId)) {
      return problem; // Not linked
    }

    const updated = await prisma.$transaction(async (tx) => {
      const updatedProblem = await tx.problem.update({
        where: { id },
        data: { changeRequestIds: problem.changeRequestIds.filter((c) => c !== changeId) },
        include: problemDetailInclude,
      });

      await tx.problemAuditLog.create({
        data: {
          problemId: id,
          action: 'CHANGE_UNLINKED',
          oldValue: { changeId },
          actorId: user.id,
        },
      });

      return updatedProblem;
    });

    await recordAudit({
      actorId: user.id,
      actorEmail: user.email,
      action: 'problem.change_unlinked',
      targetType: 'problem',
      targetId: id,
      meta: { number: problem.number, changeId },
    });

    return updated;
  }

  /**
   * Get audit log for a problem, paged. Returns the entries plus the
   * pagination meta so clients can render Next/Previous without guessing
   * from the row count (a full last page would otherwise show a Next that
   * leads to an empty page).
   */
  async getAuditLog(
    user: AuthedUser,
    id: string,
    query: { page: number; limit: number }
  ): Promise<{
    data: Prisma.ProblemAuditLogGetPayload<{ include: { actor: { select: { id: true; name: true; email: true } } } }>[];
    meta: { page: number; limit: number; total: number; pages: number };
  }> {
    const problem = await prisma.problem.findUnique({ where: { id } });
    if (!problem) throw notFound('Problem not found');
    assertProblemAccess(user, problem);

    const { page, limit } = query;
    const [total, data] = await Promise.all([
      prisma.problemAuditLog.count({ where: { problemId: id } }),
      prisma.problemAuditLog.findMany({
        where: { problemId: id },
        include: { actor: { select: { id: true, name: true, email: true } } },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);
    return { data, meta: { page, limit, total, pages: Math.ceil(total / limit) || 1 } };
  }

  /**
   * Aggregated dashboard data (spec Phase 5): recurring trends, major causes
   * (Pareto), problem aging, overdue investigations, status distribution,
   * known-error usage, fix effectiveness. Same RBAC scope as list —
   * managers see the whole estate, technicians their own problems.
   */
  async getDashboard(user: AuthedUser, days: number): Promise<{
    trends: { date: string; problems: number }[];
    topCauses: { name: string; count: number }[];
    aging: { bucket: string; count: number }[];
    overdue: number;
    open: number;
    statusDistribution: { status: string; count: number }[];
    knownErrors: { byStatus: { status: string; count: number }[]; problemsWithKnownError: number };
    fixEffectiveness: { resolved: number; verifiedFix: number; exception: number };
  }> {
    const scope: Prisma.ProblemWhereInput[] = [{ deletedAt: null }];
    if (!isManagerRole(user)) scope.push({ ownerId: user.id });

    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const now = new Date();

    const [
      recent,
      all,
      overdueCount,
      openCount,
      statusRows,
      keByStatus,
      keLinkedCount,
      resolveAudits,
    ] = await Promise.all([
      // Trend series: problems identified per day in the window. groupBy can't
      // bucket by date, so tally minimal rows in JS.
      prisma.problem.findMany({
        where: { AND: scope, identifiedAt: { gte: since } },
        select: { identifiedAt: true },
      }).then((identified) => {
        const perDay = new Map<string, number>();
        for (let i = days - 1; i >= 0; i -= 1) {
          const d = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
          perDay.set(d.toISOString().slice(0, 10), 0);
        }
        for (const p of identified) {
          const key = p.identifiedAt.toISOString().slice(0, 10);
          if (perDay.has(key)) perDay.set(key, (perDay.get(key) ?? 0) + 1);
        }
        return [...perDay.entries()].map(([date, problems]) => ({ date, problems }));
      }),
      // Aging + Pareto need every open problem's dates and linked categories.
      prisma.problem.findMany({
        where: { AND: scope, status: { notIn: ['RESOLVED', 'CLOSED'] as ProblemStatus[] } },
        select: {
          identifiedAt: true,
          incidents: { select: { incident: { select: { category: true } } } },
        },
      }),
      prisma.problem.count({ where: { AND: scope, reviewDueAt: { lt: now } } }),
      prisma.problem.count({
        where: { AND: scope, status: { notIn: ['RESOLVED', 'CLOSED'] as ProblemStatus[] } },
      }),
      prisma.problem.groupBy({ by: ['status'], where: { AND: scope }, _count: { _all: true } }),
      prisma.knownError.groupBy({ by: ['status'], _count: { _all: true } }),
      prisma.problem.count({
        where: { AND: scope, knownError: { isNot: null } },
      }),
      // Fix effectiveness: latest RESOLVED transition per problem, from the
      // audit trail (verifiedFix is recorded there, not as a column).
      prisma.problemAuditLog.findMany({
        where: { action: 'STATUS_CHANGED', problem: { is: { AND: scope } } },
        select: { problemId: true, newValue: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    const topCauses = (() => {
      const tally = new Map<string, number>();
      for (const problem of all) {
        for (const link of problem.incidents) {
          const category = link.incident.category?.trim();
          if (category) tally.set(category, (tally.get(category) ?? 0) + 1);
        }
      }
      const sorted = [...tally.entries()].sort((a, b) => b[1] - a[1]);
      const top = sorted.slice(0, 8).map(([name, count]) => ({ name, count }));
      const rest = sorted.slice(8).reduce((sum, [, count]) => sum + count, 0);
      return rest > 0 ? [...top, { name: 'Other', count: rest }] : top;
    })();

    const aging = (() => {
      const buckets = [
        { bucket: '< 7 days', min: 0, max: 7 },
        { bucket: '7–30 days', min: 7, max: 30 },
        { bucket: '30–90 days', min: 30, max: 90 },
        { bucket: '90+ days', min: 90, max: Infinity },
      ].map((b) => ({ bucket: b.bucket, count: 0, min: b.min, max: b.max }));
      for (const problem of all) {
        const ageDays = (now.getTime() - problem.identifiedAt.getTime()) / (24 * 60 * 60 * 1000);
        const hit = buckets.find((b) => ageDays >= b.min && ageDays < b.max);
        if (hit) hit.count += 1;
      }
      return buckets.map(({ bucket, count }) => ({ bucket, count }));
    })();

    const resolvedTransitions = new Map<string, { verifiedFix?: boolean; exceptionReason?: string }>();
    for (const log of resolveAudits) {
      const value = log.newValue as { status?: string; verifiedFix?: boolean; exceptionReason?: string };
      if (value?.status === 'RESOLVED' && !resolvedTransitions.has(log.problemId)) {
        resolvedTransitions.set(log.problemId, value);
      }
    }
    const fixEffectiveness = (() => {
      let verifiedFix = 0;
      let exception = 0;
      for (const value of resolvedTransitions.values()) {
        if (value.verifiedFix) verifiedFix += 1;
        else exception += 1;
      }
      return { resolved: resolvedTransitions.size, verifiedFix, exception };
    })();

    return {
      trends: recent,
      topCauses,
      aging,
      overdue: overdueCount,
      open: openCount,
      statusDistribution: statusRows.map((row) => ({ status: row.status, count: row._count._all })),
      knownErrors: {
        byStatus: keByStatus.map((row) => ({ status: row.status, count: row._count._all })),
        problemsWithKnownError: keLinkedCount,
      },
      fixEffectiveness,
    };
  }
}

export type { ProblemDetail, ProblemSummary };