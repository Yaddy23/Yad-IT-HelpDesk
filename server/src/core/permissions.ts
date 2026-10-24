import type { Role } from '@prisma/client';

/**
 * Permission catalog. Format: `<domain>:<action>`. Super admins implicitly
 * hold every permission. Extend as modules land (tickets:*, assets:*, …).
 */
export const PERMISSIONS = {
  // administration
  'users:manage': 'Create, update and deactivate users and their roles',
  'org:manage': 'Manage departments, locations and assignment groups',
  'settings:manage': 'Change system settings (priority matrix, policies)',
  'audit:read': 'Read the audit trail',
  // service desk (used from Phase 2 onward)
  'tickets:create': 'Create tickets',
  'tickets:read': 'Read tickets within authorized scope',
  'tickets:update': 'Update tickets within authorized scope',
  'tickets:assign': 'Assign/reassign tickets',
  'tickets:resolve': 'Resolve tickets',
  'tickets:close': 'Close tickets',
  'tickets:worknotes': 'Add internal work notes',
  // approvals
  'approvals:decide': 'Act on approval requests',
  // service catalog (Phase 5)
  'catalog:manage': 'Manage the service catalog, its forms and approval rules',
  // assets (Phase 4)
  'assets:read': 'View assets and their history',
  'assets:create': 'Create assets and inventory/licenses/audit records',
  'assets:update': 'Update assets, lifecycle transitions, maintenance and warranty',
  'assets:assign': 'Assign/return assets, licenses and stock',
  // knowledge base (Phase 5)
  'kb:read': 'Search and read published knowledge articles',
  'kb:read_internal': 'Read internal (IT-only) knowledge articles',
  'kb:author': 'Create and edit knowledge articles and submit them for review',
  'kb:publish': 'Approve, publish, archive and restore knowledge articles',
} as const;

export type Permission = keyof typeof PERMISSIONS;

const EMPLOYEE_BASE: Permission[] = ['tickets:create', 'tickets:read', 'kb:read'];

export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  super_admin: Object.keys(PERMISSIONS) as Permission[],
  it_admin: [
    'org:manage',
    'settings:manage',
    'catalog:manage',
    'tickets:create',
    'tickets:read',
    'tickets:update',
    'tickets:assign',
    'tickets:resolve',
    'tickets:close',
    'tickets:worknotes',
    'approvals:decide',
    'assets:read',
    'assets:create',
    'assets:update',
    'assets:assign',
    'kb:read',
    'kb:read_internal',
    'kb:author',
    'kb:publish',
  ],
  it_manager: [
    'tickets:read',
    'tickets:update',
    'tickets:assign',
    'tickets:resolve',
    'tickets:close',
    'tickets:worknotes',
    'approvals:decide',
    'assets:read',
    'assets:create',
    'assets:update',
    'assets:assign',
    'kb:read',
    'kb:read_internal',
    'kb:author',
    'kb:publish',
  ],
  it_technician: [
    'tickets:read',
    'tickets:update',
    'tickets:worknotes',
    'tickets:resolve',
    'assets:read',
    'assets:update',
    'assets:assign',
    'kb:read',
    'kb:read_internal',
    'kb:author',
  ],
  employee: EMPLOYEE_BASE,
  approver: ['approvals:decide', 'kb:read'],
};

export function hasPermission(user: { roles: Role[] }, permission: Permission): boolean {
  return user.roles.some(
    (role) => role === 'super_admin' || ROLE_PERMISSIONS[role]?.includes(permission),
  );
}

export function permissionsFor(roles: Role[]): Permission[] {
  const set = new Set<Permission>();
  roles.forEach((r) => ROLE_PERMISSIONS[r]?.forEach((p) => set.add(p)));
  return [...set];
}

export const ROLES: Role[] = [
  'super_admin',
  'it_admin',
  'it_manager',
  'it_technician',
  'employee',
  'approver',
];
