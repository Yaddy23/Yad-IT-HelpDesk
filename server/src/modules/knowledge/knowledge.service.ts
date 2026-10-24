import type { Prisma } from '@prisma/client';

import { hasPermission } from '../../core/permissions.js';
import { notFound } from '../../core/errors.js';
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
  q: string,
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