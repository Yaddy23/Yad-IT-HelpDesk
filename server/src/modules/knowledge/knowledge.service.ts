import type { Prisma } from '@prisma/client';

import { hasPermission } from '../../core/permissions.js';
import { notFound, forbidden } from '../../core/errors.js';
import type { AuthedUser } from '../../core/request.js';
import { prisma } from '../../prisma/client.js';
import type { KnowledgeStatus, KnowledgeVisibility, Role } from '@prisma/client';

/**
 * Escape LIKE metacharacters so a query of `%%` matches the literal text.
 * Prisma's `contains` compiles to `ILIKE '%' || $1 || '%'` and does NOT escape
 * the term, so a query of `%%` becomes `ILIKE '%%%'` and matches every row.
 */
function escapeLike(term: string): string {
  return term.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/**
 * Returns a Prisma where fragment that enforces knowledge base visibility rules.
 * - `kb:author` (technician, manager, admin) sees all statuses including drafts.
 * - `kb:read_internal` (technician, manager, admin) sees `internal` visibility.
 * - `kb:publish` (manager, admin) sees everything including restricted with empty allowedRoles.
 * - Authors and owners always see their own articles regardless of visibility.
 * - An out-of-scope article is NOT FOUND (404), never FORBIDDEN (403).
 */
export function articleVisibilityWhere(user: AuthedUser): Prisma.KnowledgeArticleWhereInput {
  const roles = user.roles as Role[];
  const seesUnpublished = hasPermission({ roles }, 'kb:author');
  const seesInternal = hasPermission({ roles }, 'kb:read_internal');
  const seesEverything = hasPermission({ roles }, 'kb:publish');

  const stateGate: Prisma.KnowledgeArticleWhereInput = seesUnpublished ? {} : { status: 'published' };
  const audienceGate: Prisma.KnowledgeArticleWhereInput = {
    OR: [
      { visibility: 'public' },
      ...(seesInternal ? [{ visibility: 'internal' as const }] : []),
      { visibility: 'restricted' as const, allowedRoles: { hasSome: roles } },
      // An author or owner always sees their own article, whatever its
      // audience gate says — otherwise a restricted article with an empty
      // allowedRoles list would be invisible to the person who wrote it.
      { authorId: user.id },
      { ownerId: user.id },
    ],
  };

  // A publisher reviews articles before they go live, so the audience gate
  // must not hide one from them; without this they could not review a
  // restricted article whose role list is empty.
  return seesEverything ? stateGate : { AND: [stateGate, audienceGate] };
}

export interface ArticleSummary {
  id: string;
  title: string;
  summary: string | null;
  category: string;
  tags: string[];
  status: KnowledgeStatus;
  visibility: KnowledgeVisibility;
  helpfulCount: number;
  notHelpfulCount: number;
  author: { id: string; name: string };
  updatedAt: Date;
}

export interface ArticleDetail extends ArticleSummary {
  body: string;
  authorId: string;
  ownerId: string | null;
  sourceTicketId: string | null;
  version: number;
  publishedAt: Date | null;
  reviewDueAt: Date | null;
  reviewIntervalDays: number;
  createdAt: Date;
}

const articleSummarySelect = {
  id: true,
  title: true,
  summary: true,
  category: true,
  tags: true,
  status: true,
  visibility: true,
  allowedRoles: true,
  helpfulCount: true,
  notHelpfulCount: true,
  author: { select: { id: true, name: true } },
  updatedAt: true,
} satisfies Prisma.KnowledgeArticleSelect;

const articleDetailSelect = {
  ...articleSummarySelect,
  body: true,
  authorId: true,
  ownerId: true,
  sourceTicketId: true,
  version: true,
  publishedAt: true,
  reviewDueAt: true,
  reviewIntervalDays: true,
  createdAt: true,
} satisfies Prisma.KnowledgeArticleSelect;

/**
 * List articles with pagination, filtering, and search.
 * Status filter is only applied when the user has kb:author permission.
 */
export async function listArticles(
  user: AuthedUser,
  query: {
    q?: string;
    category?: string;
    status?: KnowledgeStatus;
    visibility?: KnowledgeVisibility;
    tag?: string;
    page: number;
    limit: number;
  }
): Promise<{ articles: ArticleSummary[]; total: number; page: number; pages: number }> {
  const { q, category, status, visibility, tag, page, limit } = query;

  // A caller-supplied status is applied on top of the visibility gate, so a
  // non-author asking for drafts gets the empty set — the gate already pins
  // them to `published`, and AND-ing the two yields nothing, which is the
  // honest answer to "show me the drafts".
  const clauses: Prisma.KnowledgeArticleWhereInput[] = [articleVisibilityWhere(user)];

  if (status) {
    clauses.push({ status });
  }

  if (category) {
    clauses.push({ category });
  }

  if (visibility) {
    clauses.push({ visibility });
  }

  if (tag) {
    clauses.push({ tags: { has: tag } });
  }

  if (q && q.trim()) {
    const escaped = escapeLike(q.trim());
    clauses.push({
      OR: [
        { title: { contains: escaped, mode: 'insensitive' } },
        { summary: { contains: escaped, mode: 'insensitive' } },
        { body: { contains: escaped, mode: 'insensitive' } },
      ],
    });
  }

  const where: Prisma.KnowledgeArticleWhereInput = { AND: clauses };

  const [articles, total] = await Promise.all([
    prisma.knowledgeArticle.findMany({
      where,
      select: articleSummarySelect,
      orderBy: { updatedAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.knowledgeArticle.count({ where }),
  ]);

  return {
    articles,
    total,
    page,
    pages: Math.ceil(total / limit),
  };
}

/**
 * Get a single article by ID, enforcing visibility.
 * Throws 404 if not found or not visible (never 403).
 */
export async function getArticle(user: AuthedUser, id: string): Promise<ArticleDetail> {
  const article = await prisma.knowledgeArticle.findFirst({
    where: {
      AND: [{ id }, articleVisibilityWhere(user)],
    },
    select: articleDetailSelect,
  });

  if (!article) throw notFound('Article not found');

  return article;
}

/**
 * Suggest published articles for a query (used in ticket deflection).
 * Only searches published articles, never drafts.
 * Matches against title, summary, and tags.
 * Ordered by helpfulCount desc, then updatedAt desc.
 */
export async function suggestArticles(
  user: AuthedUser,
  q: string | undefined,
  category: string | undefined,
  limit: number
): Promise<ArticleSummary[]> {
  const clauses: Prisma.KnowledgeArticleWhereInput[] = [
    { status: 'published' },
    articleVisibilityWhere(user),
  ];

  if (category) {
    clauses.push({ category });
  }

  if (q && q.trim()) {
    // Tags are matched exactly, so they take the raw tokens; only the two
    // ILIKE branches get the LIKE-escaped term — escapeLike inserts
    // backslashes that would corrupt an exact array match.
    const escaped = escapeLike(q.trim());
    const terms = q.trim().split(/\s+/).filter(Boolean);
    clauses.push({
      OR: [
        { title: { contains: escaped, mode: 'insensitive' } },
        { summary: { contains: escaped, mode: 'insensitive' } },
        ...(terms.length ? [{ tags: { hasSome: terms } }] : []),
      ],
    });
  }

  const where: Prisma.KnowledgeArticleWhereInput = { AND: clauses };

  const articles = await prisma.knowledgeArticle.findMany({
    where,
    select: articleSummarySelect,
    orderBy: [{ helpfulCount: 'desc' }, { updatedAt: 'desc' }],
    take: limit,
  });

  return articles;
}

/**
 * List all distinct categories from published articles visible to the user.
 */
export async function listCategories(user: AuthedUser): Promise<string[]> {
  const articles = await prisma.knowledgeArticle.findMany({
    where: {
      AND: [
        { status: 'published' },
        articleVisibilityWhere(user),
      ],
    },
    select: { category: true },
    distinct: ['category'],
    orderBy: { category: 'asc' },
  });

  return articles.map((a) => a.category);
}

/**
 * Create a new draft article with revision 1.
 * Requires kb:author.
 */
export async function createArticle(
  user: AuthedUser,
  input: {
    title: string;
    summary?: string | null;
    body: string;
    category: string;
    tags: string[];
    visibility: KnowledgeVisibility;
  }
): Promise<ArticleDetail> {
  const article = await prisma.$transaction(async (tx) => {
    const created = await tx.knowledgeArticle.create({
      data: {
        title: input.title,
        summary: input.summary ?? null,
        body: input.body,
        category: input.category,
        tags: input.tags,
        status: 'draft',
        visibility: input.visibility,
        authorId: user.id,
        ownerId: user.id,
        version: 1,
      },
      select: articleDetailSelect,
    });

    await tx.knowledgeRevision.create({
      data: {
        articleId: created.id,
        revisionNumber: 1,
        title: created.title,
        summary: created.summary,
        body: created.body,
        category: created.category,
        tags: created.tags,
        visibility: created.visibility,
        allowedRoles: created.allowedRoles,
        changeNote: 'Initial version',
        editorId: user.id,
      },
    });

    return created;
  });

  return article;
}

/**
 * Update article content with optimistic concurrency.
 * Creates a new revision. Published articles revert to draft.
 * Requires kb:author AND (author/owner OR kb:publish).
 */
export async function updateArticle(
  user: AuthedUser,
  id: string,
  input: {
    title?: string;
    summary?: string | null;
    body?: string;
    category?: string;
    tags?: string[];
    visibility?: KnowledgeVisibility;
    version: number;
  }
): Promise<ArticleDetail> {
  const article = await prisma.knowledgeArticle.findUnique({
    where: { id },
  });

  if (!article) throw notFound('Article not found');

  // Check visibility/access
  const visibilityCheck = await prisma.knowledgeArticle.findFirst({
    where: { AND: [{ id }, articleVisibilityWhere(user)] },
  });
  if (!visibilityCheck) throw notFound('Article not found');

  // Optimistic concurrency
  if (article.version !== input.version) {
    const err = new Error('STALE_VERSION') as Error & { code: string };
    err.code = 'STALE_VERSION';
    throw err;
  }

  // Authorization: author/owner OR kb:publish
  const isAuthorOrOwner = article.authorId === user.id || article.ownerId === user.id;
  const canPublish = hasPermission({ roles: user.roles as Role[] }, 'kb:publish');
  if (!isAuthorOrOwner && !canPublish) {
    throw forbidden('Not authorized to edit this article');
  }

  const nextVersion = article.version + 1;
  const newStatus = article.status === 'published' ? 'draft' : article.status;

  const updated = await prisma.$transaction(async (tx) => {
    const updatedArticle = await tx.knowledgeArticle.update({
      where: { id },
      data: {
        title: input.title ?? article.title,
        summary: input.summary ?? article.summary,
        body: input.body ?? article.body,
        category: input.category ?? article.category,
        tags: input.tags ?? article.tags,
        visibility: input.visibility ?? article.visibility,
        status: newStatus,
        version: nextVersion,
        // Clear publishedAt/reviewDueAt if reverting from published
        ...(article.status === 'published' ? { publishedAt: null, reviewDueAt: null } : {}),
      },
      select: articleDetailSelect,
    });

    await tx.knowledgeRevision.create({
      data: {
        articleId: id,
        revisionNumber: nextVersion,
        title: updatedArticle.title,
        summary: updatedArticle.summary,
        body: updatedArticle.body,
        category: updatedArticle.category,
        tags: updatedArticle.tags,
        visibility: updatedArticle.visibility,
        allowedRoles: updatedArticle.allowedRoles,
        changeNote: 'Content updated',
        editorId: user.id,
      },
    });

    return updatedArticle;
  });

  return updated;
}

/**
 * Submit a draft article for review (draft → in_review).
 * Requires kb:author AND author/owner.
 */
export async function submitForReview(user: AuthedUser, id: string): Promise<ArticleDetail> {
  const article = await prisma.knowledgeArticle.findUnique({
    where: { id },
  });

  if (!article) throw notFound('Article not found');

  // Must be draft
  if (article.status !== 'draft') {
    throw forbidden('Only draft articles can be submitted for review');
  }

  // Authorization: must be author or owner
  if (article.authorId !== user.id && article.ownerId !== user.id) {
    throw forbidden('Only the author or owner can submit this article for review');
  }

  const updated = await prisma.knowledgeArticle.update({
    where: { id },
    data: { status: 'in_review' },
    select: articleDetailSelect,
  });

  return updated;
}

/**
 * Publish an in_review article (in_review → published).
 * Requires kb:publish. Stamps publishedAt and reviewDueAt.
 */
export async function publishArticle(_user: AuthedUser, id: string): Promise<ArticleDetail> {
  const article = await prisma.knowledgeArticle.findUnique({
    where: { id },
  });

  if (!article) throw notFound('Article not found');

  if (article.status !== 'in_review') {
    throw forbidden('Only articles in review can be published');
  }

  const publishedAt = new Date();
  const reviewDueAt = new Date(publishedAt.getTime() + article.reviewIntervalDays * 24 * 60 * 60 * 1000);

  const updated = await prisma.knowledgeArticle.update({
    where: { id },
    data: {
      status: 'published',
      publishedAt,
      reviewDueAt,
    },
    select: articleDetailSelect,
  });

  return updated;
}

/**
 * Reject an in_review article back to draft (in_review → draft).
 * Requires kb:publish and a non-empty note.
 */
export async function rejectArticle(
  _user: AuthedUser,
  id: string,
  _note: string
): Promise<ArticleDetail> {
  const article = await prisma.knowledgeArticle.findUnique({
    where: { id },
  });

  if (!article) throw notFound('Article not found');

  if (article.status !== 'in_review') {
    throw forbidden('Only articles in review can be rejected');
  }

  const updated = await prisma.knowledgeArticle.update({
    where: { id },
    data: { status: 'draft' },
    select: articleDetailSelect,
  });

  // Note: In a full implementation, the rejection note could be stored
  // in a revision or activity log. For now we just transition the status.
  return updated;
}

/**
 * Archive a published article (published → archived).
 * Requires kb:publish.
 */
export async function archiveArticle(_user: AuthedUser, id: string): Promise<ArticleDetail> {
  const article = await prisma.knowledgeArticle.findUnique({
    where: { id },
  });

  if (!article) throw notFound('Article not found');

  if (article.status !== 'published') {
    throw forbidden('Only published articles can be archived');
  }

  const updated = await prisma.knowledgeArticle.update({
    where: { id },
    data: { status: 'archived' },
    select: articleDetailSelect,
  });

  return updated;
}

/**
 * Restore an archived article to published (archived → published).
 * Requires kb:publish.
 */
export async function restoreArticle(_user: AuthedUser, id: string): Promise<ArticleDetail> {
  const article = await prisma.knowledgeArticle.findUnique({
    where: { id },
  });

  if (!article) throw notFound('Article not found');

  if (article.status !== 'archived') {
    throw forbidden('Only archived articles can be restored');
  }

  const updated = await prisma.knowledgeArticle.update({
    where: { id },
    data: { status: 'published' },
    select: articleDetailSelect,
  });

  return updated;
}

/**
 * List all revisions for an article.
 * Requires kb:read and article must be visible.
 */
export async function listRevisions(
  user: AuthedUser,
  articleId: string
): Promise<Array<{
  revisionNumber: number;
  title: string;
  summary: string | null;
  category: string;
  tags: string[];
  visibility: KnowledgeVisibility;
  allowedRoles: Role[];
  changeNote: string | null;
  editor: { id: string; name: string };
  createdAt: Date;
}>> {
  // Verify article is visible to user
  const article = await prisma.knowledgeArticle.findFirst({
    where: { AND: [{ id: articleId }, articleVisibilityWhere(user)] },
    select: { id: true },
  });

  if (!article) throw notFound('Article not found');

  const revisions = await prisma.knowledgeRevision.findMany({
    where: { articleId },
    orderBy: { revisionNumber: 'desc' },
    select: {
      revisionNumber: true,
      title: true,
      summary: true,
      category: true,
      tags: true,
      visibility: true,
      allowedRoles: true,
      changeNote: true,
      editor: { select: { id: true, name: true } },
      createdAt: true,
    },
  });

  return revisions;
}

/**
 * Get a specific revision by number.
 * Requires kb:read and article must be visible.
 */
export async function getRevision(
  user: AuthedUser,
  articleId: string,
  revisionNumber: number
): Promise<{
  revisionNumber: number;
  title: string;
  summary: string | null;
  body: string;
  category: string;
  tags: string[];
  visibility: KnowledgeVisibility;
  allowedRoles: Role[];
  changeNote: string | null;
  editor: { id: string; name: string };
  createdAt: Date;
}> {
  // Verify article is visible to user
  const article = await prisma.knowledgeArticle.findFirst({
    where: { AND: [{ id: articleId }, articleVisibilityWhere(user)] },
    select: { id: true },
  });

  if (!article) throw notFound('Article not found');

  const revision = await prisma.knowledgeRevision.findUnique({
    where: { articleId_revisionNumber: { articleId, revisionNumber } },
    select: {
      revisionNumber: true,
      title: true,
      summary: true,
      body: true,
      category: true,
      tags: true,
      visibility: true,
      allowedRoles: true,
      changeNote: true,
      editor: { select: { id: true, name: true } },
      createdAt: true,
    },
  });

  if (!revision) throw notFound('Revision not found');

  return revision;
}

/**
 * Restore an old revision as a new revision (history is never mutated).
 * Requires kb:author AND (author/owner OR kb:publish).
 */
export async function restoreRevision(
  user: AuthedUser,
  articleId: string,
  revisionNumber: number
): Promise<ArticleDetail> {
  const article = await prisma.knowledgeArticle.findUnique({
    where: { id: articleId },
  });

  if (!article) throw notFound('Article not found');

  // Check visibility/access
  const visibilityCheck = await prisma.knowledgeArticle.findFirst({
    where: { AND: [{ id: articleId }, articleVisibilityWhere(user)] },
  });
  if (!visibilityCheck) throw notFound('Article not found');

  // Authorization: author/owner OR kb:publish
  const isAuthorOrOwner = article.authorId === user.id || article.ownerId === user.id;
  const canPublish = hasPermission({ roles: user.roles as Role[] }, 'kb:publish');
  if (!isAuthorOrOwner && !canPublish) {
    throw forbidden('Not authorized to restore revisions on this article');
  }

  const revision = await prisma.knowledgeRevision.findUnique({
    where: { articleId_revisionNumber: { articleId, revisionNumber } },
  });

  if (!revision) throw notFound('Revision not found');

  const nextVersion = article.version + 1;

  const updated = await prisma.$transaction(async (tx) => {
    const updatedArticle = await tx.knowledgeArticle.update({
      where: { id: articleId },
      data: {
        title: revision.title,
        summary: revision.summary,
        body: revision.body,
        category: revision.category,
        tags: revision.tags,
        visibility: revision.visibility,
        allowedRoles: revision.allowedRoles,
        version: nextVersion,
        status: 'draft', // Restored revisions are always drafts
        publishedAt: null,
        reviewDueAt: null,
      },
      select: articleDetailSelect,
    });

    await tx.knowledgeRevision.create({
      data: {
        articleId,
        revisionNumber: nextVersion,
        title: revision.title,
        summary: revision.summary,
        body: revision.body,
        category: revision.category,
        tags: revision.tags,
        visibility: revision.visibility,
        allowedRoles: revision.allowedRoles,
        changeNote: `Restored from revision ${revisionNumber}`,
        editorId: user.id,
      },
    });

    return updatedArticle;
  });

  return updated;
}