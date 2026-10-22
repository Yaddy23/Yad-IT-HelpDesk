import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { AssetHubTabs } from '@/components/AssetBadges';
import { apiErrorMessage } from '@/lib/api';
import { assetsApi, type AuditItem } from '@/lib/assetsApi';

const card = 'rounded-xl border border-border bg-card p-5';

const ITEM_BADGE: Record<string, string> = {
  found: 'bg-accent/10 text-accent border-accent/40',
  missing: 'bg-destructive/15 text-destructive border-destructive/40',
  unexpected: 'bg-warning/15 text-warning border-warning/40',
};

export default function AuditsPage() {
  const queryClient = useQueryClient();
  const [openId, setOpenId] = useState<string | null>(null);
  const [error, setError] = useState('');

  const auditsQuery = useQuery({ queryKey: ['audits'], queryFn: () => assetsApi.audits({}) });

  const open = useMutation({
    mutationFn: (name: string) => assetsApi.createAudit(name, 'all'),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['audits'] }),
    onError: (e) => setError(apiErrorMessage(e, 'Could not open session')),
  });

  const close = useMutation({
    mutationFn: (id: string) => assetsApi.closeAudit(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['audits'] });
      setOpenId(null);
    },
    onError: (e) => setError(apiErrorMessage(e, 'Could not close session')),
  });

  if (openId) {
    return <AuditRun sessionId={openId} onExit={() => setOpenId(null)} onError={(m) => setError(m)} onClosed={() => close.mutate(openId)} closing={close.isPending} />;
  }

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Audits</h1>
          <p className="text-sm text-muted-foreground">Stock-take sessions across deployed and stored assets</p>
        </div>
        <button
          type="button"
          onClick={() => {
            const name = window.prompt('Session name (e.g. "Q4 stocktake"):');
            if (name) open.mutate(name);
            else if (name === '') setError('Session name is required');
          }}
          disabled={open.isPending}
          className="cursor-pointer rounded-md bg-primary px-4 py-2 text-sm font-medium text-on-primary transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {open.isPending ? 'Opening…' : 'New audit session'}
        </button>
      </div>

      <div className="mt-4">
        <AssetHubTabs />
      </div>

      {error && (
        <p role="alert" className="mt-3 text-sm text-destructive">
          {error}
        </p>
      )}

      <div className="mt-4 overflow-x-auto rounded-xl border border-border bg-card">
        {auditsQuery.isLoading ? (
          <div className="space-y-2 p-5">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="h-10 animate-pulse rounded-md bg-muted" />
            ))}
          </div>
        ) : auditsQuery.isError ? (
          <p role="alert" className="p-5 text-sm text-destructive">
            {apiErrorMessage(auditsQuery.error, 'Failed to load audit sessions')}
          </p>
        ) : auditsQuery.data?.data.length === 0 ? (
          <p className="p-10 text-center text-sm text-muted-foreground">No audit sessions yet — open the first one.</p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-4 py-3 font-medium">Session</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="hidden px-4 py-3 font-medium md:table-cell">Items</th>
                <th className="hidden px-4 py-3 font-medium lg:table-cell">Started</th>
                <th className="px-4 py-3 font-medium">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {auditsQuery.data?.data.map((s) => (
                <tr key={s.id} className="border-b border-border/60 transition-colors last:border-0 hover:bg-muted/50">
                  <td className="px-4 py-3 font-medium">{s.name}</td>
                  <td className="px-4 py-3">
                    <span
                      className={`whitespace-nowrap rounded-full border px-2 py-0.5 text-xs ${
                        s.status === 'open' ? 'bg-secondary/10 text-secondary border-secondary/30' : 'bg-muted text-muted-foreground border-border'
                      }`}
                    >
                      {s.status === 'open' ? 'Open' : 'Closed'}
                    </span>
                  </td>
                  <td className="hidden px-4 py-3 text-muted-foreground md:table-cell">{s.itemCount ?? '—'}</td>
                  <td className="hidden whitespace-nowrap px-4 py-3 text-muted-foreground lg:table-cell">
                    {new Date(s.startedAt).toLocaleDateString()} · {s.startedBy.name}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      type="button"
                      onClick={() => setOpenId(s.id)}
                      className="cursor-pointer rounded-md border border-border bg-card px-2.5 py-1 text-xs transition-colors hover:border-ring/40"
                    >
                      {s.status === 'open' ? 'Continue' : 'View report'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function AuditRun({
  sessionId,
  onExit,
  onError,
  onClosed,
  closing,
}: {
  sessionId: string;
  onExit: () => void;
  onError: (message: string) => void;
  onClosed: () => void;
  closing: boolean;
}) {
  const detailQuery = useQuery({ queryKey: ['audit', sessionId], queryFn: () => assetsApi.auditDetail(sessionId) });

  const mark = useMutation({
    mutationFn: (input: { assetId: string; status: 'found' | 'missing' | 'unexpected'; note?: string }) =>
      assetsApi.markAuditItem(sessionId, input.assetId, input.status, input.note),
    onSuccess: () => void detailQuery.refetch(),
    onError: (e) => onError(apiErrorMessage(e, 'Mark failed')),
  });

  if (detailQuery.isLoading) return <p className="text-sm text-muted-foreground">Loading session…</p>;
  if (detailQuery.isError)
    return (
      <p role="alert" className="text-sm text-destructive">
        {apiErrorMessage(detailQuery.error, 'Failed to load session')}
      </p>
    );

  const s = detailQuery.data!;
  const counts = s.counts ?? { found: 0, missing: 0, unexpected: 0, unchecked: 0 };
  const items = s.items ?? [];

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{s.name}</h1>
          <p className="text-sm text-muted-foreground">
            {s.status === 'open' ? 'Mark each asset as you physically verify it.' : 'Closed session — read-only report.'}
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onExit}
            className="cursor-pointer rounded-md border border-border bg-card px-3 py-2 text-sm transition-colors hover:border-ring/40"
          >
            Back to list
          </button>
          {s.status === 'open' && (
            <button
              type="button"
              onClick={onClosed}
              disabled={closing}
              className="cursor-pointer rounded-md bg-primary px-4 py-2 text-sm font-medium text-on-primary transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {closing ? 'Closing…' : 'Close session'}
            </button>
          )}
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {(
          [
            ['Found', counts.found, 'text-accent'],
            ['Missing', counts.missing, 'text-destructive'],
            ['Unexpected', counts.unexpected, 'text-warning'],
            ['Unchecked', counts.unchecked, 'text-muted-foreground'],
          ] as const
        ).map(([label, value, tone]) => (
          <div key={label} className={card}>
            <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
            <p className={`mt-1 text-2xl font-semibold ${tone}`}>{value}</p>
          </div>
        ))}
      </div>

      <div className="mt-4 overflow-x-auto rounded-xl border border-border bg-card">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
              <th className="px-4 py-3 font-medium">Asset</th>
              <th className="px-4 py-3 font-medium">Result</th>
              <th className="px-4 py-3 font-medium">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <AuditRow key={item.id} item={item} readOnly={s.status === 'closed'} onMark={mark.mutate} busy={mark.isPending} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function AuditRow({
  item,
  readOnly,
  onMark,
  busy,
}: {
  item: AuditItem;
  readOnly: boolean;
  onMark: (input: { assetId: string; status: 'found' | 'missing' | 'unexpected'; note?: string }) => void;
  busy: boolean;
}) {
  return (
    <tr className="border-b border-border/60 transition-colors last:border-0 hover:bg-muted/50">
      <td className="px-4 py-3">
        <p className="font-medium">{item.asset.name}</p>
        <p className="font-mono text-xs text-muted-foreground">{item.asset.number}</p>
      </td>
      <td className="px-4 py-3">
        {item.status ? (
          <span className={`whitespace-nowrap rounded-full border px-2 py-0.5 text-xs capitalize ${ITEM_BADGE[item.status]}`}>
            {item.status}
            {item.note ? ` · ${item.note}` : ''}
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">Not checked</span>
        )}
        {item.checkedBy && <p className="mt-0.5 text-xs text-muted-foreground">by {item.checkedBy.name}</p>}
      </td>
      <td className="px-4 py-3">
        {!readOnly && (
          <div className="flex justify-end gap-1">
            <button
              type="button"
              disabled={busy}
              onClick={() => onMark({ assetId: item.assetId, status: 'found' })}
              className="cursor-pointer rounded-md border border-border bg-card px-2.5 py-1 text-xs transition-colors hover:border-ring/40 disabled:opacity-40"
            >
              Found
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => onMark({ assetId: item.assetId, status: 'missing' })}
              className="cursor-pointer rounded-md border border-border bg-card px-2.5 py-1 text-xs transition-colors hover:border-ring/40 disabled:opacity-40"
            >
              Missing
            </button>
          </div>
        )}
      </td>
    </tr>
  );
}
