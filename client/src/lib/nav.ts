import type { ComponentType, SVGProps } from 'react';

import {
  ApprovalsIcon,
  AuditIcon,
  BuildingIcon,
  DashboardIcon,
  MonitorIcon,
  SettingsIcon,
  TicketIcon,
  UsersIcon,
} from '@/components/icons';

export interface NavItem {
  label: string;
  to: string;
  icon: ComponentType<SVGProps<SVGSVGElement> & { size?: number }>;
  /** Any one of these grants visibility; empty = visible to all signed-in users. */
  permissions: string[];
  section: 'work' | 'admin';
}

export const NAV_ITEMS: NavItem[] = [
  { label: 'Dashboard', to: '/', icon: DashboardIcon, permissions: [], section: 'work' },
  { label: 'Tickets', to: '/tickets', icon: TicketIcon, permissions: ['tickets:read'], section: 'work' },
  { label: 'Assets', to: '/assets', icon: MonitorIcon, permissions: ['assets:read'], section: 'work' },
  { label: 'Approvals', to: '/approvals', icon: ApprovalsIcon, permissions: ['approvals:decide'], section: 'work' },
  { label: 'Users', to: '/admin/users', icon: UsersIcon, permissions: ['users:manage'], section: 'admin' },
  { label: 'Organization', to: '/admin/org', icon: BuildingIcon, permissions: ['org:manage'], section: 'admin' },
  { label: 'Settings', to: '/admin/settings', icon: SettingsIcon, permissions: ['settings:manage'], section: 'admin' },
  { label: 'Audit Log', to: '/admin/audit', icon: AuditIcon, permissions: ['audit:read'], section: 'admin' },
];
