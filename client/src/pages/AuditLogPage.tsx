import { Fragment, useState } from 'react';
import type { FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';

import { AdminHubTabs, formatWhen } from '@/components/AdminBadges';
import { ChevronIcon, SearchIcon } from '@/components/icons';
import { useAuth } from '@/lib/auth';
import { apiErrorMessage } from '@/lib/api';
import { type AuditEntry, auditApi, usersApi } from '@/lib/adminApi';

const buttonGhost =
  'cursor-pointer rounded-md border border-border bg-card px-3 py-1.5 text-sm transition-colors hover:border-ring/40 disabled:cursor-not-allowed disabled:opacity-40';
const inputClass =
  'w-full rounded-md border border-border bg-card px-3 py-2 text-sm transition-colors hover:border-ring/40 focus:border-ring';

/** Target types the server actually records — keeps the filter honest. */
const TARGET_TYPES = [
  'ticket',
  'user',
  'session',
  'asset',
  'asset_audit',
  'inventory_item',
  'software_license',
  'warranty_claim',
  'vendor',
  'sla_policy',
  'system_settings',
  'department',
  'location',
  'assignment_group',
];

/** `user.password_reset` → `User · password reset` */
function splitAction(action: string): { scope: string; verb: string } {
  const [scope, ...rest] = action.split('.');
  return { scope, verb: rest.join('.').replace(/_/g, ' ') || scope };
}

export default function AuditLogPage() {
  const { hasPermission } = useAuth();
  const [params, setParams] = useSearchParams();
  const [expanded, setExpanded] = useState<string | null>(null);

  const action = params.get('action') ?? '';
  const targetType = params.get('targetType') ?? '';
  const actorId = params.get('actorId') ?? '';
  const page = Number(params.get('page') ?? '1');

  const [actionDraft, setActionDraft] = useState(action);

  // Only super_admin holds audit:read, and users:manage is likewise super_admin —
  // but gate the picker anyway so the page still works if that ever diverges.
  const canPickActor = hasPermission('users:manage');
  const actorsQuery = useQuery({
    queryKey: ['audit-actors'],
    queryFn: () => usersApi.list({ limit: 100 }),
    enabled: canPickActor,
    staleTime: 5 * 60 * 1000,
  });

  const query = useQuery({
    queryKey: ['audit', { action, targetType, actorId, page }],
    queryFn: () =>
      auditApi.list({
        page,
        limit: 50,
        action: action || undefined,
        targetType: targetType || undefined,
        actorId: actorId || undefined,
      }),
  });

  const setParam = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    if (key !== 'page') next.delete('page');
    setParams(next);
  };

  const submitAction = (e: FormEvent) => {
    e.preventDefault();
    setParam('action', actionDraft.trim());
  };

  const hasFilters = Boolean(action || targetType || actorId);
  const rows = query.data?.data ?? [];

  return (
    <div>
      <div>
        <h1 className="text-2xl font-semibold">Audit Log</h1>
        <p className="text-sm text-muted-foreground">
          Every privileged change, newest first. Entries are append-only.
        </p>
      </div>

      <div className="mt-4">
        <AdminHubTabs />
      </div>

      <form onSubmit={submitAction} className="mt-4 flex flex-wrap items-end gap-3">
        <label className="block min-w-[16rem] flex-1 text-sm">
          <span className="mb-1 block font-medium">Action</span>
          <span className="relative block">
            <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground">
              <SearchIcon size={16} />
            </span>
            <input
              type="search"
              value={actionDraft}
              onChange={(e) => setActionDraft(e.target.value)}
              placeholder="e.g. password_reset, user."
              className={`${inputClass} pl-8`}
            />
          </span>
        </label>

        <label className="block text-sm">
          <span className="mb-1 block font-medium">Target type</span>
          <select
            value={targetType}
            onChange={(e) => setParam('targetType', e.target.value)}
            className={`${inputClass} cursor-pointer`}
          >
            <option value="">All targets</option>
            {TARGET_TYPES.map((t) => (
              <option key={t} value={t}>
                {t.replace(/_/g, ' ')}
              </option>
            ))}
          </select>
        </label>

        {canPickActor && (
          <label className="block text-sm">
            <span className="mb-1 block font-medium">Actor</span>
            <select
              value={actorId}
              onChange={(e) => setParam('actorId', e.target.value)}
              className={`${inputClass} cursor-pointer`}
            >
              <option value="">Anyone</option>
              {(actorsQuery.data?.data ?? []).map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>
          </label>
        )}

        <div className="flex gap-2">
          <button
            type="submit"
            className="cursor-pointer rounded-md bg-primary px-4 py-2 text-sm font-medium text-on-primary transition-opacity hover:opacity-90"
          >
            Filter
          </button>
          {hasFilters && (
            <button
              type="button"
              onClick={() => {
                setActionDraft('');
                setParams(new URLSearchParams());
              }}
              className={buttonGhost}
            >
              Reset
            </button>
          )}
        </div>
      </form>

      <div className="mt-4 overflow-x-auto rounded-xl border border-border bg-card">
        {query.isLoading ? (
          <div className="space-y-2 p-5">
            {[...Array(6)].map((_, i) => (
              <div key={i} className="h-10 animate-pulse rounded-md bg-muted" />
            ))}
          </div>
        ) : query.isError ? (
          <p role="alert" className="p-5 text-sm text-destructive">
            {apiErrorMessage(query.error, 'Failed to load the audit trail')}
          </p>
        ) : rows.length === 0 ? (
          <p className="p-10 text-center text-sm text-muted-foreground">
            {hasFilters ? 'No entries match these filters.' : 'No audit entries recorded yet.'}
          </p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-4 py-3 font-medium">Time</th>
                <th className="px-4 py-3 font-medium">Actor</th>
                <th className="px-4 py-3 font-medium">Action</th>
                <th className="hidden px-4 py-3 font-medium md:table-cell">Target</th>
                <th className="hidden px-4 py-3 font-medium lg:table-cell">IP</th>
                <th className="px-4 py-3 font-medium">
                  <span className="sr-only">Detail</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((entry) => {
                const open = expanded === entry.id;
                const { scope, verb } = splitAction(entry.action);
                const detail = hasDetail(entry);
                return (
                  <Fragment key={entry.id}>
                    <tr className="border-b border-border/60 transition-colors last:border-0 hover:bg-muted/50">
                      <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">
                        {formatWhen(entry.createdAt)}
                      </td>
                      <td className="max-w-[14rem] px-4 py-3">
                        <span className="block truncate">{entry.actor?.name ?? entry.actorEmail ?? 'System'}</span>
                        {entry.actor && (
                          <span className="block truncate text-xs text-muted-foreground">{entry.actor.email}</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span className="block font-medium">{verb}</span>
                        <span className="block font-mono text-xs text-muted-foreground">{scope}</span>
                      </td>
                      <td className="hidden max-w-[14rem] px-4 py-3 md:table-cell">
                        {entry.targetType ? (
                          <>
                            <span className="block text-muted-foreground">{entry.targetType.replace(/_/g, ' ')}</span>
                            {entry.targetId && (
                              <span className="block truncate font-mono text-xs text-muted-foreground/80">
                                {entry.targetId}
                              </span>
                            )}
                          </>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="hidden px-4 py-3 font-mono text-xs text-muted-foreground lg:table-cell">
                        {entry.ip ?? '—'}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button
                          type="button"
                          onClick={() => setExpanded(open ? null : entry.id)}
                          aria-expanded={open}
                          aria-controls={`audit-detail-${entry.id}`}
                          disabled={!detail}
                          title={detail ? 'Show change detail' : 'No extra detail recorded'}
                          className={`${buttonGhost} inline-flex items-center gap-1`}
                        >
                          <span
                            className="transition-transform duration-200"
                            style={{ transform: open ? 'rotate(90deg)' : 'none' }}
                          >
                            <ChevronIcon size={14} />
                          </span>
                          {open ? 'Hide' : 'Detail'}
                        </button>
                      </td>
                    </tr>
                    {open && (
                      <tr key={`${entry.id}-detail`} className="border-b border-border/60 last:border-0">
                        <td id={`audit-detail-${entry.id}`} colSpan={6} className="bg-muted/40 px-4 py-4">
                          <div className="grid gap-4 lg:grid-cols-2">
                            <JsonBlock label="Before" value={entry.before} />
                            <JsonBlock label="After" value={entry.after} />
                          </div>
                          {entry.meta != null && (
                            <div className="mt-4">
                              <JsonBlock label="Meta" value={entry.meta} />
                            </div>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {query.data && query.data.pages > 1 && (
        <div className="mt-3 flex items-center justify-between text-sm text-muted-foreground">
          <span>
            Page {query.data.page} of {query.data.pages} · {query.data.total} entries
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={query.data.page <= 1}
              onClick={() => setParam('page', String(query.data!.page - 1))}
              className={buttonGhost}
            >
              Previous
            </button>
            <button
              type="button"
              disabled={query.data.page >= query.data.pages}
              onClick={() => setParam('page', String(query.data!.page + 1))}
              className={buttonGhost}
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function hasDetail(entry: AuditEntry): boolean {
  return entry.before != null || entry.after != null || entry.meta != null;
}

/** Renders a JSON payload as text — React escapes it, so no HTML injection. */
function JsonBlock({ label, value }: { label: string; value: unknown }) {
  return (
    <div>
      <h4 className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</h4>
      {value == null ? (
        <p className="text-sm text-muted-foreground">Not recorded</p>
      ) : (
        <pre className="max-h-64 overflow-auto rounded-md border border-border bg-background p-3 font-mono text-xs">
          {JSON.stringify(value, null, 2)}
        </pre>
      )}
    </div>
  );
}
