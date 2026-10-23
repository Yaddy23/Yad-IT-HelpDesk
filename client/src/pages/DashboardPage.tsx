import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';

import { PriorityBadge, StatusBadge } from '@/components/TicketBadges';
import { MonitorIcon } from '@/components/icons';
import { apiErrorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { assetsApi } from '@/lib/assetsApi';
import { ticketsApi } from '@/lib/ticketsApi';

/** Whole tile is the link target — far larger than the 24px minimum. */
function StatTile({
  label,
  value,
  to,
  tone,
  loading,
}: {
  label: string;
  value: number;
  to: string;
  tone?: 'danger';
  loading: boolean;
}) {
  return (
    <Link
      to={to}
      className="group block rounded-xl border border-border bg-card p-5 transition-colors hover:border-ring/40 active:scale-[0.99]"
    >
      <p className="text-sm text-muted-foreground">{label}</p>
      {loading ? (
        <span aria-busy="true" className="mt-2 block h-9 w-16 animate-pulse rounded-md bg-muted" />
      ) : (
        <p
          className={`mt-2 text-3xl font-semibold ${tone === 'danger' && value > 0 ? 'text-destructive' : 'text-foreground'}`}
        >
          {value.toLocaleString()}
        </p>
      )}
    </Link>
  );
}

export default function DashboardPage() {
  const { user, hasPermission } = useAuth();
  const isAgent = hasPermission('tickets:assign');
  const canReadAssets = hasPermission('assets:read');

  const queuesQuery = useQuery({ queryKey: ['ticket-queues'], queryFn: ticketsApi.queues });
  const recentQuery = useQuery({
    queryKey: ['tickets', 'dashboard-recent'],
    queryFn: () => ticketsApi.list({ queue: 'all', page: 1, sort: 'newest' }),
  });
  // Limit defaults to 25 server-side; we only render the first 5.
  const recent = recentQuery.data?.data.slice(0, 5) ?? [];

  const lowStockQuery = useQuery({
    queryKey: ['inventory', { lowStock: true }],
    queryFn: () => assetsApi.inventory({ lowStock: true, page: 1 }),
    enabled: canReadAssets,
  });

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Welcome, {user?.name}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Signed in as {user?.email} · roles: {user?.roles.join(', ')}
          </p>
        </div>
        {hasPermission('tickets:create') && (
          <Link
            to="/tickets/new"
            className="cursor-pointer rounded-md bg-primary px-4 py-2 text-sm font-medium text-on-primary transition-opacity hover:opacity-90"
          >
            New ticket
          </Link>
        )}
      </div>

      <section aria-label="Key metrics" className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Open tickets" value={queuesQuery.data?.open ?? 0} to="/tickets" loading={queuesQuery.isLoading} />
        {isAgent ? (
          <>
            <StatTile
              label="My queue"
              value={queuesQuery.data?.assignedToMe ?? 0}
              to="/tickets?queue=my"
              loading={queuesQuery.isLoading}
            />
            <StatTile
              label="Unassigned"
              value={queuesQuery.data?.unassigned ?? 0}
              to="/tickets?queue=unassigned"
              loading={queuesQuery.isLoading}
            />
          </>
        ) : (
          <StatTile label="My requests" value={recentQuery.data?.meta.total ?? 0} to="/tickets?queue=mine" loading={recentQuery.isLoading} />
        )}
        <StatTile
          label="SLA at risk"
          value={queuesQuery.data?.slaAtRisk ?? 0}
          to="/tickets?sla=at_risk"
          tone="danger"
          loading={queuesQuery.isLoading}
        />
      </section>

      <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <section aria-label="Recent tickets" className="lg:col-span-2">
          <div className="overflow-hidden rounded-xl border border-border bg-card">
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <h2 className="text-sm font-semibold">Recent tickets</h2>
              <Link to="/tickets" className="text-xs text-primary hover:underline">
                View all
              </Link>
            </div>
            {recentQuery.isLoading ? (
              <div aria-busy="true" className="space-y-2 p-4">
                {[...Array(5)].map((_, i) => (
                  <div key={i} className="h-9 animate-pulse rounded-md bg-muted" />
                ))}
              </div>
            ) : recentQuery.isError ? (
              <p role="alert" className="p-4 text-sm text-destructive">
                {apiErrorMessage(recentQuery.error, 'Failed to load recent tickets')}
              </p>
            ) : recent.length === 0 ? (
              <p className="p-8 text-center text-sm text-muted-foreground">No tickets yet.</p>
            ) : (
              <ul className="divide-y divide-border/60">
                {recent.map((t) => (
                  <li key={t.id}>
                    <Link
                      to={`/tickets/${t.id}`}
                      className="flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-muted/50"
                    >
                      <span className="shrink-0 font-mono text-xs text-muted-foreground">{t.number}</span>
                      <span className="min-w-0 flex-1 truncate text-sm">{t.title}</span>
                      <PriorityBadge priority={t.priority} />
                      <StatusBadge status={t.status} />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

        {canReadAssets && (
          <section aria-label="Asset quick links">
            <div className="rounded-xl border border-border bg-card p-5">
              <h2 className="flex items-center gap-2 text-sm font-semibold">
                <MonitorIcon size={16} />
                Asset management
              </h2>
              <ul className="mt-3 space-y-1 text-sm">
                {[
                  { to: '/assets', label: 'All assets' },
                  { to: '/assets/assignments', label: 'Assignments' },
                  { to: '/assets/maintenance', label: 'Maintenance & warranty' },
                  { to: '/assets/licenses', label: 'Licenses' },
                ].map((l) => (
                  <li key={l.to}>
                    <Link to={l.to} className="block rounded-md px-2 py-1.5 text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground">
                      {l.label}
                    </Link>
                  </li>
                ))}
              </ul>
              {lowStockQuery.data && lowStockQuery.data.meta.total > 0 && (
                <Link
                  to="/assets/inventory?lowStock=true"
                  className="mt-3 block rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive transition-opacity hover:opacity-90"
                >
                  {lowStockQuery.data.meta.total} inventory {lowStockQuery.data.meta.total === 1 ? 'item' : 'items'} below reorder point
                </Link>
              )}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
