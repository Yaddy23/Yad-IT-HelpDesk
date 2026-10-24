import { useQuery, type UseQueryOptions } from '@tanstack/react-query';

import { api, type ApiEnvelope } from './api';

/* ── Enums ──────────────────────────────────────────────────────────────────── */

export type ProblemStatus =
  | 'IDENTIFIED'
  | 'INVESTIGATION'
  | 'ROOT_CAUSE_KNOWN'
  | 'WORKAROUND_DOCUMENTED'
  | 'PENDING_CHANGE'
  | 'RESOLVED'
  | 'CLOSED';

export type ProblemPriority = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export type RCAType = 'FIVE_WHYS' | 'FISHBONE' | 'NONE';

export type KnownErrorStatus = 'DRAFT' | 'UNDER_REVIEW' | 'PUBLISHED' | 'RETIRED';

export type KnownErrorVisibility = 'IT_ONLY' | 'EMPLOYEE_SELF_SERVICE';

/* ── Types ──────────────────────────────────────────────────────────────────── */

export interface UserRef {
  id: string;
  name: string;
  email: string;
}

/**
 * A paginated collection. The server sends `{ data: T[], meta: {...} }` — the
 * rows and the page counters are siblings, not nested — so this mirrors that
 * envelope directly rather than wrapping it a second time.
 */
export interface Paged<T> {
  data: T[];
  meta: {
    page: number;
    limit: number;
    total: number;
    pages: number;
  };
}

export interface ProblemSummary {
  id: string;
  number: string;
  title: string;
  description: string;
  status: ProblemStatus;
  priority: ProblemPriority;
  rcaType: RCAType;
  ownerId: string;
  owner: UserRef;
  affectedServices: string[];
  affectedAssets: string[];
  affectedCIs: string[];
  businessImpact: string;
  identifiedAt: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * A bare problem row, with no relations loaded. `POST /problems/from-incidents`
 * returns this (not a `ProblemSummary`, which carries `owner`): the detection
 * engine creates the problem and hands back the raw row. Callers that need
 * `owner` or the linked incidents should re-fetch via `get(id)`.
 */
export interface ProblemRecord {
  id: string;
  number: string;
  title: string;
  description: string;
  status: ProblemStatus;
  priority: ProblemPriority;
  rcaType: RCAType;
  ownerId: string;
  affectedServices: string[];
  affectedAssets: string[];
  affectedCIs: string[];
  businessImpact: string;
  identifiedAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface ProblemIncident {
  id: string;
  problemId: string;
  incidentId: string;
  linkedById: string;
  linkedAt: string;
  note: string | null;
  incident: {
    id: string;
    number: string;
    title: string;
    status: string;
    category: string;
  };
  /** The server selects only `id` and `name` here — no email. */
  linkedBy: { id: string; name: string };
}

/**
 * The `ProblemRCA` side-table. The narrative RCA fields — `rootCause`,
 * `resolutionSummary`, `rcaNotes`, `confirmedRootCause`, `rcaType` — live on
 * `Problem` itself (see `ProblemDetail`); this table holds only the structured
 * 5-Whys/Fishbone evidence. Nothing on the server writes it today, so the
 * detail response carries `rca: null`.
 */
export interface ProblemRCA {
  id: string;
  problemId: string;
  fiveWhys: unknown | null;
  fishbone: unknown | null;
  attachments: string[];
  createdAt: string;
  updatedAt: string;
}

export interface ProblemAuditLog {
  id: string;
  problemId: string;
  action: string;
  oldValue: unknown | null;
  newValue: unknown | null;
  actorId: string;
  actor: UserRef;
  createdAt: string;
}

export interface ProblemDetail extends ProblemSummary {
  rootCause: string | null;
  resolutionSummary: string | null;
  rcaNotes: string | null;
  fiveWhys: unknown | null;
  fishbone: unknown | null;
  confirmedRootCause: boolean;
  workaround: string | null;
  workaroundDocumentedAt: string | null;
  investigationStartedAt: string | null;
  rootCauseIdentifiedAt: string | null;
  changeInitiatedAt: string | null;
  resolvedAt: string | null;
  closedAt: string | null;
  changeRequestIds: string[];
  incidents: ProblemIncident[];
  rca: ProblemRCA | null;
  auditLogs: ProblemAuditLog[];
}

/** A problem an incident resembles, as ranked by the detection engine. */
export interface IncidentMatch {
  problemId: string;
  number: string;
  title: string;
  score: number;
  reasons: string[];
}

/** The incident columns the engine returns alongside its matches. */
export interface DetectionIncident {
  id: string;
  number: string;
  title: string;
  description: string;
  category: string;
  createdAt: string;
}

/** One incident and every open problem it resembles, best first. */
export interface IncidentMatches {
  incident: DetectionIncident;
  matches: IncidentMatch[];
}

/**
 * `GET /problems/detect` answers two questions with two different bodies:
 * `?incidentId=` ranks ONE incident against open problems, while omitting it
 * scans the whole window. Narrow on the payload — `Array.isArray(body.data)` —
 * before reading the rows.
 */
export type DetectionResponse =
  | {
      data: IncidentMatches[];
      meta: { scanned: number; threshold: number; windowHours: number };
    }
  | {
      data: { incident: DetectionIncident; matches: IncidentMatch[] };
      meta: { threshold: number; matchCount: number };
    };

/** A problem the duplicate check ranked against the one being filed. */
export interface SimilarProblemResult {
  problem: {
    id: string;
    number: string;
    title: string;
    description: string;
    status: ProblemStatus;
    ownerId: string;
    affectedServices: string[];
    affectedAssets: string[];
    rootCause: string | null;
    workaround: string | null;
  };
  score: number;
  reasons: string[];
}

export interface ListProblemsQuery {
  page?: number;
  limit?: number;
  sort?: 'identifiedAt' | 'updatedAt' | 'priority' | 'status';
  order?: 'asc' | 'desc';
  search?: string;
  status?: string; // comma-separated
  priority?: string; // comma-separated
  ownerId?: string;
  affectedService?: string;
  identifiedAfter?: string;
  identifiedBefore?: string;
}

export interface CreateProblemInput {
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

export interface UpdateProblemInput {
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

export interface TransitionStatusInput {
  status: ProblemStatus;
  verifiedFix?: boolean;
  resolutionSummary?: string;
  exceptionReason?: string;
}

export interface LinkIncidentsInput {
  incidentIds: string[];
  note?: string;
}

export interface UpdateRCAInput {
  rootCause?: string;
  resolutionSummary?: string;
  rcaNotes?: string;
  fiveWhys?: unknown;
  fishbone?: unknown;
  confirmedRootCause?: boolean;
  rcaType?: RCAType;
}

export interface GetAuditLogQuery {
  page?: number;
  limit?: number;
}

export interface CreateFromIncidentsInput {
  incidentIds: string[];
}

export interface SimilarProblemsQuery {
  threshold?: number;
}

export interface DetectQuery {
  /** Rank this one incident against open problems instead of scanning the window. */
  incidentId?: string;
  windowHours?: number;
  threshold?: number;
}

export interface KnownErrorSummary {
  id: string;
  number: string;
  title: string;
  problemId: string;
  status: KnownErrorStatus;
  visibility: KnownErrorVisibility;
  ownerId: string;
  owner: UserRef;
  affectedServices: string[];
  affectedAssets: string[];
  affectedCIs: string[];
  approvedById: string | null;
  approvedAt: string | null;
  reviewDueAt: string | null;
  lastReviewedAt: string | null;
  publishedArticleId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface KnownError extends KnownErrorSummary {
  rootCause: string;
  symptoms: string;
  workaround: string;
  resolutionNotes: string | null;
  problem: {
    id: string;
    number: string;
    title: string;
    status: ProblemStatus;
  };
  approvedBy: UserRef | null;
  publishedArticle: {
    id: string;
    title: string;
    status: string;
    visibility: string;
  } | null;
}

export interface ListKnownErrorsQuery {
  page?: number;
  limit?: number;
  sort?: 'createdAt' | 'updatedAt' | 'status' | 'reviewDueAt';
  order?: 'asc' | 'desc';
  search?: string;
  status?: string; // comma-separated
  visibility?: string; // comma-separated
  problemId?: string;
  ownerId?: string;
}

export interface SearchKnownErrorsQuery {
  q?: string;
  visibility?: KnownErrorVisibility;
  limit?: number;
}

export interface CreateKnownErrorInput {
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
}

export interface UpdateKnownErrorInput {
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
}

export interface TransitionKnownErrorInput {
  status: KnownErrorStatus;
  reviewNotes?: string;
}

export interface PublishKnownErrorInput {
  visibility?: KnownErrorVisibility;
}

/* ── API ────────────────────────────────────────────────────────────────────── */

const PROBLEMS_BASE = '/problems';
const KNOWN_ERRORS_BASE = '/known-errors';

export const problemApi = {
  /**
   * List problems with pagination, filtering, and search.
   */
  list: async (query: ListProblemsQuery = {}): Promise<Paged<ProblemSummary>> => {
    const params = new URLSearchParams();
    if (query.page) params.set('page', String(query.page));
    if (query.limit) params.set('limit', String(query.limit));
    if (query.sort) params.set('sort', query.sort);
    if (query.order) params.set('order', query.order);
    if (query.search) params.set('search', query.search);
    if (query.status) params.set('status', query.status);
    if (query.priority) params.set('priority', query.priority);
    if (query.ownerId) params.set('ownerId', query.ownerId);
    if (query.affectedService) params.set('affectedService', query.affectedService);
    if (query.identifiedAfter) params.set('identifiedAfter', query.identifiedAfter);
    if (query.identifiedBefore) params.set('identifiedBefore', query.identifiedBefore);

    const res = await api.get<Paged<ProblemSummary>>(`${PROBLEMS_BASE}?${params.toString()}`);
    return res.data;
  },

  /**
   * Get a single problem by ID with full detail.
   */
  get: async (id: string): Promise<ProblemDetail> =>
    (await api.get<ApiEnvelope<ProblemDetail>>(`${PROBLEMS_BASE}/${id}`)).data.data,

  /**
   * Create a new problem.
   */
  create: async (input: CreateProblemInput): Promise<ProblemDetail> =>
    (await api.post<ApiEnvelope<ProblemDetail>>(PROBLEMS_BASE, input)).data.data,

  /**
   * Update problem fields.
   */
  update: async (id: string, input: UpdateProblemInput): Promise<ProblemDetail> =>
    (await api.patch<ApiEnvelope<ProblemDetail>>(`${PROBLEMS_BASE}/${id}`, input)).data.data,

  /**
   * Transition problem status with validation rules.
   */
  transitionStatus: async (
    id: string,
    status: ProblemStatus,
    extra: Omit<TransitionStatusInput, 'status'> = {},
  ): Promise<ProblemDetail> =>
    (await api.post<ApiEnvelope<ProblemDetail>>(`${PROBLEMS_BASE}/${id}/status`, { status, ...extra })).data.data,

  /**
   * Link incidents to a problem.
   */
  linkIncidents: async (id: string, incidentIds: string[], note?: string): Promise<void> => {
    const body: LinkIncidentsInput = { incidentIds, ...(note ? { note } : {}) };
    await api.post(`${PROBLEMS_BASE}/${id}/incidents`, body);
  },

  /**
   * Unlink an incident from a problem.
   */
  unlinkIncident: async (id: string, incidentId: string): Promise<void> => {
    await api.delete(`${PROBLEMS_BASE}/${id}/incidents/${incidentId}`);
  },

  /**
   * Update RCA information.
   */
  updateRCA: async (id: string, input: UpdateRCAInput): Promise<ProblemDetail> =>
    (await api.post<ApiEnvelope<ProblemDetail>>(`${PROBLEMS_BASE}/${id}/rca`, input)).data.data,

  /**
   * Set workaround on a problem.
   */
  setWorkaround: async (id: string, workaround: string): Promise<ProblemDetail> =>
    (await api.post<ApiEnvelope<ProblemDetail>>(`${PROBLEMS_BASE}/${id}/workaround`, { workaround })).data.data,

  /**
   * Link a change request to a problem.
   */
  linkChangeRequest: async (id: string, changeId: string): Promise<ProblemDetail> =>
    (await api.post<ApiEnvelope<ProblemDetail>>(`${PROBLEMS_BASE}/${id}/changes`, { changeId })).data.data,

  /**
   * Unlink a change request from a problem.
   */
  unlinkChangeRequest: async (id: string, changeId: string): Promise<ProblemDetail> =>
    (await api.delete<ApiEnvelope<ProblemDetail>>(`${PROBLEMS_BASE}/${id}/changes/${changeId}`)).data.data,

  /**
   * Get audit log for a problem.
   */
  getAuditLog: async (id: string, query: GetAuditLogQuery = {}): Promise<ProblemAuditLog[]> => {
    const params = new URLSearchParams();
    if (query.page) params.set('page', String(query.page));
    if (query.limit) params.set('limit', String(query.limit));
    const res = await api.get<ApiEnvelope<ProblemAuditLog[]>>(`${PROBLEMS_BASE}/${id}/audit?${params.toString()}`);
    return res.data.data;
  },

  /**
   * Detect problem patterns from incidents. The response body is the whole
   * `{ data, meta }` envelope, because the two query modes answer with
   * different shapes — see `DetectionResponse`.
   */
  detect: async (query: DetectQuery = {}): Promise<DetectionResponse> => {
    const params = new URLSearchParams();
    if (query.incidentId) params.set('incidentId', query.incidentId);
    if (query.windowHours) params.set('windowHours', String(query.windowHours));
    if (query.threshold) params.set('threshold', String(query.threshold));
    const res = await api.get<DetectionResponse>(`${PROBLEMS_BASE}/detect?${params.toString()}`);
    return res.data;
  },

  /**
   * Create a problem from one or more incidents. Returns the bare row the
   * detection engine created — re-fetch via `get(id)` for relations.
   */
  createFromIncidents: async (incidentIds: string[]): Promise<ProblemRecord> => {
    const body: CreateFromIncidentsInput = { incidentIds };
    return (await api.post<ApiEnvelope<ProblemRecord>>(`${PROBLEMS_BASE}/from-incidents`, body)).data.data;
  },

  /**
   * Get similar problems.
   */
  getSimilar: async (id: string, query: SimilarProblemsQuery = {}): Promise<SimilarProblemResult[]> => {
    const params = new URLSearchParams();
    if (query.threshold) params.set('threshold', String(query.threshold));
    const res = await api.get<ApiEnvelope<SimilarProblemResult[]>>(`${PROBLEMS_BASE}/${id}/similar?${params.toString()}`);
    return res.data.data;
  },

  // Known Errors
  /**
   * List known errors with pagination, filtering, and search.
   */
  listKnownErrors: async (query: ListKnownErrorsQuery = {}): Promise<Paged<KnownErrorSummary>> => {
    const params = new URLSearchParams();
    if (query.page) params.set('page', String(query.page));
    if (query.limit) params.set('limit', String(query.limit));
    if (query.sort) params.set('sort', query.sort);
    if (query.order) params.set('order', query.order);
    if (query.search) params.set('search', query.search);
    if (query.status) params.set('status', query.status);
    if (query.visibility) params.set('visibility', query.visibility);
    if (query.problemId) params.set('problemId', query.problemId);
    if (query.ownerId) params.set('ownerId', query.ownerId);

    const res = await api.get<Paged<KnownErrorSummary>>(`${KNOWN_ERRORS_BASE}?${params.toString()}`);
    return res.data;
  },

  /**
   * Search published known errors for workaround lookup.
   */
  searchKnownErrors: async (query: SearchKnownErrorsQuery = {}): Promise<KnownErrorSummary[]> => {
    const params = new URLSearchParams();
    if (query.q) params.set('q', query.q);
    if (query.visibility) params.set('visibility', query.visibility);
    if (query.limit) params.set('limit', String(query.limit));

    const res = await api.get<ApiEnvelope<KnownErrorSummary[]>>(`${KNOWN_ERRORS_BASE}/search?${params.toString()}`);
    return res.data.data;
  },

  /**
   * Get a known error with its problem and published-article links.
   */
  getKnownError: async (id: string): Promise<KnownError> =>
    (await api.get<ApiEnvelope<KnownError>>(`${KNOWN_ERRORS_BASE}/${id}`)).data.data,

  /**
   * Create a known error from a problem.
   */
  createKnownError: async (input: CreateKnownErrorInput): Promise<KnownError> =>
    (await api.post<ApiEnvelope<KnownError>>(KNOWN_ERRORS_BASE, input)).data.data,

  /**
   * Update known error content.
   */
  updateKnownError: async (id: string, input: UpdateKnownErrorInput): Promise<KnownError> =>
    (await api.patch<ApiEnvelope<KnownError>>(`${KNOWN_ERRORS_BASE}/${id}`, input)).data.data,

  /**
   * Transition known error status (requires approval).
   */
  transitionKnownErrorStatus: async (
    id: string,
    status: KnownErrorStatus,
    extra: Omit<TransitionKnownErrorInput, 'status'> = {},
  ): Promise<KnownError> =>
    (await api.post<ApiEnvelope<KnownError>>(`${KNOWN_ERRORS_BASE}/${id}/status`, { status, ...extra })).data.data,

  /**
   * Publish the workaround to the knowledge base.
   */
  publishKnownErrorKB: async (id: string, input: PublishKnownErrorInput = {}): Promise<KnownError> =>
    (await api.post<ApiEnvelope<KnownError>>(`${KNOWN_ERRORS_BASE}/${id}/publish-kb`, input)).data.data,
};

/* ── Query Keys ─────────────────────────────────────────────────────────────── */

export const problemKeys = {
  all: ['problems'] as const,
  lists: () => [...problemKeys.all, 'list'] as const,
  list: (query: ListProblemsQuery) => [...problemKeys.lists(), query] as const,
  details: () => [...problemKeys.all, 'detail'] as const,
  detail: (id: string) => [...problemKeys.details(), id] as const,
  audit: (id: string, query: GetAuditLogQuery) => [...problemKeys.detail(id), 'audit', query] as const,
  detect: (query: DetectQuery) => [...problemKeys.all, 'detect', query] as const,
  similar: (id: string, query: SimilarProblemsQuery) => [...problemKeys.detail(id), 'similar', query] as const,
  knownErrors: {
    all: ['known-errors'] as const,
    lists: () => [...problemKeys.knownErrors.all, 'list'] as const,
    list: (query: ListKnownErrorsQuery) => [...problemKeys.knownErrors.lists(), query] as const,
    details: () => [...problemKeys.knownErrors.all, 'detail'] as const,
    detail: (id: string) => [...problemKeys.knownErrors.details(), id] as const,
    search: (query: SearchKnownErrorsQuery) => [...problemKeys.knownErrors.all, 'search', query] as const,
  },
};

/* ── TanStack Query Hooks ───────────────────────────────────────────────────── */

export function useProblems(
  query: ListProblemsQuery = {},
  options?: Omit<UseQueryOptions<Paged<ProblemSummary>>, 'queryKey' | 'queryFn'>
) {
  return useQuery({
    queryKey: problemKeys.list(query),
    queryFn: () => problemApi.list(query),
    ...options,
  });
}

export function useProblem(
  id: string,
  options?: Omit<UseQueryOptions<ProblemDetail>, 'queryKey' | 'queryFn'>
) {
  return useQuery({
    queryKey: problemKeys.detail(id),
    queryFn: () => problemApi.get(id),
    enabled: !!id,
    ...options,
  });
}

export function useKnownErrors(
  query: ListKnownErrorsQuery = {},
  options?: Omit<UseQueryOptions<Paged<KnownErrorSummary>>, 'queryKey' | 'queryFn'>
) {
  return useQuery({
    queryKey: problemKeys.knownErrors.list(query),
    queryFn: () => problemApi.listKnownErrors(query),
    ...options,
  });
}

export function useKnownError(
  id: string,
  options?: Omit<UseQueryOptions<KnownError>, 'queryKey' | 'queryFn'>
) {
  return useQuery({
    queryKey: problemKeys.knownErrors.detail(id),
    queryFn: () => problemApi.getKnownError(id),
    enabled: !!id,
    ...options,
  });
}

/* ── Helpers ────────────────────────────────────────────────────────────────── */

export function getProblemStatusBadgeClass(status: ProblemStatus): string {
  switch (status) {
    case 'IDENTIFIED':
      return 'bg-gray-500/10 text-gray-700 dark:text-gray-400';
    case 'INVESTIGATION':
      return 'bg-blue-500/10 text-blue-700 dark:text-blue-400';
    case 'ROOT_CAUSE_KNOWN':
      return 'bg-purple-500/10 text-purple-700 dark:text-purple-400';
    case 'WORKAROUND_DOCUMENTED':
      return 'bg-amber-500/10 text-amber-700 dark:text-amber-400';
    case 'PENDING_CHANGE':
      return 'bg-orange-500/10 text-orange-700 dark:text-orange-400';
    case 'RESOLVED':
      return 'bg-green-500/10 text-green-700 dark:text-green-400';
    case 'CLOSED':
      return 'bg-slate-500/10 text-slate-700 dark:text-slate-400';
  }
}

export function getKnownErrorStatusBadgeClass(status: KnownErrorStatus): string {
  switch (status) {
    case 'DRAFT':
      return 'bg-gray-500/10 text-gray-700 dark:text-gray-400';
    case 'UNDER_REVIEW':
      return 'bg-yellow-500/10 text-yellow-700 dark:text-yellow-400';
    case 'PUBLISHED':
      return 'bg-green-500/10 text-green-700 dark:text-green-400';
    case 'RETIRED':
      return 'bg-red-500/10 text-red-700 dark:text-red-400';
  }
}

/**
 * Problem numbers arrive from the server already display-ready
 * (`PRB-YYYY-NNNNNN`), so this normalizes rather than prefixes — prepending
 * `PRB-` here would render `PRB-PRB-2026-000001`. It exists so the UI has one
 * place to change how a number is shown.
 */
export function formatProblemNumber(number: string | null | undefined): string {
  return number?.trim() || '—';
}
