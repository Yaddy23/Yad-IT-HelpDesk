import { Link, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { AssetHubTabs } from '@/components/AssetBadges';
import { apiErrorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { assetsApi } from '@/lib/assetsApi';
import { useState } from 'react';

export default function AssignmentsPage() {
  const { hasPermission } = useAuth();
  const queryClient = useQueryClient();
  const [params, setParams] = useSearchParams();
  const active = params.get('active') ?? 'true';  const page = Number(params.get('page') ?? '1');
  const [error, setError] = useState('');

  const assignmentsQuery = useQuery({
    queryKey: ['asset-assignments', { active, page }],
    queryFn: () => assetsApi.assignments({ active: active === 'true' ? true : active === 'false' ? false : undefined, page }),
  });

  const setParam = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    if (key !== 'page') next.delete('page');
    setParams(next);
  };

  const returnSeat = async (assignmentId: string) => {
    setError('');
    try {
      await assetsApi.returnAssignment(assignmentId, 'Returned from assignments page');
      void queryClient.invalidateQueries({ queryKey: ['asset-assignments'] });
    } catch (e) {
      setError(apiErrorMessage(e, 'Return failed'));
    }
  };

  const meta = assignmentsQuery.data?.meta;

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Assignments</h1>
          <p className="text-sm text-muted-foreground">{meta ? `${meta.total} assignment records` : 'Loading…'}</p>
        </div>
      </div>

      <div className="mt-4">
        <AssetHubTabs />
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {[
          { value: 'true', label: 'Active' },
          { value: 'false', label: 'Returned' },
          { value: 'all', label: 'All' },
        ].map((f) => (
          <button
            key={f.value}
            type="button"
            onClick={() => setParam('active', f.value)}
            className={`cursor-pointer rounded-full border px-3 py-1.5 text-sm transition-colors ${
              active === f.value
                ? 'border-primary bg-primary text-on-primary'
                : 'border-border bg-card text-muted-foreground hover:border-ring/40 hover:text-foreground'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {error && (
        <p role="alert" className="mt-3 text-sm text-destructive">
          {error}
        </p>
      )}

      <div className="mt-4 overflow-x-auto rounded-xl border border-border bg-card">
        {assignmentsQuery.isLoading ? (
          <div className="space-y-2 p-5">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="h-10 animate-pulse rounded-md bg-muted" />
            ))}
          </div>
        ) : assignmentsQuery.isError ? (
          <p role="alert" className="p-5 text-sm text-destructive">
            {apiErrorMessage(assignmentsQuery.error, 'Failed to load assignments')}
          </p>
        ) : assignmentsQuery.data?.data.length === 0 ? (
          <p className="p-10 text-center text-sm text-muted-foreground">No assignments in this view.</p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-4 py-3 font-medium">Asset</th>
                <th className="px-4 py-3 font-medium">Custodian</th>
                <th className="hidden px-4 py-3 font-medium md:table-cell">Assigned</th>
                <th className="hidden px-4 py-3 font-medium lg:table-cell">Due</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {assignmentsQuery.data?.data.map((a) => (
                <tr key={a.id} className="border-b border-border/60 transition-colors last:border-0 hover:bg-muted/50">
                  <td className="px-4 py-3">
                    <Link to={`/assets/${a.assetId}`} className="text-primary hover:underline">
                      {a.asset ? a.asset.number : a.assetId}
                    </Link>
                    {a.asset && <span className="block max-w-[12rem] truncate text-xs text-muted-foreground">{a.asset.name}</span>}
                  </td>
                  <td className="px-4 py-3">{a.employee.name}</td>
                  <td className="hidden px-4 py-3 text-muted-foreground md:table-cell">{new Date(a.assignedAt).toLocaleDateString()}</td>
                  <td className="hidden px-4 py-3 text-muted-foreground lg:table-cell">{a.dueAt ? new Date(a.dueAt).toLocaleDateString() : '—'}</td>
                  <td className="px-4 py-3">
                    <span
                      className={`whitespace-nowrap rounded-full border px-2 py-0.5 text-xs ${
                        a.status === 'active' ? 'bg-accent/10 text-accent border-accent/40' : 'bg-muted text-muted-foreground border-border'
                      }`}
                    >
                      {a.status === 'active' ? 'Active' : 'Returned'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    {a.status === 'active' && hasPermission('assets:assign') && (
                      <button
                        type="button"
                        onClick={() => void returnSeat(a.id)}
                        className="cursor-pointer rounded-md border border-border bg-card px-2.5 py-1 text-xs transition-colors hover:border-ring/40"
                      >
                        Return
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {meta && meta.pages > 1 && (
        <div className="mt-4 flex items-center justify-between text-sm text-muted-foreground">
          <span>
            Page {meta.page} of {meta.pages} · {meta.total} records
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={meta.page <= 1}
              onClick={() => setParam('page', String(meta.page - 1))}
              className="cursor-pointer rounded-md border border-border bg-card px-3 py-1.5 transition-colors hover:border-ring/40 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Previous
            </button>
            <button
              type="button"
              disabled={meta.page >= meta.pages}
              onClick={() => setParam('page', String(meta.page + 1))}
              className="cursor-pointer rounded-md border border-border bg-card px-3 py-1.5 transition-colors hover:border-ring/40 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
