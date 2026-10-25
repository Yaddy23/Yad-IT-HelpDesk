import { api } from './api';

/* Types mirroring the administration endpoints (users, org, audit). */

export type Role = 'super_admin' | 'it_admin' | 'it_manager' | 'it_technician' | 'employee' | 'approver';

export const ROLE_LABELS: Record<Role, string> = {
  super_admin: 'Super admin',
  it_admin: 'IT admin',
  it_manager: 'IT manager',
  it_technician: 'IT technician',
  employee: 'Employee',
  approver: 'Approver',
};

export const ROLES = Object.keys(ROLE_LABELS) as Role[];

/** The list endpoints page flat: `{ data, page, pages, total }`. */
export interface Paged<T> {
  data: T[];
  page: number;
  pages: number;
  total: number;
}

export interface OrgRef {
  id: string;
  name: string;
  code: string;
}

/* ── Users ────────────────────────────────────────────────────────────────── */

export interface AdminUser {
  id: string;
  email: string;
  name: string;
  active: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  roles: Role[];
  employee: {
    id: string;
    employeeId: string;
    name: string;
    jobTitle: string | null;
    departmentId: string | null;
    locationId: string | null;
    managerId?: string | null;
    employmentStatus?: string;
  } | null;
}

export interface UserFormInput {
  email?: string;
  name?: string;
  password?: string;
  roles?: Role[];
  jobTitle?: string;
  departmentId?: string;
  locationId?: string;
  managerEmployeeId?: string;
  active?: boolean;
}

export interface UserOptions {
  departments: OrgRef[];
  locations: OrgRef[];
  /** `id` is the Employee id; `userId` is the linked login account (null if none). */
  employees: { id: string; employeeId: string; name: string; userId: string | null }[];
}

export const usersApi = {
  async list(params: { page?: number; limit?: number; role?: string; q?: string }): Promise<Paged<AdminUser>> {
    const res = await api.get<Paged<AdminUser>>('/users', { params });
    return res.data;
  },
  async create(input: UserFormInput & { email: string; name: string; password: string; roles: Role[] }): Promise<AdminUser> {
    const res = await api.post<{ data: AdminUser }>('/users', input);
    return res.data.data;
  },
  async update(id: string, input: UserFormInput): Promise<AdminUser> {
    const res = await api.patch<{ data: AdminUser }>(`/users/${id}`, input);
    return res.data.data;
  },
  async resetPassword(id: string, newPassword: string): Promise<void> {
    await api.post(`/users/${id}/password`, { newPassword });
  },
  async options(): Promise<UserOptions> {
    const res = await api.get<{ data: UserOptions }>('/users/options');
    return res.data.data;
  },
};

/* ── Organization ─────────────────────────────────────────────────────────── */

export interface Department {
  id: string;
  name: string;
  code: string;
  timezone: string;
  active: boolean;
  manager: { id: string; name: string; employeeId: string } | null;
  officeLocation: { id: string; name: string; code: string } | null;
  supportGroup: { id: string; name: string; code: string } | null;
}

export interface Location {
  id: string;
  name: string;
  code: string;
  address: string | null;
  timezone: string;
  active: boolean;
}

export interface AssignmentGroup {
  id: string;
  name: string;
  code: string;
  description: string | null;
  active: boolean;
  manager: { id: string; name: string; email: string } | null;
  members: { id: string; user: { id: string; name: string; email: string } }[];
}

export interface OrgOptions {
  employees: { id: string; employeeId: string; name: string }[];
  departments: OrgRef[];
  locations: OrgRef[];
  supportGroups: OrgRef[];
  users: { id: string; name: string; email: string }[];
}

export interface DepartmentInput {
  name: string;
  code: string;
  managerId?: string;
  officeLocationId?: string;
  supportGroupId?: string;
  timezone?: string;
  active?: boolean;
}

export interface LocationInput {
  name: string;
  code: string;
  address?: string;
  timezone?: string;
  active?: boolean;
}

export interface GroupInput {
  name: string;
  code: string;
  description?: string;
  managerId?: string;
  memberIds?: string[];
  active?: boolean;
}

export const orgApi = {
  async options(): Promise<OrgOptions> {
    const res = await api.get<{ data: OrgOptions }>('/org/options');
    return res.data.data;
  },
  departments: {
    async list(params: { page?: number; q?: string }): Promise<Paged<Department>> {
      const res = await api.get<Paged<Department>>('/departments', { params });
      return res.data;
    },
    async create(input: DepartmentInput): Promise<Department> {
      const res = await api.post<{ data: Department }>('/departments', input);
      return res.data.data;
    },
    async update(id: string, input: Partial<DepartmentInput>): Promise<Department> {
      const res = await api.patch<{ data: Department }>(`/departments/${id}`, input);
      return res.data.data;
    },
  },
  locations: {
    async list(params: { page?: number; q?: string }): Promise<Paged<Location>> {
      const res = await api.get<Paged<Location>>('/locations', { params });
      return res.data;
    },
    async create(input: LocationInput): Promise<Location> {
      const res = await api.post<{ data: Location }>('/locations', input);
      return res.data.data;
    },
    async update(id: string, input: Partial<LocationInput>): Promise<Location> {
      const res = await api.patch<{ data: Location }>(`/locations/${id}`, input);
      return res.data.data;
    },
  },
  groups: {
    async list(params: { page?: number; q?: string }): Promise<Paged<AssignmentGroup>> {
      const res = await api.get<Paged<AssignmentGroup>>('/groups', { params });
      return res.data;
    },
    async create(input: GroupInput): Promise<AssignmentGroup> {
      const res = await api.post<{ data: AssignmentGroup }>('/groups', input);
      return res.data.data;
    },
    async update(id: string, input: Partial<GroupInput>): Promise<AssignmentGroup> {
      const res = await api.patch<{ data: AssignmentGroup }>(`/groups/${id}`, input);
      return res.data.data;
    },
  },
};

/* ── Audit trail ──────────────────────────────────────────────────────────── */

export interface AuditEntry {
  id: string;
  actorId: string | null;
  actorEmail: string | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  before: unknown;
  after: unknown;
  meta: unknown;
  ip: string | null;
  createdAt: string;
  actor: { id: string; name: string; email: string } | null;
}

export const auditApi = {
  async list(params: {
    page?: number;
    limit?: number;
    action?: string;
    actorId?: string;
    targetType?: string;
  }): Promise<Paged<AuditEntry>> {
    const res = await api.get<Paged<AuditEntry>>('/audit', { params });
    return res.data;
  },
};
