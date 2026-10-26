import type {
  KnownErrorStatus,
  KnownErrorVisibility,
  KnowledgeVisibility,
  Prisma,
  Role,
} from '@prisma/client';

import { recordAudit } from '../../core/audit.js';
import { badRequest, conflict, forbidden, notFound } from '../../core/errors.js';
import { hasPermission, type Permission } from '../../core/permissions.js';
import type { AuthedUser } from '../../core/request.js';
import { prisma } from '../../prisma/client.js';
import { KNOWN_ERROR_TRANSITIONS, problemConfig } from '../problems/config.js';
import { generateKnownErrorNumber } from '../problems/numberGenerator.js';

const knownErrorDetailInclude = {
  owner: { select: { id: true, name: true, email: true } },
  approvedBy: { select: { id: true, name: true, email: true } },
  problem: { select: { id: true, number: true, title: true, status: true } },
  publishedArticle: { select: { id: true, title: true, status: true, visibility: true } },
} as const satisfies Prisma.KnownErrorInclude;

const knownErrorSummarySelect = {
  id: true,
  number: true,
  title: true,
  problemId: true,
  status: true,
  visibility: true,
  ownerId: true,
  owner: { select: { id: true, name: true, email: true } },
  affectedServices: true,
  affectedAssets: true,
  affectedCIs: true,
  approvedById: true,
  approvedAt: true,
  reviewDueAt: true,
  lastReviewedAt: true,
  publishedArticleId: true,
  createdAt: true,
  updatedAt: true,
} as const satisfies Prisma.KnownErrorSelect;

export type KnownErrorDetail = Prisma.KnownErrorGetPayload<{ include: typeof knownErrorDetailInclude }>;
export type KnownErrorSummary = Prisma.KnownErrorGetPayload<{ select: typeof knownErrorSummarySelect }>;

/** The KB's own visibility enum is a different type — see `toArticleVisibility`. */
const EMPLOYEE_VISIBLE: KnownErrorVisibility = 'EMPLOYEE_SELF_SERVICE';

/**
 * Known errors are an IT-wide library (spec Section 5.3 exposes them to every
 * role holding `known_errors:read`, and `/known-errors/search` exists so anyone
 * on the desk can find a workaround). There is no per-owner record scoping —
 * unlike problems, where spec Section 8 requires it.
 */
function assertPermission(user: AuthedUser, permission: Permission): void {
  if (!hasPermission({ roles: user.roles as Role[] }, permission)) {
    throw forbidden('Insufficient permissions');
  }
}

/**
 * `KnownErrorVisibility` (IT_ONLY | EMPLOYEE_SELF_SERVICE) and
 * `KnowledgeVisibility` (public | internal | restricted) are separate enums;
 * they are not interchangeable. Publishing to the KB maps one onto the other.
 */
function toArticleVisibility(visibility: KnownErrorVisibility): KnowledgeVisibility {
  return visibility === EMPLOYEE_VISIBLE ? 'public' : 'internal';
}

function truncate(text: string, max = 200): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length <= max ? clean : `${clean.slice(0, max - 1).trimEnd()}…`;
}

/** The KB article body: the workaround first, since that is what a reader came for. */
function buildArticleBody(knownError: {
  symptoms: string;
  rootCause: string;
  workaround: string;
  resolutionNotes: string | null;
  number: string;
}): string {
  const sections = [
    `## Workaround\n\n${knownError.workaround}`,
    `## Symptoms\n\n${knownError.symptoms}`,
    `## Root cause\n\n${knownError.rootCause}`,
  ];
  if (knownError.resolutionNotes) {
    sections.push(`## Permanent fix\n\n${knownError.resolutionNotes}`);
  }
  sections.push(`---\n\nSource: known error ${knownError.number}`);
  return sections.join('\n\n');
}

export class KnownErrorsService {
  /** List known errors with pagination and filtering (spec Section 5.3). */
  async list(
    user: AuthedUser,
    query: {
      page: number;
      limit: number;
      sort: string;
      order: 'asc' | 'desc';
      search?: string;
      status?: string[];
      visibility?: string[];
      problemId?: string;
      ownerId?: string;
    },
  ): Promise<{ knownErrors: KnownErrorSummary[]; total: number; page: number; pages: number }> {
    assertPermission(user, 'known_errors:read');

    const { page, limit, sort, order, search, status, visibility, problemId, ownerId } = query;

    const and: Prisma.KnownErrorWhereInput[] = [];
    if (status?.length) and.push({ status: { in: status as KnownErrorStatus[] } });
    if (visibility?.length) and.push({ visibility: { in: visibility as KnownErrorVisibility[] } });
    if (problemId) and.push({ problemId });
    if (ownerId) and.push({ ownerId });
    if (search?.trim()) {
      const term = search.trim();
      and.push({
        OR: [
          { title: { contains: term, mode: 'insensitive' } },
          { symptoms: { contains: term, mode: 'insensitive' } },
          { rootCause: { contains: term, mode: 'insensitive' } },
          { workaround: { contains: term, mode: 'insensitive' } },
        ],
      });
    }

    const where: Prisma.KnownErrorWhereInput = { deletedAt: null, AND: and };
    const orderBy: Prisma.KnownErrorOrderByWithRelationInput = { [sort]: order };

    const [knownErrors, total] = await Promise.all([
      prisma.knownError.findMany({
        where,
        select: knownErrorSummarySelect,
        orderBy,
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.knownError.count({ where }),
    ]);

    return { knownErrors, total, page, pages: Math.max(1, Math.ceil(total / limit)) };
  }

  /**
   * Workaround search (spec Section 5.3: "employee self-service"). Only
   * PUBLISHED known errors are findable — an unapproved draft must not leak a
   * workaround to the desk, let alone to employees.
   */
  async search(
    user: AuthedUser,
    query: { q?: string; visibility?: KnownErrorVisibility; limit: number },
  ): Promise<KnownErrorSummary[]> {
    assertPermission(user, 'known_errors:read');

    const and: Prisma.KnownErrorWhereInput[] = [];
    if (query.visibility) and.push({ visibility: query.visibility });
    if (query.q?.trim()) {
      const term = query.q.trim();
      and.push({
        OR: [
          { title: { contains: term, mode: 'insensitive' } },
          { symptoms: { contains: term, mode: 'insensitive' } },
          { workaround: { contains: term, mode: 'insensitive' } },
          { affectedServices: { has: term } },
        ],
      });
    }

    return prisma.knownError.findMany({
      where: { deletedAt: null, status: 'PUBLISHED', AND: and },
      select: knownErrorSummarySelect,
      orderBy: { updatedAt: 'desc' },
      take: query.limit,
    });
  }

  /** Get one known error with its problem and published-article links. */
  async get(user: AuthedUser, id: string): Promise<KnownErrorDetail> {
    assertPermission(user, 'known_errors:read');

    const knownError = await prisma.knownError.findFirst({
      where: { id, deletedAt: null },
      include: knownErrorDetailInclude,
    });
    if (!knownError) throw notFound('Known error not found');

    return knownError;
  }

  /**
   * Create a known error for a problem (spec Section 4.4). The KE is created as
   * a DRAFT and IT_ONLY: nothing reaches employees until it has been approved
   * and published (spec Section 2 anti-goal: "Known Errors published without
   * approval").
   */
  async create(
    user: AuthedUser,
    input: {
      problemId: string;
      title: string;
      rootCause: string;
      symptoms: string;
      workaround: string;
      resolutionNotes?: string;
      affectedServices?: string[];
      affectedAssets?: string[];
      affectedCIs?: string[];
      visibility?: KnownErrorVisibility;
      ownerId?: string;
    },
  ): Promise<KnownErrorDetail> {
    assertPermission(user, 'known_errors:create');

    const problem = await prisma.problem.findFirst({
      where: { id: input.problemId, deletedAt: null },
      select: { id: true, number: true, affectedServices: true, knownErrorId: true },
    });
    if (!problem) throw notFound('Problem not found');

    const ownerId = input.ownerId ?? user.id;
    const owner = await prisma.user.findUnique({ where: { id: ownerId }, select: { id: true } });
    if (!owner) throw notFound('Owner not found');

    const created = await prisma.$transaction(async (tx) => {
      const number = await generateKnownErrorNumber(tx);

      const knownError = await tx.knownError.create({
        data: {
          number,
          title: input.title,
          problemId: problem.id,
          rootCause: input.rootCause,
          symptoms: input.symptoms,
          workaround: input.workaround,
          resolutionNotes: input.resolutionNotes ?? null,
          // A known error derived from a problem affects what the problem
          // affects, unless the caller narrows the scope explicitly.
          affectedServices: input.affectedServices ?? problem.affectedServices,
          affectedAssets: input.affectedAssets ?? [],
          affectedCIs: input.affectedCIs ?? [],
          status: 'DRAFT',
          visibility: input.visibility ?? 'IT_ONLY',
          ownerId,
        },
        include: knownErrorDetailInclude,
      });

      // `Problem.knownErrorId` is the PRIMARY known error for that problem
      // (unique). Claim it only when free — a later KE must not silently
      // displace the one the problem already points at.
      if (!problem.knownErrorId) {
        await tx.problem.update({
          where: { id: problem.id },
          data: { knownErrorId: knownError.id },
        });
      }

      await tx.problemAuditLog.create({
        data: {
          problemId: problem.id,
          action: 'KNOWN_ERROR_CREATED',
          newValue: { knownErrorId: knownError.id, number },
          actorId: user.id,
        },
      });

      return knownError;
    });

    await recordAudit({
      actorId: user.id,
      actorEmail: user.email,
      action: 'known_error.created',
      targetType: 'known_error',
      targetId: created.id,
      meta: { number: created.number, problemNumber: problem.number },
    });

    return created;
  }

  /** Update known error content. Requires `known_errors:update`. */
  async update(
    user: AuthedUser,
    id: string,
    input: {
      title?: string;
      rootCause?: string;
      symptoms?: string;
      workaround?: string;
      resolutionNotes?: string;
      affectedServices?: string[];
      affectedAssets?: string[];
      affectedCIs?: string[];
      visibility?: KnownErrorVisibility;
      ownerId?: string;
    },
  ): Promise<KnownErrorDetail> {
    assertPermission(user, 'known_errors:update');

    const knownError = await prisma.knownError.findFirst({ where: { id, deletedAt: null } });
    if (!knownError) throw notFound('Known error not found');

    // RETIRED is the archive state — its content is the record of what was
    // published, so it is read-only.
    if (knownError.status === 'RETIRED') {
      throw conflict('Cannot edit a retired known error');
    }

    // Spec Section 2 anti-goal: a known error must not be employee-visible
    // before it has been approved. Approval happens on the PUBLISHED
    // transition, so gate the visibility change on that status.
    if (input.visibility === EMPLOYEE_VISIBLE && knownError.status !== 'PUBLISHED') {
      throw badRequest(
        'A known error must be published before it can be employee-visible',
        'KNOWN_ERROR_NOT_APPROVED',
      );
    }

    if (input.ownerId) {
      const owner = await prisma.user.findUnique({ where: { id: input.ownerId }, select: { id: true } });
      if (!owner) throw notFound('Owner not found');
    }

    const updated = await prisma.knownError.update({
      where: { id },
      data: {
        title: input.title ?? knownError.title,
        rootCause: input.rootCause ?? knownError.rootCause,
        symptoms: input.symptoms ?? knownError.symptoms,
        workaround: input.workaround ?? knownError.workaround,
        resolutionNotes: input.resolutionNotes ?? knownError.resolutionNotes,
        affectedServices: input.affectedServices ?? knownError.affectedServices,
        affectedAssets: input.affectedAssets ?? knownError.affectedAssets,
        affectedCIs: input.affectedCIs ?? knownError.affectedCIs,
        visibility: input.visibility ?? knownError.visibility,
        ownerId: input.ownerId ?? knownError.ownerId,
      },
      include: knownErrorDetailInclude,
    });

    await recordAudit({
      actorId: user.id,
      actorEmail: user.email,
      action: 'known_error.updated',
      targetType: 'known_error',
      targetId: id,
      before: {
        title: knownError.title,
        rootCause: knownError.rootCause,
        symptoms: knownError.symptoms,
        workaround: knownError.workaround,
        visibility: knownError.visibility,
      },
      after: {
        title: updated.title,
        rootCause: updated.rootCause,
        symptoms: updated.symptoms,
        workaround: updated.workaround,
        visibility: updated.visibility,
      },
    });

    return updated;
  }

  /**
   * Move a known error through its lifecycle. Every move is an approval action
   * (spec Section 5.3 gates the whole status endpoint on `known_errors:approve`),
   * which is what keeps an unapproved KE from reaching employees.
   */
  async transitionStatus(
    user: AuthedUser,
    id: string,
    status: KnownErrorStatus,
    extra?: { reviewNotes?: string },
  ): Promise<KnownErrorDetail> {
    assertPermission(user, 'known_errors:approve');

    const knownError = await prisma.knownError.findFirst({ where: { id, deletedAt: null } });
    if (!knownError) throw notFound('Known error not found');

    // RETIRED is terminal — checked before the transition table so the caller
    // gets the specific reason rather than "cannot move X to Y".
    if (knownError.status === 'RETIRED') {
      throw conflict('Cannot transition from RETIRED');
    }

    const allowed = KNOWN_ERROR_TRANSITIONS[knownError.status];
    if (!allowed?.includes(status)) {
      throw conflict(`Cannot move a ${knownError.status} known error to ${status}`);
    }

    const now = new Date();
    // Unchecked: the approver is set through the `approvedById` scalar, not a
    // nested relation write.
    const data: Prisma.KnownErrorUncheckedUpdateInput = { status };

    if (status === 'PUBLISHED') {
      // Spec Step 3: PUBLISHED requires approvedBy and approvedAt.
      data.approvedById = user.id;
      data.approvedAt = now;
      data.lastReviewedAt = now;
      data.reviewDueAt =
        knownError.reviewDueAt ??
        new Date(now.getTime() + (await problemConfig.knownErrorReviewDays()) * 86_400_000);
    }

    const updated = await prisma.knownError.update({
      where: { id },
      data,
      include: knownErrorDetailInclude,
    });

    await recordAudit({
      actorId: user.id,
      actorEmail: user.email,
      action: `known_error.${status.toLowerCase()}`,
      targetType: 'known_error',
      targetId: id,
      meta: {
        number: knownError.number,
        from: knownError.status,
        to: status,
        ...(extra?.reviewNotes ? { reviewNotes: extra.reviewNotes } : {}),
      },
    });

    try {
      const { emitToUser } = await import('../../core/socket.js');
      emitToUser(updated.ownerId, 'known_error:status_changed', {
        knownErrorId: id,
        number: updated.number,
        oldStatus: knownError.status,
        newStatus: status,
      });
    } catch {
      // Socket.IO is not available in tests.
    }

    return updated;
  }

  /**
   * Publish the workaround to the knowledge base as an article (spec Section
   * 5.3). The spec leaves "new article or update an existing one" to the
   * builder; this updates the article a previous publish created, so
   * re-publishing cannot accumulate duplicate articles (the `knownErrorPublications`
   * back-relation stays at one row).
   *
   * Publishing is also what makes the known error employee-visible: the
   * workaround exists to be self-served, and approval has already happened by
   * the time this method is reachable.
   */
  async publishKB(
    user: AuthedUser,
    id: string,
    input?: { visibility?: KnownErrorVisibility },
  ): Promise<KnownErrorDetail> {
    assertPermission(user, 'known_errors:publish');

    const knownError = await prisma.knownError.findFirst({ where: { id, deletedAt: null } });
    if (!knownError) throw notFound('Known error not found');

    if (knownError.status !== 'PUBLISHED') {
      throw badRequest(
        'A known error must be published before it can be added to the knowledge base',
        'KNOWN_ERROR_NOT_PUBLISHED',
      );
    }

    const visibility = input?.visibility ?? EMPLOYEE_VISIBLE;
    const articleVisibility = toArticleVisibility(visibility);
    const now = new Date();
    const reviewDueAt =
      knownError.reviewDueAt ??
      new Date(now.getTime() + (await problemConfig.knownErrorReviewDays()) * 86_400_000);

    const content = {
      title: knownError.title,
      summary: truncate(knownError.symptoms),
      body: buildArticleBody(knownError),
      category: knownError.affectedServices[0] ?? 'Known Errors',
      tags: ['known-error', knownError.number, ...knownError.affectedServices],
    };

    const updated = await prisma.$transaction(async (tx) => {
      const existing = knownError.publishedArticleId
        ? await tx.knowledgeArticle.findUnique({
            where: { id: knownError.publishedArticleId },
            select: { id: true, version: true },
          })
        : null;

      let articleId: string;
      if (existing) {
        const version = existing.version + 1;
        await tx.knowledgeArticle.update({
          where: { id: existing.id },
          data: {
            ...content,
            visibility: articleVisibility,
            status: 'published',
            publishedAt: now,
            reviewDueAt,
            version,
          },
        });
        await tx.knowledgeRevision.create({
          data: {
            articleId: existing.id,
            revisionNumber: version,
            ...content,
            visibility: articleVisibility,
            changeNote: `Re-published from known error ${knownError.number}`,
            editorId: user.id,
          },
        });
        articleId = existing.id;
      } else {
        const article = await tx.knowledgeArticle.create({
          data: {
            ...content,
            visibility: articleVisibility,
            status: 'published',
            publishedAt: now,
            reviewDueAt,
            authorId: user.id,
            ownerId: user.id,
            version: 1,
          },
          select: { id: true },
        });
        await tx.knowledgeRevision.create({
          data: {
            articleId: article.id,
            revisionNumber: 1,
            ...content,
            visibility: articleVisibility,
            changeNote: `Published from known error ${knownError.number}`,
            editorId: user.id,
          },
        });
        articleId = article.id;
      }

      return tx.knownError.update({
        where: { id },
        data: {
          publishedArticleId: articleId,
          visibility,
          reviewDueAt,
          lastReviewedAt: now,
        },
        include: knownErrorDetailInclude,
      });
    });

    await recordAudit({
      actorId: user.id,
      actorEmail: user.email,
      action: 'known_error.published_to_kb',
      targetType: 'known_error',
      targetId: id,
      meta: {
        number: knownError.number,
        articleId: updated.publishedArticleId,
        visibility,
      },
    });

    try {
      const { emitToUser } = await import('../../core/socket.js');
      emitToUser(updated.ownerId, 'known_error:published', {
        knownErrorId: id,
        number: updated.number,
        title: updated.title,
        articleId: updated.publishedArticleId,
      });
    } catch {
      // Socket.IO is not available in tests.
    }

    return updated;
  }
}
