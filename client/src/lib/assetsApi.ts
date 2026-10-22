import { api } from './api';

/* Types mirroring the server's asset/inventory/license/audit JSON payloads. */

export type AssetCategory = 'hardware' | 'mobile' | 'peripheral' | 'network' | 'appliance' | 'other';
export type AssetStatus = 'in_stock' | 'deployed' | 'in_repair' | 'in_maintenance' | 'retired' | 'lost';

export interface Asset {
  id: string;
  number: string;
  name: string;
  category: AssetCategory;
  manufacturer: string | null;
  model: string | null;
  serialNumber: string | null;
  status: AssetStatus;
  purchasedAt: string | null;
  purchaseCost: number | null;
  warrantyExpiry: string | null;
  notes: string | null;
  custodian: { id: string; employeeId: string; name: string } | null;
  location: { id: string; name: string } | null;
  department: { id: string; name: string } | null;
  vendor: { id: string; name: string } | null;
  createdAt: string;
  updatedAt: string;
}

export interface AssetAssignment {
  id: string;
  assetId: string;
  asset?: { id: string; number: string; name: string; category: string; status: string };
  status: 'active' | 'returned';
  assignedAt: string;
  dueAt: string | null;
  returnedAt: string | null;
  acknowledgedAt: string | null;
  note: string | null;
  returnNote: string | null;
  employee: { id: string; employeeId: string; name: string };
  assignedBy: { id: string; name: string };
}

export interface MaintenanceSchedule {
  id: string;
  assetId: string;
  name: string;
  intervalDays: number;
  active: boolean;
  nextDueAt: string;
  lastCompletedAt: string | null;
}

export interface MaintenanceRecord {
  id: string;
  assetId: string;
  type: 'preventive' | 'repair' | 'inspection' | 'upgrade';
  summary: string;
  cost: number | null;
  performedAt: string;
  performedBy: string | null;
  vendor: { id: string; name: string } | null;
  createdBy: { id: string; name: string };
}

export type WarrantyClaimStatus = 'open' | 'submitted' | 'approved' | 'rejected' | 'resolved';

export interface WarrantyClaim {
  id: string;
  assetId: string;
  issue: string;
  status: WarrantyClaimStatus;
  resolution: string | null;
  resolvedAt: string | null;
  vendor: { id: string; name: string } | null;
  createdBy: { id: string; name: string };
  createdAt: string;
}

export interface AssetDetailData extends Asset {
  assignments: AssetAssignment[];
  maintenanceRecords: MaintenanceRecord[];
  maintenanceSchedules: MaintenanceSchedule[];
  warrantyClaims: WarrantyClaim[];
}

export interface ListMeta {
  total: number;
  page: number;
  limit: number;
  pages: number;
}

export interface Vendor {
  id: string;
  name: string;
  contact: string | null;
  email: string | null;
  phone: string | null;
  active: boolean;
}

export interface InventoryItem {
  id: string;
  name: string;
  sku: string | null;
  category: string | null;
  unit: string;
  quantity: number;
  reorderPoint: number;
  unitCost: number | null;
  location: { id: string; name: string } | null;
}

export interface StockMovement {
  id: string;
  itemId: string;
  type: 'in' | 'out' | 'adjust';
  delta: number;
  resultingQuantity: number;
  reason: string;
  createdAt: string;
  createdBy: { id: string; name: string };
}

export type LicenseType = 'perpetual' | 'subscription' | 'oem' | 'volume';

export interface SoftwareLicense {
  id: string;
  name: string;
  licenseKey: string | null;
  type: LicenseType;
  seats: number;
  seatsInUse: number;
  expiresAt: string | null;
  cost: number | null;
  vendor: { id: string; name: string } | null;
}

export interface LicenseAssignment {
  id: string;
  licenseId: string;
  status: 'active' | 'returned';
  assignedAt: string;
  returnedAt: string | null;
  note: string | null;
  license?: { id: string; name: string; seats: number };
  employee: { id: string; employeeId: string; name: string; email: string };
  assignedBy: { id: string; name: string };
}

export interface AuditSession {
  id: string;
  name: string;
  status: 'open' | 'closed';
  scopeType: string | null;
  startedAt: string;
  closedAt: string | null;
  startedBy: { id: string; name: string };
  closedBy?: { id: string; name: string } | null;
  itemCount?: number;
  items?: AuditItem[];
  counts?: { found: number; missing: number; unexpected: number; unchecked: number };
}

export interface AuditItem {
  id: string;
  assetId: string;
  status: 'found' | 'missing' | 'unexpected' | null;
  note: string | null;
  checkedAt: string | null;
  checkedBy: { id: string; name: string } | null;
  asset: { id: string; number: string; name: string; status: string };
}

export interface EmployeeOption {
  id: string;
  employeeId: string;
  name: string;
  email: string;
}

const isoDate = (d: Date) => d.toISOString();

export const assetsApi = {
  async list(params: { q?: string; status?: string; category?: string; page?: number }): Promise<{ data: Asset[]; meta: ListMeta }> {
    const res = await api.get<{ data: Asset[]; meta: ListMeta }>('/assets', { params });
    return res.data;
  },
  async get(id: string): Promise<AssetDetailData> {
    const res = await api.get<{ data: AssetDetailData }>(`/assets/${id}`);
    return res.data.data;
  },
  async create(input: Record<string, unknown>): Promise<Asset> {
    const res = await api.post<{ data: Asset }>('/assets', input);
    return res.data.data;
  },
  async transition(id: string, status: AssetStatus, reason?: string): Promise<Asset> {
    const res = await api.post<{ data: Asset }>(`/assets/${id}/transition`, { status, reason });
    return res.data.data;
  },
  async assign(id: string, input: { employeeId: string; note?: string; dueAt?: string }): Promise<AssetAssignment> {
    const res = await api.post<{ data: AssetAssignment }>(`/assets/${id}/assignments`, input);
    return res.data.data;
  },
  async assignments(params: { employeeId?: string; assetId?: string; active?: boolean; page?: number }): Promise<{ data: AssetAssignment[]; meta: ListMeta }> {
    const res = await api.get<{ data: AssetAssignment[]; meta: ListMeta }>('/assets/assignments', { params });
    return res.data;
  },
  async myAssignments(): Promise<AssetAssignment[]> {
    const res = await api.get<{ data: AssetAssignment[] }>('/assets/assignments/my');
    return res.data.data;
  },
  async acknowledge(assignmentId: string): Promise<AssetAssignment> {
    const res = await api.post<{ data: AssetAssignment }>(`/assets/assignments/${assignmentId}/acknowledge`);
    return res.data.data;
  },
  async returnAssignment(assignmentId: string, note?: string): Promise<AssetAssignment> {
    const res = await api.post<{ data: AssetAssignment }>(`/assets/assignments/${assignmentId}/return`, note ? { note } : {});
    return res.data.data;
  },
  async employees(): Promise<EmployeeOption[]> {
    const res = await api.get<{ data: EmployeeOption[] }>('/users', { params: { limit: 100 } });
    return (res.data.data as (EmployeeOption & { employee?: { id: string; employeeId: string } | null })[])
      .filter((u) => u.employee)
      .map((u) => ({ id: u.employee!.id, employeeId: u.employee!.employeeId, name: u.name, email: u.email }));
  },
  async vendors(): Promise<Vendor[]> {
    const res = await api.get<{ data: Vendor[] }>('/vendors');
    return res.data.data;
  },

  // Maintenance & warranty
  async allSchedules(params: { dueWithinDays?: number; page?: number }): Promise<{ data: (MaintenanceSchedule & { asset: { id: string; number: string; name: string; status: string } })[]; meta: ListMeta }> {
    const res = await api.get<{ data: (MaintenanceSchedule & { asset: { id: string; number: string; name: string; status: string } })[]; meta: ListMeta }>('/assets/maintenance/schedules', { params });
    return res.data;
  },
  async allRecords(params: { type?: string; page?: number }): Promise<{ data: (MaintenanceRecord & { asset: { id: string; number: string; name: string } })[]; meta: ListMeta }> {
    const res = await api.get<{ data: (MaintenanceRecord & { asset: { id: string; number: string; name: string } })[]; meta: ListMeta }>('/assets/maintenance/records', { params });
    return res.data;
  },
  async allClaims(params: { status?: string; page?: number }): Promise<{ data: (WarrantyClaim & { asset: { id: string; number: string; name: string } })[]; meta: ListMeta }> {
    const res = await api.get<{ data: (WarrantyClaim & { asset: { id: string; number: string; name: string } })[]; meta: ListMeta }>('/assets/warranty-claims', { params });
    return res.data;
  },
  async addSchedule(assetId: string, input: { name: string; intervalDays: number; firstDueAt?: string }): Promise<MaintenanceSchedule> {
    const res = await api.post<{ data: MaintenanceSchedule }>(`/assets/${assetId}/schedules`, input);
    return res.data.data;
  },
  async completeSchedule(scheduleId: string, input: { summary: string; cost?: number }): Promise<{ record: MaintenanceRecord; schedule: MaintenanceSchedule }> {
    const res = await api.post<{ data: { record: MaintenanceRecord; schedule: MaintenanceSchedule } }>(`/assets/schedules/${scheduleId}/complete`, input);
    return res.data.data;
  },
  async addMaintenanceRecord(assetId: string, input: { type: string; summary: string; cost?: number; vendorId?: string; performedBy?: string }): Promise<MaintenanceRecord> {
    const res = await api.post<{ data: MaintenanceRecord }>(`/assets/${assetId}/maintenance`, input);
    return res.data.data;
  },
  async addWarrantyClaim(assetId: string, input: { issue: string; vendorId?: string }): Promise<WarrantyClaim> {
    const res = await api.post<{ data: WarrantyClaim }>(`/assets/${assetId}/warranty-claims`, input);
    return res.data.data;
  },
  async updateWarrantyClaim(claimId: string, input: { status?: WarrantyClaimStatus; resolution?: string }): Promise<WarrantyClaim> {
    const res = await api.patch<{ data: WarrantyClaim }>(`/assets/warranty-claims/${claimId}`, input);
    return res.data.data;
  },

  // Inventory
  async inventory(params: { q?: string; lowStock?: boolean; page?: number }): Promise<{ data: InventoryItem[]; meta: ListMeta }> {
    const res = await api.get<{ data: InventoryItem[]; meta: ListMeta }>('/inventory', { params });
    return res.data;
  },
  async createItem(input: { name: string; sku?: string; unit?: string; reorderPoint?: number; unitCost?: number; initialQuantity?: number }): Promise<InventoryItem> {
    const res = await api.post<{ data: InventoryItem }>('/inventory', input);
    return res.data.data;
  },
  async movements(itemId: string, page = 1): Promise<{ data: StockMovement[]; meta: ListMeta }> {
    const res = await api.get<{ data: StockMovement[]; meta: ListMeta }>(`/inventory/${itemId}/movements`, { params: { page } });
    return res.data;
  },
  async moveStock(itemId: string, input: { type: 'in' | 'out' | 'adjust'; delta?: number; resultingQuantity?: number; reason: string }): Promise<StockMovement> {
    const res = await api.post<{ data: StockMovement }>(`/inventory/${itemId}/movements`, input);
    return res.data.data;
  },

  // Licenses
  async licenses(params: { q?: string; page?: number }): Promise<{ data: SoftwareLicense[]; meta: ListMeta }> {
    const res = await api.get<{ data: SoftwareLicense[]; meta: ListMeta }>('/licenses', { params });
    return res.data;
  },
  async createLicense(input: { name: string; seats: number; type?: LicenseType; licenseKey?: string; expiresAt?: string }): Promise<SoftwareLicense> {
    const res = await api.post<{ data: SoftwareLicense }>('/licenses', input);
    return res.data.data;
  },
  async licenseDetail(id: string): Promise<SoftwareLicense & { assignments: LicenseAssignment[] }> {
    const res = await api.get<{ data: SoftwareLicense & { assignments: LicenseAssignment[] } }>(`/licenses/${id}`);
    return res.data.data;
  },
  async assignSeat(licenseId: string, employeeId: string, note?: string): Promise<LicenseAssignment> {
    const res = await api.post<{ data: LicenseAssignment }>(`/licenses/${licenseId}/assignments`, { employeeId, note });
    return res.data.data;
  },
  async returnSeat(assignmentId: string, note?: string): Promise<LicenseAssignment> {
    const res = await api.post<{ data: LicenseAssignment }>(`/licenses/assignments/${assignmentId}/return`, note ? { note } : {});
    return res.data.data;
  },

  // Audits
  async audits(params: { status?: string; page?: number }): Promise<{ data: AuditSession[]; meta: ListMeta }> {
    const res = await api.get<{ data: AuditSession[]; meta: ListMeta }>('/asset-audits', { params });
    return res.data;
  },
  async createAudit(name: string, scopeType: 'all' | 'location' | 'department'): Promise<AuditSession> {
    const res = await api.post<{ data: AuditSession }>('/asset-audits', { name, scopeType });
    return res.data.data;
  },
  async auditDetail(id: string): Promise<AuditSession> {
    const res = await api.get<{ data: AuditSession }>(`/asset-audits/${id}`);
    return res.data.data;
  },
  async markAuditItem(sessionId: string, assetId: string, status: 'found' | 'missing' | 'unexpected', note?: string): Promise<AuditItem> {
    const res = await api.post<{ data: AuditItem }>(`/asset-audits/${sessionId}/items`, { assetId, status, note });
    return res.data.data;
  },
  async closeAudit(id: string): Promise<AuditSession> {
    const res = await api.post<{ data: AuditSession }>(`/asset-audits/${id}/close`);
    return res.data.data;
  },

  // Shared helpers
  nowIso: isoDate,
};

export const ASSET_STATUS_LABELS: Record<AssetStatus, string> = {
  in_stock: 'In stock',
  deployed: 'Deployed',
  in_repair: 'In repair',
  in_maintenance: 'In maintenance',
  retired: 'Retired',
  lost: 'Lost',
};

export const CATEGORY_LABELS: Record<AssetCategory, string> = {
  hardware: 'Hardware',
  mobile: 'Mobile',
  peripheral: 'Peripheral',
  network: 'Network',
  appliance: 'Appliance',
  other: 'Other',
};
