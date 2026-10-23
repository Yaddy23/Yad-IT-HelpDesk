import { NavLink } from 'react-router-dom';

import { useAuth } from '@/lib/auth';
import { ROLE_LABELS, type Role } from '@/lib/adminApi';

/**
 * Elevated roles carry the primary tint so a privileged account is visible at a
 * glance; the rest stay neutral. Status colors are never used for roles — they
 * are reserved for state (see ActiveBadge).
 */
const PRIVILEGED: Role[] = ['super_admin', 'it_admin', 'it_manager'];

export function RoleBadge({ role }: { role: Role }) {
  const elevated = PRIVILEGED.includes(role);
  return (
    <span
      className={`inline-block whitespace-nowrap rounded-full border px-2 py-0.5 text-xs ${
        elevated ? 'border-primary/40 bg-primary/10 text-primary' : 'border-border text-muted-foreground'
      }`}
    >
      {ROLE_LABELS[role]}
    </span>
  );
}

export function ActiveBadge({ active }: { active: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border border-border px-2 py-0.5 text-xs">
      <span className={`h-2 w-2 rounded-full ${active ? 'bg-accent' : 'bg-muted-foreground/40'}`} aria-hidden />
      {active ? 'Active' : 'Inactive'}
    </span>
  );
}

const TABS = [
  { to: '/admin/users', label: 'Users', permission: 'users:manage' },
  { to: '/admin/org', label: 'Organization', permission: 'org:manage' },
  { to: '/admin/audit', label: 'Audit Log', permission: 'audit:read' },
];

/** Tab strip shared by the administration pages; tabs the viewer cannot open are hidden. */
export function AdminHubTabs() {
  const { hasPermission } = useAuth();
  const visible = TABS.filter((t) => hasPermission(t.permission));
  if (visible.length < 2) return null;

  return (
    <div className="border-b border-border">
      <nav className="-mb-px flex gap-1 overflow-x-auto" aria-label="Administration sections">
        {visible.map((t) => (
          <NavLink
            key={t.to}
            to={t.to}
            className={({ isActive }) =>
              `whitespace-nowrap border-b-2 px-3 py-2 text-sm transition-colors ${
                isActive
                  ? 'border-primary font-medium text-primary'
                  : 'border-transparent text-muted-foreground hover:border-border hover:text-foreground'
              }`
            }
          >
            {t.label}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}

/** Formats an ISO timestamp for dense admin tables; the exact time stays in the title. */
export function formatWhen(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}
