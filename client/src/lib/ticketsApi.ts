import { api } from './api';

/* Types mirroring the server's ticket JSON payloads. */

export type TicketStatus =
  | 'new'
  | 'in_progress'
  | 'pending_employee'
  | 'pending_vendor'
  | 'resolved'
  | 'closed'
  | 'canceled';

export type Priority = 'low' | 'medium' | 'high' | 'critical';
export type ImpactUrgency = 'low' | 'medium' | 'high';

export interface TicketRef {
  id: string;
  employeeId: string;
  name: string;
  email: string;
  department?: { name: string } | null;
}

export interface Ticket {
  id: string;
  number: string;
  title: string;
  description: string;
  category: string;
  status: TicketStatus;
  impact: ImpactUrgency;
  urgency: ImpactUrgency;
  priority: Priority;
  priorityOverrideReason: string | null;
  resolutionNote: string | null;
  resolvedAt: string | null;
  closedAt: string | null;
  reopenedCount: number;
  version: number;
  createdAt: string;
  updatedAt: string;
  requester: TicketRef;
  assignee: TicketRef | null;
  group: { id: string; name: string; code: string } | null;
  commentCount?: number;
}

export interface TicketComment {
  id: string;
  body: string;
  isInternal: boolean;
  createdAt: string;
  author: { id: string; name: string };
}

export interface TicketActivity {
  id: string;
  action: string;
  detail: Record<string, unknown> | null;
  createdAt: string;
  actor: { id: string; name: string } | null;
}

export interface TicketAssignmentRecord {
  id: string;
  note: string | null;
  createdAt: string;
  assignee: { id: string; employeeId: string; name: string } | null;
  group: { id: string; name: string } | null;
  assignedBy: { id: string; name: string };
}

export interface TicketAttachment {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
  uploadedBy: { id: string; name: string };
}

export interface SlaIndicator {
  id: string;
  policyName: string;
  type: 'response' | 'resolution';
  state: 'within' | 'approaching' | 'breached' | 'paused' | 'met' | 'missed';
  targetMins: number | null;
  elapsedMins: number;
  deadlineAt: string | null;
}

export interface TicketDetailData extends Ticket {
  comments: TicketComment[];
  activities: TicketActivity[];
  assignments: TicketAssignmentRecord[];
  attachments: TicketAttachment[];
  sla?: SlaIndicator[];
}

export interface TicketListMeta {
  total: number;
  page: number;
  limit: number;
  pages: number;
}

export type Queue = 'all' | 'unassigned' | 'my' | 'mine';

export interface TicketListParams {
  queue?: Queue;
  status?: string;
  priority?: string;
  q?: string;
  sla?: 'at_risk';
  page?: number;
  sort?: 'newest' | 'oldest' | 'priority';
}

export interface QueueCounts {
  open: number;
  unassigned: number;
  assignedToMe: number;
  slaAtRisk: number;
}

export interface UserOption {
  id: string;
  name: string;
  email: string;
  employee?: { id: string } | null;
}

export const ticketsApi = {
  async list(params: TicketListParams): Promise<{ data: Ticket[]; meta: TicketListMeta }> {
    const res = await api.get<{ data: Ticket[]; meta: TicketListMeta }>('/tickets', { params });
    return res.data;
  },
  async get(id: string): Promise<TicketDetailData> {
    const res = await api.get<{ data: TicketDetailData }>(`/tickets/${id}`);
    return res.data.data;
  },
  async create(input: {
    title: string;
    description: string;
    category: string;
    impact: ImpactUrgency;
    urgency: ImpactUrgency;
  }): Promise<Ticket> {
    const res = await api.post<{ data: Ticket }>('/tickets', input);
    return res.data.data;
  },
  async queues(): Promise<QueueCounts> {
    const res = await api.get<{ data: QueueCounts }>('/tickets/queues');
    return res.data.data;
  },
  async assign(id: string, input: { assigneeId?: string; note?: string }): Promise<Ticket> {
    const res = await api.post<{ data: Ticket }>(`/tickets/${id}/assign`, input);
    return res.data.data;
  },
  async transition(
    id: string,
    input: {
      status: 'in_progress' | 'pending_employee' | 'pending_vendor' | 'resolved' | 'closed' | 'canceled';
      resolutionNote?: string;
      version: number;
    },
  ): Promise<Ticket> {
    const res = await api.post<{ data: Ticket }>(`/tickets/${id}/transition`, input);
    return res.data.data;
  },
  async addComment(id: string, body: string, isInternal: boolean): Promise<TicketComment> {
    const res = await api.post<{ data: TicketComment }>(`/tickets/${id}/comments`, { body, isInternal });
    return res.data.data;
  },
  async overridePriority(
    id: string,
    input: { priority?: Priority; impact?: ImpactUrgency; urgency?: ImpactUrgency; reason: string },
  ): Promise<Ticket> {
    const res = await api.post<{ data: Ticket }>(`/tickets/${id}/priority`, input);
    return res.data.data;
  },
  async users(): Promise<UserOption[]> {
    const res = await api.get<{ data: UserOption[] }>('/users', { params: { limit: 100 } });
    return res.data.data;
  },
  async uploadAttachment(id: string, file: File): Promise<TicketAttachment> {
    const form = new FormData();
    form.append('file', file);
    const res = await api.post<{ data: TicketAttachment }>(`/tickets/${id}/attachments`, form);
    return res.data.data;
  },
  /** Fetches a fresh signed URL then triggers a browser download. */
  async downloadAttachment(id: string, attachmentId: string, filename: string): Promise<void> {
    const res = await api.get<{ data: { url: string } }>(`/tickets/${id}/attachments/${attachmentId}/download`);
    const link = document.createElement('a');
    link.href = res.data.data.url;
    link.download = filename;
    link.rel = 'noopener';
    document.body.appendChild(link);
    link.click();
    link.remove();
  },
};
