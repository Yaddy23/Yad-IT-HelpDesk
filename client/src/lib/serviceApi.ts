import { api, type ApiEnvelope } from './api';

/* ── Types ────────────────────────────────────────────────────────────────── */

export type SrStatus =
  | 'pending_approval'
  | 'info_requested'
  | 'in_fulfillment'
  | 'fulfilled'
  | 'rejected'
  | 'canceled';

export type FormFieldType = 'text' | 'textarea' | 'number' | 'date' | 'select' | 'checkbox';

export interface FormField {
  name: string;
  label: string;
  type: FormFieldType;
  required?: boolean;
  options?: string[];
  help?: string;
}

export interface Eligibility {
  departments?: string[];
  locations?: string[];
  roles?: string[];
}

export interface ApprovalRule {
  id: string;
  name: string;
  active: boolean;
  steps: ApprovalStep[];
}

export interface CatalogItem {
  id: string;
  name: string;
  description?: string | null;
  category?: string | null;
  icon?: string | null;
  sortOrder: number;
  active: boolean;
  eligibility?: Eligibility | null;
  formSchema: FormField[];
  approvalRule?: ApprovalRule | null;
}

export interface ApprovalStep {
  name: string;
  mode: 'single' | 'all' | 'any' | 'sequential';
  approver: { type: 'user' | 'manager' | 'role'; value?: string };
  deadlineHours?: number;
  deadlineAt?: string;
  candidates: string[];
  skipped: boolean;
  skipNote?: string;
}

export interface ApprovalDecision {
  id: string;
  stepIndex: number;
  decision: 'approved' | 'rejected' | 'info_requested';
  reason?: string | null;
  createdAt: string;
  approver: { id: string; name: string; email: string };
}

export interface ServiceRequest {
  id: string;
  number: string;
  status: SrStatus;
  answers: Record<string, unknown>;
  infoRequests?: Array<{ round: number; note: string; at: string; by: string }> | null;
  rejectionReason?: string | null;
  fulfilledAt?: string | null;
  fulfillNote?: string | null;
  createdAt: string;
  updatedAt: string;
  catalogItem: { id: string; name: string; category?: string | null; icon?: string | null };
  requester: { id: string; employeeId?: string; name: string; email: string };
  approval?: {
    id: string;
    status: 'pending' | 'approved' | 'rejected' | 'canceled';
    currentStep: number;
    steps: ApprovalStep[];
    decidedAt?: string | null;
    decisions?: ApprovalDecision[];
  } | null;
}

export interface QueueEntry {
  id: string;
  stepIndex: number;
  stepName: string;
  mode: ApprovalStep['mode'];
  deadlineAt: string | null;
  createdAt: string;
  target: {
    id: string;
    number: string;
    status: SrStatus;
    answers: Record<string, unknown>;
    infoRequests?: Array<{ round: number; note: string; at: string; by: string }> | null;
    rejectionReason?: string | null;
    catalogItem: { id: string; name: string; category?: string | null };
    requester: { id: string; name: string; email: string };
  } | null;
}

/* ── Catalog ──────────────────────────────────────────────────────────────── */

export const catalogApi = {
  list: async (): Promise<CatalogItem[]> => (await api.get<ApiEnvelope<CatalogItem[]>>('/catalog')).data.data,
  get: async (id: string): Promise<CatalogItem> => (await api.get<ApiEnvelope<CatalogItem>>(`/catalog/${id}`)).data.data,
  create: (body: Partial<CatalogItem>) => api.post<ApiEnvelope<CatalogItem>>('/catalog', body),
  update: (id: string, body: Partial<CatalogItem>) => api.patch<ApiEnvelope<CatalogItem>>(`/catalog/${id}`, body),
  saveRule: (id: string, body: { name?: string; steps: unknown[]; active?: boolean }) =>
    api.put<ApiEnvelope<{ id: string }>>(`/catalog/${id}/rule`, body),
  deleteRule: (id: string) => api.delete(`/catalog/${id}/rule`),
};

/* ── Service requests ─────────────────────────────────────────────────────── */

export const requestsApi = {
  list: async (query: { status?: string; mine?: boolean; queue?: 'open' | 'fulfillment' } = {}): Promise<ServiceRequest[]> => {
    const res = await api.get<ApiEnvelope<ServiceRequest[]>>('/service-requests', { params: query });
    return res.data.data;
  },
  get: async (id: string): Promise<ServiceRequest> => (await api.get<ApiEnvelope<ServiceRequest>>(`/service-requests/${id}`)).data.data,
  create: async (catalogItemId: string, answers: Record<string, unknown>): Promise<ServiceRequest> =>
    (await api.post<ApiEnvelope<ServiceRequest>>('/service-requests', { catalogItemId, answers })).data.data,
  addInfo: (id: string, note: string) => api.post<ApiEnvelope<ServiceRequest>>(`/service-requests/${id}/info`, { note }),
  cancel: (id: string) => api.post<ApiEnvelope<ServiceRequest>>(`/service-requests/${id}/cancel`, {}),
  fulfill: (id: string, note?: string) => api.post<ApiEnvelope<ServiceRequest>>(`/service-requests/${id}/fulfill`, { note }),
};

/* ── Org options (eligibility pickers; requires org:manage, held by every catalog:manage role) ── */

export interface OrgOptions {
  departments: Array<{ id: string; name: string; code: string }>;
  locations: Array<{ id: string; name: string }>;
}

export const orgOptionsApi = {
  get: async (): Promise<OrgOptions> => {
    const res = await api.get<ApiEnvelope<OrgOptions>>('/org/options');
    return { departments: res.data.data.departments ?? [], locations: res.data.data.locations ?? [] };
  },
};

/* ── Approvals ────────────────────────────────────────────────────────────── */

export const approvalsApi = {
  queue: async (): Promise<QueueEntry[]> => (await api.get<ApiEnvelope<QueueEntry[]>>('/approvals/queue')).data.data,
  detail: async (id: string): Promise<ServiceRequest['approval'] & { id: string }> =>
    (await api.get<ApiEnvelope<ServiceRequest['approval'] & { id: string }>>(`/approvals/${id}`)).data.data,
  decide: (id: string, body: { stepIndex: number; decision: 'approved' | 'rejected' | 'info_requested'; reason?: string }) =>
    api.post<ApiEnvelope<{ settled: boolean }>>(`/approvals/${id}/decide`, body),
  delegate: (id: string, body: { stepIndex: number; delegateUserId: string }) =>
    api.post<ApiEnvelope<{ id: string }>>(`/approvals/${id}/delegate`, body),
  delegates: async (): Promise<Array<{ id: string; name: string; email: string }>> =>
    (await api.get<ApiEnvelope<Array<{ id: string; name: string; email: string }>>>('/approvals/delegates')).data.data,
};

