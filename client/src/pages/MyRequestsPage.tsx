import { useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { SrStatusBadge } from '@/components/ServiceBadges';
import { apiErrorMessage } from '@/lib/api';
import { requestsApi, type ServiceRequest } from '@/lib/serviceApi';

const buttonPrimary =
  'cursor-pointer rounded-md bg-primary px-4 py-2 text-sm font-medium text-on-primary transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50';
const buttonGhost =
  'cursor-pointer rounded-md border border-border bg-card px-3 py-1.5 text-sm transition-colors hover:border-ring/40 disabled:cursor-not-allowed disabled:opacity-40';
const buttonDanger =
  'cursor-pointer rounded-md border border-destructive/40 bg-destructive/10 px-3 py-1.5 text-sm text-destructive transition-colors hover:bg-destructive/20 disabled:cursor-not-allowed disabled:opacity-40';

const FILTERS: { value: string; label: string }[] = [
  { value: '', label: 'All' },
  { value: 'pending_approval', label: 'Pending approval' },
  { value: 'info_requested', label: 'Info requested' },
  { value: 'in_fulfillment', label: 'In fulfillment' },
  { value: 'fulfilled', label: 'Fulfilled' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'canceled', label: 'Canceled' },
];

export default function MyRequestsPage() {
  const [params, setParams] = useSearchParams();
  const status = params.get('status') ?? '';
  const [openId, setOpenId] = useState<string | null>(null);

  const requestsQuery = useQuery({
    queryKey: ['service-requests', { status }],
    queryFn: () => requestsApi.list(status ? { status } : {}),
  });

  const setParam = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next);
  };

  const openRequest = openId ? requestsQuery.data?.find((r) => r.id === openId) ?? null : null;

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">My service requests</h1>
          <p className="text-sm text-muted-foreground">Track what you have requested and answer follow-ups.</p>
        </div>
        <Link to="/catalog" className={buttonPrimary}>
          Browse catalog
        </Link>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.value}
            type="button"
            onClick={() => setParam('status', f.value)}
            className={`cursor-pointer rounded-full border px-3 py-1.5 text-sm transition-colors ${
              status === f.value
                ? 'border-primary bg-primary text-on-primary'
                : 'border-border bg-card text-muted-foreground hover:border-ring/40 hover:text-foreground'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div className="mt-4 overflow-hidden rounded-xl border border-border bg-card">
        {requestsQuery.isLoading ? (
          <div className="space-y-2 p-5">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="h-10 animate-pulse rounded-md bg-muted" />
            ))}
          </div>
        ) : requestsQuery.isError ? (
          <p role="alert" className="p-5 text-sm text-destructive">
            {apiErrorMessage(requestsQuery.error, 'Failed to load your requests')}
          </p>
        ) : requestsQuery.data?.length === 0 ? (
          <div className="p-10 text-center">
            <p className="text-sm text-muted-foreground">No service requests here yet.</p>
            <Link to="/catalog" className="mt-2 inline-block cursor-pointer text-sm text-primary hover:underline">
              Browse the service catalog
            </Link>
          </div>
        ) : (
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-4 py-3 font-medium">Number</th>
                <th className="px-4 py-3 font-medium">Service</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="hidden px-4 py-3 font-medium md:table-cell">Submitted</th>
                <th className="px-4 py-3 font-medium text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              {requestsQuery.data?.map((r) => (
                <tr key={r.id} className="border-b border-border/60 transition-colors last:border-0 hover:bg-muted/50">
                  <td className="whitespace-nowrap px-4 py-3 font-mono text-xs">{r.number}</td>
                  <td className="max-w-xs px-4 py-3">
                    <button type="button" onClick={() => setOpenId(r.id)} className="block cursor-pointer truncate text-left hover:underline">
                      {r.catalogItem.name}
                    </button>
                  </td>
                  <td className="px-4 py-3">
                    <SrStatusBadge status={r.status} />
                  </td>
                  <td className="hidden whitespace-nowrap px-4 py-3 text-muted-foreground md:table-cell">
                    {new Date(r.createdAt).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {r.status === 'info_requested' && (
                      <span className="mr-2 text-xs font-medium text-warning">Needs your reply</span>
                    )}
                    <button type="button" onClick={() => setOpenId(r.id)} className="cursor-pointer text-primary hover:underline">
                      View
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {openRequest && <RequestDetailDialog request={openRequest} onClose={() => setOpenId(null)} />}
    </div>
  );
}

/* ── Detail dialog: answers, approval progress, info loop, cancel ────────── */

function RequestDetailDialog({ request, onClose }: { request: ServiceRequest; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [error, setError] = useState('');
  const [showInfoForm, setShowInfoForm] = useState(false);
  const [infoNote, setInfoNote] = useState('');

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['service-requests'] });
  };

  const addInfo = useMutation({
    mutationFn: () => requestsApi.addInfo(request.id, infoNote),
    onSuccess: () => {
      setShowInfoForm(false);
      setInfoNote('');
      setError('');
      refresh();
    },
    onError: (e) => setError(apiErrorMessage(e, 'Could not send the information')),
  });

  const cancel = useMutation({
    mutationFn: () => requestsApi.cancel(request.id),
    onSuccess: () => {
      setError('');
      refresh();
    },
    onError: (e) => setError(apiErrorMessage(e, 'Could not cancel the request')),
  });

  const submitInfo = (e: FormEvent) => {
    e.preventDefault();
    if (!infoNote.trim()) return;
    addInfo.mutate();
  };

  const answers = Object.entries(request.answers ?? {});

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={`${request.catalogItem.name} ${request.number}`}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose();
      }}
    >
      <div className="max-h-[85vh] w-full max-w-xl overflow-y-auto rounded-xl border border-border bg-card p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-base font-semibold">{request.catalogItem.name}</h3>
            <p className="mt-0.5 font-mono text-xs text-muted-foreground">{request.number}</p>
          </div>
          <SrStatusBadge status={request.status} />
        </div>

        {request.rejectionReason && (
          <div className="mt-3 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
            <span className="font-medium">Rejected:</span> {request.rejectionReason}
          </div>
        )}

        {request.status === 'info_requested' && (
          <div className="mt-3 rounded-md border border-secondary/30 bg-secondary/10 p-3 text-sm">
            <span className="font-medium text-secondary">The approver asked for more information.</span>{' '}
            <button type="button" onClick={() => setShowInfoForm(true)} className="cursor-pointer text-primary underline">
              Reply below.
            </button>
          </div>
        )}

        {answers.length > 0 && (
          <section className="mt-4">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Your answers</h4>
            <dl className="mt-2 space-y-1.5 text-sm">
              {answers.map(([k, v]) => (
                <div key={k} className="flex gap-2">
                  <dt className="min-w-32 shrink-0 text-muted-foreground">{prettyKey(k)}</dt>
                  <dd className="break-words">{v === true ? 'Yes' : v === false ? 'No' : String(v)}</dd>
                </div>
              ))}
            </dl>
          </section>
        )}

        {request.approval && (
          <section className="mt-4">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Approval progress</h4>
            <ol className="mt-2 space-y-2 text-sm">
              {request.approval.steps.map((step, i) => {
                const isCurrent = request.approval!.status === 'pending' && i === request.approval!.currentStep;
                const settled = request.approval!.status !== 'pending';
                const stateClass = settled
                  ? request.approval!.status === 'approved'
                    ? 'text-accent'
                    : 'text-muted-foreground'
                  : isCurrent
                    ? 'text-warning'
                    : 'text-muted-foreground';
                return (
                  <li key={i} className={`flex items-center gap-2 ${step.skipped ? 'opacity-50' : ''}`}>
                    <span className={`font-medium ${stateClass}`}>
                      {settled
                        ? request.approval!.status === 'approved'
                          ? '✓'
                          : '×'
                        : isCurrent
                          ? '●'
                          : '○'}
                    </span>
                    <span>
                      {step.name} <span className="text-xs text-muted-foreground">({step.mode})</span>
                      {step.skipped && <span className="ml-1 text-xs text-muted-foreground">— skipped</span>}
                    </span>
                  </li>
                );
              })}
            </ol>
          </section>
        )}

        {(request.infoRequests?.length ?? 0) > 0 && (
          <section className="mt-4">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Information rounds</h4>
            <ul className="mt-2 space-y-1.5 text-sm">
              {request.infoRequests!.map((round) => (
                <li key={round.round} className="rounded-md bg-muted/50 p-2">
                  <span className="text-xs text-muted-foreground">Round {round.round} · {new Date(round.at).toLocaleString()}</span>
                  <p className="mt-0.5">{round.note}</p>
                </li>
              ))}
            </ul>
          </section>
        )}

        {showInfoForm && request.status === 'info_requested' && (
          <form onSubmit={submitInfo} className="mt-4">
            <label className="block text-sm">
              <span className="mb-1 block font-medium">Your reply *</span>
              <textarea
                rows={3}
                required
                maxLength={5000}
                value={infoNote}
                onChange={(e) => setInfoNote(e.target.value)}
                className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm transition-colors hover:border-ring/40 focus:border-ring"
              />
            </label>
            <div className="mt-2 flex gap-2">
              <button type="submit" disabled={addInfo.isPending} className={buttonPrimary}>
                {addInfo.isPending ? 'Sending…' : 'Send reply'}
              </button>
              <button type="button" onClick={() => setShowInfoForm(false)} className={buttonGhost}>
                Cancel
              </button>
            </div>
          </form>
        )}

        {error && (
          <p role="alert" className="mt-3 text-sm text-destructive">
            {error}
          </p>
        )}

        <div className="mt-5 flex gap-2">
          <button type="button" onClick={onClose} className={buttonGhost}>
            Close
          </button>
          {['pending_approval', 'info_requested', 'in_fulfillment'].includes(request.status) && (
            <button
              type="button"
              disabled={cancel.isPending}
              onClick={() => {
                if (window.confirm(`Cancel request ${request.number}? This cannot be undone.`)) cancel.mutate();
              }}
              className={`${buttonDanger} ml-auto`}
            >
              {cancel.isPending ? 'Canceling…' : 'Cancel request'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function prettyKey(key: string): string {
  return key
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, (c) => c.toUpperCase())
    .trim();
}
