import { useState } from 'react';
import type { FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { deadlineLabel, MODE_LABELS } from '@/components/ServiceBadges';
import { apiErrorMessage } from '@/lib/api';
import { approvalsApi, type QueueEntry } from '@/lib/serviceApi';

const buttonPrimary =
  'cursor-pointer rounded-md bg-primary px-4 py-2 text-sm font-medium text-on-primary transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50';
const buttonGhost =
  'cursor-pointer rounded-md border border-border bg-card px-3 py-1.5 text-sm transition-colors hover:border-ring/40 disabled:cursor-not-allowed disabled:opacity-40';
const buttonApprove =
  'cursor-pointer rounded-md border border-accent/40 bg-accent/10 px-3 py-1.5 text-sm text-accent transition-colors hover:bg-accent/20 disabled:cursor-not-allowed disabled:opacity-40';
const buttonDanger =
  'cursor-pointer rounded-md border border-destructive/40 bg-destructive/10 px-3 py-1.5 text-sm text-destructive transition-colors hover:bg-destructive/20 disabled:cursor-not-allowed disabled:opacity-40';

export default function ApprovalsPage() {
  const queueQuery = useQuery({ queryKey: ['approval-queue'], queryFn: approvalsApi.queue });
  const [deciding, setDeciding] = useState<QueueEntry | null>(null);
  const [notice, setNotice] = useState('');

  return (
    <div>
      <h1 className="text-2xl font-semibold">Approvals</h1>
      <p className="text-sm text-muted-foreground">
        {queueQuery.data
          ? `${queueQuery.data.length} step${queueQuery.data.length === 1 ? '' : 's'} waiting for your decision`
          : 'Loading…'}
      </p>

      {notice && (
        <p role="status" className="mt-3 rounded-md border border-accent/40 bg-accent/10 p-2.5 text-sm text-accent">
          {notice}
        </p>
      )}

      <div className="mt-4 space-y-3">
        {queueQuery.isLoading ? (
          <div className="space-y-3">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="h-28 animate-pulse rounded-xl bg-muted" />
            ))}
          </div>
        ) : queueQuery.isError ? (
          <p role="alert" className="text-sm text-destructive">
            {apiErrorMessage(queueQuery.error, 'Failed to load your approval queue')}
          </p>
        ) : queueQuery.data?.length === 0 ? (
          <div className="rounded-xl border border-border bg-card p-10 text-center">
            <p className="text-sm text-muted-foreground">Nothing is waiting for you — you are all caught up.</p>
          </div>
        ) : (
          queueQuery.data?.map((entry) => (
            <article key={entry.id} className="rounded-xl border border-border bg-card p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="font-medium">{entry.target?.catalogItem.name ?? 'Service request'}</h2>
                  <p className="mt-0.5 text-sm text-muted-foreground">
                    {entry.target ? `${entry.target.number} · requested by ${entry.target.requester.name}` : ''}
                  </p>
                </div>
                <div className="text-right text-xs text-muted-foreground">
                  <p className="font-medium text-foreground">
                    Step {entry.stepIndex + 1}: {entry.stepName}
                  </p>
                  <p>{MODE_LABELS[entry.mode]}</p>
                  {deadlineLabel(entry.deadlineAt) && (
                    <p className={entry.deadlineAt && Date.parse(entry.deadlineAt) < Date.now() ? 'font-medium text-destructive' : ''}>
                      {deadlineLabel(entry.deadlineAt)}
                    </p>
                  )}
                </div>
              </div>

              {entry.target && Object.keys(entry.target.answers ?? {}).length > 0 && (
                <dl className="mt-3 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
                  {Object.entries(entry.target.answers).map(([k, v]) => (
                    <div key={k} className="flex gap-2">
                      <dt className="shrink-0 text-muted-foreground">{prettyKey(k)}:</dt>
                      <dd className="min-w-0 break-words">{v === true ? 'Yes' : v === false ? 'No' : String(v)}</dd>
                    </div>
                  ))}
                </dl>
              )}

              <div className="mt-3 flex flex-wrap gap-2">
                <button type="button" onClick={() => setDeciding(entry)} className={buttonPrimary}>
                  Review & decide
                </button>
              </div>
            </article>
          ))
        )}
      </div>

      {deciding && (
        <DecideDialog
          entry={deciding}
          onClose={() => setDeciding(null)}
          onDone={(msg) => {
            setDeciding(null);
            setNotice(msg);
          }}
        />
      )}
    </div>
  );
}

/* ── Decide dialog ────────────────────────────────────────────────────────── */

function DecideDialog({
  entry,
  onClose,
  onDone,
}: {
  entry: QueueEntry;
  onClose: () => void;
  onDone: (msg: string) => void;
}) {
  const queryClient = useQueryClient();
  const [error, setError] = useState('');
  const [reason, setReason] = useState('');
  const [showDelegate, setShowDelegate] = useState(false);
  const [delegateId, setDelegateId] = useState('');

  // Delegate picker: colleagues with an active account (requester excluded).
  const optionsQuery = useQuery({
    queryKey: ['approval-delegates'],
    queryFn: approvalsApi.delegates,
  });

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['approval-queue'] });
  };

  const decide = useMutation({
    mutationFn: (decision: 'approved' | 'rejected' | 'info_requested') =>
      approvalsApi.decide(entry.id, { stepIndex: entry.stepIndex, decision, reason: reason.trim() || undefined }),
    onSuccess: (_, decision) => {
      refresh();
      onDone(
        decision === 'approved'
          ? 'Approved — the request moved on.'
          : decision === 'rejected'
            ? 'Rejected — the requester has been notified.'
            : 'Information requested — waiting on the requester.',
      );
    },
    onError: (e) => setError(apiErrorMessage(e, 'Could not record the decision')),
  });

  const delegate = useMutation({
    mutationFn: () => approvalsApi.delegate(entry.id, { stepIndex: entry.stepIndex, delegateUserId: delegateId }),
    onSuccess: () => {
      refresh();
      onDone('Step delegated — it is now on their queue.');
    },
    onError: (e) => setError(apiErrorMessage(e, 'Could not delegate this step')),
  });

  const tryDecide = (decision: 'approved' | 'rejected' | 'info_requested') => {
    setError('');
    if (decision !== 'approved' && !reason.trim()) {
      setError(decision === 'rejected' ? 'A rejection needs a reason.' : 'Tell the requester what you need.');
      return;
    }
    decide.mutate(decision);
  };

  const submitDelegate = (e: FormEvent) => {
    e.preventDefault();
    setError('');
    if (!delegateId) {
      setError('Pick a colleague to delegate to.');
      return;
    }
    delegate.mutate();
  };

  const answers = Object.entries(entry.target?.answers ?? {});
  const infoRounds = entry.target?.infoRequests ?? [];
  const delegateOptions = (optionsQuery.data ?? []).filter((u) => u.id !== entry.target?.requester.id);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={`Review ${entry.target?.number ?? 'approval'}`}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose();
      }}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          tryDecide('approved');
        }}
        className="max-h-[85vh] w-full max-w-xl overflow-y-auto rounded-xl border border-border bg-card p-5"
      >
        <h3 className="text-base font-semibold">{entry.target?.catalogItem.name ?? 'Service request'}</h3>
        <p className="mt-0.5 text-sm text-muted-foreground">
          {entry.target ? `${entry.target.number} · ${entry.target.requester.name} (${entry.target.requester.email})` : ''} · step {entry.stepIndex + 1}: {entry.stepName} ({MODE_LABELS[entry.mode]})
        </p>

        {answers.length > 0 && (
          <section className="mt-4">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Requester's answers</h4>
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

        {infoRounds.length > 0 && (
          <section className="mt-4">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Information rounds</h4>
            <ul className="mt-2 space-y-1.5 text-sm">
              {infoRounds.map((round) => (
                <li key={round.round} className="rounded-md bg-muted/50 p-2">
                  <span className="text-xs text-muted-foreground">Round {round.round} · {new Date(round.at).toLocaleString()}</span>
                  <p className="mt-0.5">{round.note}</p>
                </li>
              ))}
            </ul>
          </section>
        )}

        <label className="mt-4 block text-sm">
          <span className="mb-1 block font-medium">Reason / note</span>
          <textarea
            rows={2}
            maxLength={2000}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Required for rejection or info requests; optional for approvals"
            className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm transition-colors hover:border-ring/40 focus:border-ring"
          />
        </label>

        {error && (
          <p role="alert" className="mt-3 text-sm text-destructive">
            {error}
          </p>
        )}

        <div className="mt-4 flex flex-wrap gap-2">
          <button type="submit" disabled={decide.isPending} className={buttonApprove}>
            Approve
          </button>
          <button type="button" disabled={decide.isPending} onClick={() => tryDecide('rejected')} className={buttonDanger}>
            Reject
          </button>
          <button type="button" disabled={decide.isPending} onClick={() => tryDecide('info_requested')} className={buttonGhost}>
            Request info
          </button>
          <button type="button" onClick={() => setShowDelegate(!showDelegate)} className={`${buttonGhost} ml-auto`}>
            Delegate…
          </button>
        </div>

        {showDelegate && (
          <form onSubmit={submitDelegate} className="mt-3 rounded-lg border border-border p-3">
            <label className="block text-sm">
              <span className="mb-1 block font-medium">Delegate this step to</span>
              <select value={delegateId} onChange={(e) => setDelegateId(e.target.value)} className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm focus:border-ring">
                <option value="">Choose…</option>
                {delegateOptions.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name} ({u.email})
                  </option>
                ))}
              </select>
            </label>
            <div className="mt-2 flex gap-2">
              <button type="submit" disabled={delegate.isPending} className={buttonPrimary}>
                {delegate.isPending ? 'Delegating…' : 'Delegate'}
              </button>
              <button type="button" onClick={() => setShowDelegate(false)} className={buttonGhost}>
                Cancel
              </button>
            </div>
          </form>
        )}

        <div className="mt-4">
          <button type="button" onClick={onClose} className={buttonGhost}>
            Close
          </button>
        </div>
      </form>
    </div>
  );
}

function prettyKey(key: string): string {
  return key
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, (c) => c.toUpperCase())
    .trim();
}
