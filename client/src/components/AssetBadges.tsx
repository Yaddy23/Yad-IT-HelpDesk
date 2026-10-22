import type { ReactNode } from 'react';
import { NavLink } from 'react-router-dom';

import { ASSET_STATUS_LABELS, type AssetCategory, type AssetStatus, CATEGORY_LABELS, type WarrantyClaimStatus } from '@/lib/assetsApi';

/* Status → dot color; semantic token pairs so light/dark both read cleanly. */
const STATUS_STYLES: Record<AssetStatus, string> = {
  in_stock: 'bg-secondary',
  deployed: 'bg-accent',
  in_repair: 'bg-warning',
  in_maintenance: 'bg-warning',
  retired: 'bg-muted-foreground/40',
  lost: 'bg-destructive',
};

export function AssetStatusBadge({ status }: { status: AssetStatus }) {
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border border-border px-2 py-0.5 text-xs">
      <span className={`h-2 w-2 rounded-full ${STATUS_STYLES[status]}`} aria-hidden />
      {ASSET_STATUS_LABELS[status]}
    </span>
  );
}

const CLAIM_STYLES: Record<WarrantyClaimStatus, string> = {
  open: 'bg-secondary/10 text-secondary border-secondary/30',
  submitted: 'bg-warning/15 text-warning border-warning/40',
  approved: 'bg-accent/10 text-accent border-accent/40',
  rejected: 'bg-destructive/15 text-destructive border-destructive/40',
  resolved: 'bg-muted text-muted-foreground border-border',
};

const CLAIM_LABELS: Record<WarrantyClaimStatus, string> = {
  open: 'Open',
  submitted: 'Submitted',
  approved: 'Approved',
  rejected: 'Rejected',
  resolved: 'Resolved',
};

export function WarrantyClaimBadge({ status }: { status: WarrantyClaimStatus }) {
  return (
    <span className={`inline-block whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium ${CLAIM_STYLES[status]}`}>
      {CLAIM_LABELS[status]}
    </span>
  );
}

export function CategoryLabel({ category }: { category: AssetCategory }) {
  return <span className="text-muted-foreground">{CATEGORY_LABELS[category]}</span>;
}

const TABS = [
  { to: '/assets', label: 'Assets', end: true },
  { to: '/assets/assignments', label: 'Assignments' },
  { to: '/assets/maintenance', label: 'Maintenance' },
  { to: '/assets/inventory', label: 'Inventory' },
  { to: '/assets/licenses', label: 'Licenses' },
  { to: '/assets/audits', label: 'Audits' },
];

/** Tab strip shared by every asset-hub page; active tab gets primary styling. */
export function AssetHubTabs({ children }: { children?: ReactNode }) {
  return (
    <div className="border-b border-border">
      <nav className="-mb-px flex gap-1 overflow-x-auto" aria-label="Asset sections">
        {TABS.map((t) => (
          <NavLink
            key={t.to}
            to={t.to}
            end={t.end}
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
        {children && <div className="ml-auto pb-1">{children}</div>}
      </nav>
    </div>
  );
}
