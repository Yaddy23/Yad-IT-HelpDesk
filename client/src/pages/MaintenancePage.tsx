import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { AssetHubTabs, WarrantyClaimBadge } from '@/components/AssetBadges';
import { apiErrorMessage } from '@/lib/api';
import { assetsApi } from '@/lib/assetsApi';

const card = 'rounded-xl border border-border bg-card';
const tabClass = (activeTab: boolean) =>
  `cursor-pointer rounded-full border px-3 py-1.5 text-sm transition-colors ${
    activeTab
      ? 'border-primary bg-primary text-on-primary'
      : 'border-border bg-card text-muted-foreground hover:border-ring/40 hover:text-foreground'
  }`;

type Tab = 'schedules' | 'records' | 'warranty';

export default function MaintenancePage() {
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') ?? 'schedules') as Tab;
  const [error, setError] = useState('');
  const queryClient = useQueryClient();

  const schedulesQuery = useQuery({
    queryKey: ['maintenance-schedules'],
    queryFn: () => assetsApi.allSchedules({ dueWithinDays: 60 }),
  });
  const recordsQuery = useQuery({
    queryKey: ['maintenance-records'],
    queryFn: () => assetsApi.allRecords({}),
    enabled: tab === 'records',
  });
  const claimsQuery = useQuery({
    queryKey: ['warranty-claims'],
    queryFn: () => assetsApi.allClaims({}),
    enabled: tab === 'warranty',
  });

  const complete = useMutation({
    mutationFn: (scheduleId: string) => assetsApi.completeSchedule(scheduleId, { summary: 'Completed from maintenance page' }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['maintenance-schedules'] });
      void queryClient.invalidateQueries({ queryKey: ['maintenance-records'] });
    },
    onError: (e) => setError(apiErrorMessage(e, 'Could not complete schedule')),
  });

  const setTab = (t: Tab) => {
    const next = new URLSearchParams(params);
    next.set('tab', t);
    setParams(next);
  };

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Maintenance</h1>
          <p className="text-sm text-muted-foreground">Schedules, work history and warranty claims across all assets</p>
        </div>
      </div>

      <div className="mt-4">
        <AssetHubTabs />
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <button type="button" onClick={() => setTab('schedules')} className={tabClass(tab === 'schedules')}>
          Due schedules
        </button>
        <button type="button" onClick={() => setTab('records')} className={tabClass(tab === 'records')}>
          Work history
        </button>
        <button type="button" onClick={() => setTab('warranty')} className={tabClass(tab === 'warranty')}>
          Warranty claims
        </button>
      </div>

      {error && (
        <p role="alert" className="mt-3 text-sm text-destructive">
          {error}
        </p>
      )}

      {tab === 'schedules' && (
        <div className={`mt-4 overflow-x-auto ${card}`}>
          {schedulesQuery.isLoading ? (
            <div className="space-y-2 p-5">
              {[...Array(4)].map((_, i) => (
                <div key={i} className="h-10 animate-pulse rounded-md bg-muted" />
              ))}
            </div>
          ) : schedulesQuery.isError ? (
            <p role="alert" className="p-5 text-sm text-destructive">
              {apiErrorMessage(schedulesQuery.error, 'Failed to load schedules')}
            </p>
          ) : schedulesQuery.data?.data.length === 0 ? (
            <p className="p-10 text-center text-sm text-muted-foreground">Nothing due in the next 60 days.</p>
          ) : (
            <ul className="divide-y divide-border/60">
              {schedulesQuery.data?.data.map((s) => {
                const due = new Date(s.nextDueAt);
                const overdue = due < new Date();
                return (
                  <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm">
                    <div className="min-w-0">
                      <p className="font-medium">{s.name}</p>
                      <p className="text-xs text-muted-foreground">
                        <Link to={`/assets/${s.asset.id}`} className="text-primary hover:underline">
                          {s.asset.number}
                        </Link>{' '}
                        · {s.asset.name} · every {s.intervalDays} days
                      </p>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className={overdue ? 'text-destructive' : 'text-muted-foreground'}>
                        {overdue ? 'Overdue — ' : 'Due '}
                        {due.toLocaleDateString()}
                      </span>
                      <button
                        type="button"
                        disabled={complete.isPending}
                        onClick={() => complete.mutate(s.id)}
                        className="cursor-pointer rounded-md border border-border bg-card px-2.5 py-1 text-xs transition-colors hover:border-ring/40 disabled:opacity-40"
                      >
                        Mark done
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}

      {tab === 'records' && (
        <div className={`mt-4 overflow-x-auto ${card}`}>
          {recordsQuery.isError ? (
            <p role="alert" className="p-5 text-sm text-destructive">
              {apiErrorMessage(recordsQuery.error, 'Failed to load records')}
            </p>
          ) : recordsQuery.data?.data.length === 0 ? (
            <p className="p-10 text-center text-sm text-muted-foreground">No maintenance logged yet.</p>
          ) : (
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-4 py-3 font-medium">Asset</th>
                  <th className="px-4 py-3 font-medium">Work</th>
                  <th className="hidden px-4 py-3 font-medium md:table-cell">Type</th>
                  <th className="hidden px-4 py-3 font-medium lg:table-cell">Vendor</th>
                  <th className="px-4 py-3 font-medium">Date</th>
                </tr>
              </thead>
              <tbody>
                {recordsQuery.data?.data.map((r) => (
                  <tr key={r.id} className="border-b border-border/60 transition-colors last:border-0 hover:bg-muted/50">
                    <td className="px-4 py-3">
                      <Link to={`/assets/${r.asset.id}`} className="text-primary hover:underline">
                        {r.asset.number}
                      </Link>
                    </td>
                    <td className="max-w-xs px-4 py-3">
                      <p className="truncate">{r.summary}</p>
                      {r.cost != null && <p className="text-xs text-muted-foreground">${r.cost.toFixed(2)}</p>}
                    </td>
                    <td className="hidden px-4 py-3 text-muted-foreground capitalize md:table-cell">{r.type}</td>
                    <td className="hidden px-4 py-3 text-muted-foreground lg:table-cell">{r.vendor?.name ?? '—'}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">{new Date(r.performedAt).toLocaleDateString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {tab === 'warranty' && (
        <div className={`mt-4 overflow-x-auto ${card}`}>
          {claimsQuery.isError ? (
            <p role="alert" className="p-5 text-sm text-destructive">
              {apiErrorMessage(claimsQuery.error, 'Failed to load claims')}
            </p>
          ) : claimsQuery.data?.data.length === 0 ? (
            <p className="p-10 text-center text-sm text-muted-foreground">No warranty claims filed.</p>
          ) : (
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-4 py-3 font-medium">Asset</th>
                  <th className="px-4 py-3 font-medium">Issue</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="hidden px-4 py-3 font-medium lg:table-cell">Filed</th>
                </tr>
              </thead>
              <tbody>
                {claimsQuery.data?.data.map((c) => (
                  <tr key={c.id} className="border-b border-border/60 transition-colors last:border-0 hover:bg-muted/50">
                    <td className="px-4 py-3">
                      <Link to={`/assets/${c.asset.id}`} className="text-primary hover:underline">
                        {c.asset.number}
                      </Link>
                    </td>
                    <td className="max-w-sm px-4 py-3">
                      <p className="truncate">{c.issue}</p>
                      {c.resolution && <p className="truncate text-xs text-muted-foreground">{c.resolution}</p>}
                    </td>
                    <td className="px-4 py-3">
                      <WarrantyClaimBadge status={c.status} />
                    </td>
                    <td className="hidden whitespace-nowrap px-4 py-3 text-muted-foreground lg:table-cell">
                      {new Date(c.createdAt).toLocaleDateString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}
