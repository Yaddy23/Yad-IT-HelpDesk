import { api, type ApiEnvelope } from './api';

/* ── Types ────────────────────────────────────────────────────────────────── */

export type KnowledgeStatus = 'draft' | 'in_review' | 'published' | 'archived';
export type KnowledgeVisibility = 'public' | 'internal' | 'restricted';
export type KnowledgeFeedback = 'helpful' | 'not_helpful';

export interface KnowledgeArticleSummary {
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
  updatedAt: string;
}

export interface KnowledgeArticleDetail extends KnowledgeArticleSummary {
  body: string;
  authorId: string;
  ownerId: string | null;
  sourceTicketId: string | null;
  version: number;
  publishedAt: string | null;
  reviewDueAt: string | null;
  reviewIntervalDays: number;
  createdAt: string;
}

export interface KnowledgeRevision {
  revisionNumber: number;
  title: string;
  summary: string | null;
  category: string;
  tags: string[];
  visibility: KnowledgeVisibility;
  allowedRoles: string[];
  changeNote: string | null;
  editor: { id: string; name: string };
  createdAt: string;
}

export interface KnowledgeRevisionDetail extends KnowledgeRevision {
  body: string;
}

export interface ListArticlesResponse {
  articles: KnowledgeArticleSummary[];
  total: number;
  page: number;
  pages: number;
}

export interface ListArticlesQuery {
  q?: string;
  category?: string;
  status?: KnowledgeStatus;
  visibility?: KnowledgeVisibility;
  tag?: string;
  page?: number;
  limit?: number;
}

export interface CreateArticleInput {
  title: string;
  summary?: string | null;
  body: string;
  category: string;
  tags: string[];
  visibility: KnowledgeVisibility;
}

export interface UpdateArticleInput {
  title?: string;
  summary?: string | null;
  body?: string;
  category?: string;
  tags?: string[];
  visibility?: KnowledgeVisibility;
  version: number;
}

/* ── API ──────────────────────────────────────────────────────────────────── */

export const knowledgeApi = {
  /**
   * List articles with pagination, filtering, and search.
   */
  list: async (query: ListArticlesQuery = {}): Promise<ListArticlesResponse> => {
    const params = new URLSearchParams();
    if (query.q) params.set('q', query.q);
    if (query.category) params.set('category', query.category);
    if (query.status) params.set('status', query.status);
    if (query.visibility) params.set('visibility', query.visibility);
    if (query.tag) params.set('tag', query.tag);
    if (query.page) params.set('page', String(query.page));
    if (query.limit) params.set('limit', String(query.limit));

    // GET /knowledge answers with the list envelope plus flat pagination:
    // { data: ArticleSummary[], page, pages, total }.
    const res = await api.get<{
      data: KnowledgeArticleSummary[];
      page: number;
      pages: number;
      total: number;
    }>(`/knowledge?${params.toString()}`);
    return {
      articles: res.data.data,
      page: res.data.page,
      pages: res.data.pages,
      total: res.data.total,
    };
  },

  /**
   * Get a single article by ID.
   */
  get: async (id: string): Promise<KnowledgeArticleDetail> =>
    (await api.get<ApiEnvelope<KnowledgeArticleDetail>>(`/knowledge/${id}`)).data.data,

  /**
   * List distinct categories from published articles.
   */
  listCategories: async (): Promise<string[]> =>
    (await api.get<ApiEnvelope<string[]>>('/knowledge/categories')).data.data,

  /**
   * Suggest published articles for a query (used in ticket deflection).
   */
  suggest: async (q: string, category?: string, limit = 10): Promise<KnowledgeArticleSummary[]> => {
    const params = new URLSearchParams();
    if (q) params.set('q', q);
    if (category) params.set('category', category);
    params.set('limit', String(limit));

    const res = await api.get<ApiEnvelope<KnowledgeArticleSummary[]>>(`/knowledge/suggest?${params.toString()}`);
    return res.data.data;
  },

  /**
   * Create a new draft article. Requires kb:author.
   */
  create: async (input: CreateArticleInput): Promise<KnowledgeArticleDetail> =>
    (await api.post<ApiEnvelope<KnowledgeArticleDetail>>('/knowledge', input)).data.data,

  /**
   * Update article content with optimistic concurrency. Requires kb:author.
   */
  update: async (id: string, input: UpdateArticleInput): Promise<KnowledgeArticleDetail> =>
    (await api.patch<ApiEnvelope<KnowledgeArticleDetail>>(`/knowledge/${id}`, input)).data.data,

  /**
   * Submit a draft article for review. Requires kb:author and author/owner.
   */
  submitForReview: async (id: string): Promise<KnowledgeArticleDetail> =>
    (await api.post<ApiEnvelope<KnowledgeArticleDetail>>(`/knowledge/${id}/submit`, {})).data.data,

  /**
   * Publish an in_review article. Requires kb:publish.
   */
  publish: async (id: string): Promise<KnowledgeArticleDetail> =>
    (await api.post<ApiEnvelope<KnowledgeArticleDetail>>(`/knowledge/${id}/publish`, {})).data.data,

  /**
   * Reject an in_review article back to draft. Requires kb:publish and a note.
   */
  reject: async (id: string, note: string): Promise<KnowledgeArticleDetail> =>
    (await api.post<ApiEnvelope<KnowledgeArticleDetail>>(`/knowledge/${id}/reject`, { note })).data.data,

  /**
   * Archive a published article. Requires kb:publish.
   */
  archive: async (id: string): Promise<KnowledgeArticleDetail> =>
    (await api.post<ApiEnvelope<KnowledgeArticleDetail>>(`/knowledge/${id}/archive`, {})).data.data,

  /**
   * Restore an archived article to published. Requires kb:publish.
   */
  restore: async (id: string): Promise<KnowledgeArticleDetail> =>
    (await api.post<ApiEnvelope<KnowledgeArticleDetail>>(`/knowledge/${id}/restore`, {})).data.data,

  /**
   * List all revisions for an article.
   */
  listRevisions: async (id: string): Promise<KnowledgeRevision[]> =>
    (await api.get<ApiEnvelope<KnowledgeRevision[]>>(`/knowledge/${id}/revisions`)).data.data,

  /**
   * Get a specific revision by number.
   */
  getRevision: async (id: string, revisionNumber: number): Promise<KnowledgeRevisionDetail> =>
    (await api.get<ApiEnvelope<KnowledgeRevisionDetail>>(`/knowledge/${id}/revisions/${revisionNumber}`)).data.data,

  /**
   * Restore an old revision as a new revision. Requires kb:author.
   */
  restoreRevision: async (id: string, revisionNumber: number): Promise<KnowledgeArticleDetail> =>
    (await api.post<ApiEnvelope<KnowledgeArticleDetail>>(`/knowledge/${id}/revisions/${revisionNumber}/restore`, {})).data.data,
};

/* ── Helpers ──────────────────────────────────────────────────────────────── */

export function getStatusBadgeClass(status: KnowledgeStatus): string {
  switch (status) {
    case 'published':
      return 'bg-green-500/10 text-green-700 dark:text-green-400';
    case 'in_review':
      return 'bg-yellow-500/10 text-yellow-700 dark:text-yellow-400';
    case 'draft':
      return 'bg-gray-500/10 text-gray-700 dark:text-gray-400';
    case 'archived':
      return 'bg-red-500/10 text-red-700 dark:text-red-400';
  }
}

export function getVisibilityBadgeClass(visibility: KnowledgeVisibility): string {
  switch (visibility) {
    case 'public':
      return 'bg-blue-500/10 text-blue-700 dark:text-blue-400';
    case 'internal':
      return 'bg-purple-500/10 text-purple-700 dark:text-purple-400';
    case 'restricted':
      return 'bg-orange-500/10 text-orange-700 dark:text-orange-400';
  }
}

export function formatDate(dateString: string): string {
  return new Date(dateString).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}