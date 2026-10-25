import { useState } from 'react';
import type { ChangeEvent, FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { PriorityBadge, SlaChips, STATUS_LABELS, StatusBadge } from '@/components/TicketBadges';
import FindRelatedModal from '@/components/problems/FindRelatedModal';
import { apiErrorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { ticketsApi, type TicketStatus } from '@/lib/ticketsApi';

function formatWhen(iso: string) {
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

const ACTIVITY_LABELS: Record<string, string> = {
  created: 'created the ticket',
  assigned: 'updated assignment',
  status_changed: 'changed status',
  reopened: 'reopened the ticket',
  priority_changed: 'changed priority',
  attachment_added: 'attached a file',
};

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function TicketDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { user, hasAnyPermission } = useAuth();
  const queryClient = useQueryClient();

  const [comment, setComment] = useState('');
  const [isInternal, setIsInternal] = useState(false);
  const [resolutionNote, setResolutionNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  // Above the loading/error early returns — a hook after those would break
  // the Rules of Hooks on the first render where data is still missing.
  const [showFindRelated, setShowFindRelated] = useState(false);

  const detailQuery = useQuery({
    queryKey: ['ticket', id],
    queryFn: () => ticketsApi.get(id!),
    enabled: Boolean(id),
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['ticket', id] });
    void queryClient.invalidateQueries({ queryKey: ['tickets'] });
    void queryClient.invalidateQueries({ queryKey: ['ticket-queues'] });
  };

  const transition = useMutation({
    mutationFn: (input: { status: 'in_progress' | 'pending_employee' | 'pending_vendor' | 'resolved' | 'closed'; resolutionNote?: string; version: number }) =>
      ticketsApi.transition(id!, input),
    onSuccess: () => {
      setError(null);
      setResolutionNote('');
      invalidate();
    },
    onError: (err) => setError(apiErrorMessage(err)),
  });

  const assign = useMutation({
    mutationFn: (assigneeId: string) => ticketsApi.assign(id!, { assigneeId }),
    onSuccess: () => {
      setError(null);
      invalidate();
    },
    onError: (err) => setError(apiErrorMessage(err)),
  });

  const postComment = useMutation({
    mutationFn: () => ticketsApi.addComment(id!, comment, isInternal),
    onSuccess: () => {
      setComment('');
      setIsInternal(false);
      invalidate();
    },
    onError: (err) => setError(apiErrorMessage(err)),
  });

  const uploadFile = useMutation({
    mutationFn: (file: File) => ticketsApi.uploadAttachment(id!, file),
    onSuccess: () => {
      setError(null);
      invalidate();
    },
    onError: (err) => setError(apiErrorMessage(err)),
  });

  const downloadFile = useMutation({
    mutationFn: (a: { id: string; filename: string }) => ticketsApi.downloadAttachment(id!, a.id, a.filename),
    onError: (err) => setError(apiErrorMessage(err)),
  });

  const handleFilePicked = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) uploadFile.mutate(file);
    e.target.value = ''; // allow re-picking the same file
  };

  if (detailQuery.isLoading) {
    return (
      <div className="space-y-3">
        <div className="h-8 w-72 animate-pulse rounded bg-muted" />
        <div className="h-40 animate-pulse rounded-xl bg-muted" />
        <div className="h-64 animate-pulse rounded-xl bg-muted" />
      </div>
    );
  }
  if (detailQuery.isError || !detailQuery.data) {
    return (
      <p role="alert" className="text-sm text-destructive">
        {apiErrorMessage(detailQuery.error, 'Ticket not found')}
      </p>
    );
  }

  const t = detailQuery.data;
  const canUpdate = hasAnyPermission(['tickets:update']);
  const canResolve = hasAnyPermission(['tickets:resolve']);
  const canClose = hasAnyPermission(['tickets:close']);
  const canAssign = hasAnyPermission(['tickets:assign']);
  const canWorknotes = hasAnyPermission(['tickets:worknotes']);
  const canSeeProblems = hasAnyPermission(['problems:read']);
  const isRequester = t.requester.id === user?.employee?.id;

  const doTransition = (status: 'in_progress' | 'pending_employee' | 'pending_vendor' | 'resolved' | 'closed') => {
    transition.mutate({ status, resolutionNote: status === 'resolved' ? resolutionNote : undefined, version: t.version });
  };

  const handleComment = (e: FormEvent) => {
    e.preventDefault();
    if (comment.trim()) postComment.mutate();
  };

  const transitionButtons: { label: string; status: 'in_progress' | 'pending_employee' | 'pending_vendor' | 'resolved' | 'closed'; need: boolean; show: boolean }[] = [
    { label: 'Start work', status: 'in_progress' as const, need: false, show: canUpdate && ['new', 'pending_employee', 'pending_vendor'].includes(t.status) },
    { label: 'Wait for employee', status: 'pending_employee' as const, need: false, show: canUpdate && ['new', 'in_progress'].includes(t.status) },
    { label: 'Wait for vendor', status: 'pending_vendor' as const, need: false, show: canUpdate && ['new', 'in_progress'].includes(t.status) },
    { label: 'Resolve', status: 'resolved' as const, need: true, show: canResolve && ['new', 'in_progress', 'pending_employee', 'pending_vendor'].includes(t.status) },
    { label: 'Close', status: 'closed' as const, need: false, show: canClose && t.status === 'resolved' },
    { label: 'Reopen', status: 'in_progress' as const, need: false, show: (canUpdate || isRequester) && t.status === 'resolved' },
  ].filter((b) => b.show);

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <div className="space-y-6 lg:col-span-2">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <Link to="/tickets" className="text-sm text-primary hover:underline">
              ← Tickets
            </Link>
            <span className="font-mono text-xs text-muted-foreground">{t.number}</span>
          </div>
          <h1 className="mt-1 text-2xl font-semibold">{t.title}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <StatusBadge status={t.status} />
            <PriorityBadge priority={t.priority} />
            <SlaChips sla={t.sla} />
            <span className="rounded-full border border-border px-2 py-0.5 text-xs capitalize text-muted-foreground">
              {t.category.replace('_', ' ')}
            </span>
          </div>
          {t.priorityOverrideReason && (
            <p className="mt-2 rounded-md bg-warning/10 px-3 py-1.5 text-xs text-warning">
              Priority overridden: {t.priorityOverrideReason}
            </p>
          )}
        </div>

        <section className="rounded-xl border border-border bg-card p-5">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Description</h2>
          <p className="mt-2 whitespace-pre-wrap text-sm">{t.description}</p>
        </section>

        {t.resolutionNote && (
          <section className="rounded-xl border border-accent/40 bg-accent/5 p-5">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-accent">Resolution</h2>
            <p className="mt-2 whitespace-pre-wrap text-sm">{t.resolutionNote}</p>
          </section>
        )}

        {/* Attachments */}
        <section className="rounded-xl border border-border bg-card p-5">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Attachments ({t.attachments.length})
            </h2>
            <label
              className="cursor-pointer rounded-md border border-border bg-background px-3 py-1.5 text-sm transition-colors hover:border-ring hover:bg-muted"
            >
              {uploadFile.isPending ? 'Uploading…' : 'Attach file'}
              <input type="file" className="sr-only" onChange={handleFilePicked} disabled={uploadFile.isPending} />
            </label>
          </div>
          {t.attachments.length === 0 ? (
            <p className="mt-3 text-sm text-muted-foreground">No files attached yet.</p>
          ) : (
            <ul className="mt-3 divide-y divide-border">
              {t.attachments.map((a) => (
                <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{a.filename}</p>
                    <p className="text-xs text-muted-foreground">
                      {formatSize(a.sizeBytes)} · {a.uploadedBy.name} · {formatWhen(a.createdAt)}
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={downloadFile.isPending}
                    onClick={() => downloadFile.mutate({ id: a.id, filename: a.filename })}
                    className="cursor-pointer rounded-md border border-border bg-background px-3 py-1.5 text-xs transition-colors hover:border-ring hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Download
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Actions */}
        {(transitionButtons.length > 0 || canSeeProblems) && (
          <section className="rounded-xl border border-border bg-card p-5">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Actions</h2>
            <div className="mt-3 flex flex-wrap gap-2">
              {transitionButtons.map((b) => (
                <button
                  key={b.label}
                  type="button"
                  disabled={transition.isPending}
                  onClick={() => doTransition(b.status)}
                  className="cursor-pointer rounded-md border border-border bg-background px-4 py-2 text-sm transition-colors hover:border-ring hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {b.label}
                </button>
              ))}
              {canSeeProblems && (
                <button
                  type="button"
                  onClick={() => setShowFindRelated(true)}
                  className="cursor-pointer rounded-md border border-border bg-background px-4 py-2 text-sm transition-colors hover:border-ring hover:bg-muted"
                >
                  Find related problems
                </button>
              )}
            </div>
            {(transitionButtons.some((b) => b.need) || transition.error) && (
              <div className="mt-3">
                <label htmlFor="resolution" className="mb-1 block text-xs text-muted-foreground">
                  Resolution note (required to resolve)
                </label>
                <textarea
                  id="resolution"
                  rows={2}
                  value={resolutionNote}
                  onChange={(e) => setResolutionNote(e.target.value)}
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm transition-colors hover:border-ring/40 focus:border-ring"
                />
              </div>
            )}
          </section>
        )}

        {/* Comments */}
        <section className="rounded-xl border border-border bg-card p-5">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Conversation</h2>
          <div className="mt-3 space-y-3">
            {t.comments.length === 0 && <p className="text-sm text-muted-foreground">No comments yet.</p>}
            {t.comments.map((c) => (
              <article key={c.id} className={`rounded-lg border p-3 ${c.isInternal ? 'border-warning/40 bg-warning/5' : 'border-border bg-background'}`}>
                <header className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">{c.author.name}</span>
                  <span>· {formatWhen(c.createdAt)}</span>
                  {c.isInternal && <span className="rounded-full bg-warning/15 px-2 py-0.5 font-medium text-warning">Internal</span>}
                </header>
                <p className="mt-1.5 whitespace-pre-wrap text-sm">{c.body}</p>
              </article>
            ))}
          </div>
          {t.status !== 'closed' && t.status !== 'canceled' && (
            <form onSubmit={handleComment} className="mt-4">
              <textarea
                rows={3}
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder={canWorknotes ? 'Write a reply (toggle below for internal work note)…' : 'Write a reply…'}
                aria-label="New comment"
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm transition-colors hover:border-ring/40 focus:border-ring"
              />
              <div className="mt-2 flex items-center justify-between">
                {canWorknotes ? (
                  <label className="flex cursor-pointer items-center gap-2 text-sm text-muted-foreground">
                    <input
                      type="checkbox"
                      checked={isInternal}
                      onChange={(e) => setIsInternal(e.target.checked)}
                      className="h-4 w-4 cursor-pointer accent-warning"
                    />
                    Internal work note (hidden from requester)
                  </label>
                ) : (
                  <span />
                )}
                <button
                  type="submit"
                  disabled={postComment.isPending || !comment.trim()}
                  className="cursor-pointer rounded-md bg-primary px-4 py-2 text-sm font-medium text-on-primary transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {postComment.isPending ? 'Sending…' : 'Comment'}
                </button>
              </div>
            </form>
          )}
        </section>

        {showFindRelated && (
          <FindRelatedModal
            incidentId={t.id}
            incidentNumber={t.number}
            onClose={() => setShowFindRelated(false)}
          />
        )}
      </div>

      {/* Side panel */}
      <div className="space-y-6">
        {error && (
          <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        )}

        <section className="rounded-xl border border-border bg-card p-5 text-sm">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Details</h2>
          <dl className="mt-3 space-y-2.5">
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">Requester</dt>
              <dd className="text-right">{t.requester.name}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">Assignee</dt>
              <dd className="text-right">{t.assignee?.name ?? 'Unassigned'}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">Group</dt>
              <dd className="text-right">{t.group?.name ?? '—'}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">Impact × Urgency</dt>
              <dd className="text-right capitalize">
                {t.impact} × {t.urgency}
              </dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">Created</dt>
              <dd className="text-right">{formatWhen(t.createdAt)}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">Updated</dt>
              <dd className="text-right">{formatWhen(t.updatedAt)}</dd>
            </div>
            {t.reopenedCount > 0 && (
              <div className="flex justify-between gap-3">
                <dt className="text-muted-foreground">Times reopened</dt>
                <dd className="text-right">{t.reopenedCount}</dd>
              </div>
            )}
          </dl>
        </section>

        {canAssign && !['closed', 'canceled'].includes(t.status) && <AssignPanel current={t.assignee?.id ?? null} onAssign={(eid) => assign.mutate(eid)} busy={assign.isPending} />}

        <section className="rounded-xl border border-border bg-card p-5">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Timeline</h2>
          <ol className="mt-3 space-y-3">
            {[...t.activities].reverse().map((a) => (
              <li key={a.id} className="border-l-2 border-border pl-3 text-sm">
                <p>
                  <span className="font-medium">{a.actor?.name ?? 'System'}</span>{' '}
                  <span className="text-muted-foreground">{ACTIVITY_LABELS[a.action] ?? a.action}</span>
                </p>
                {a.action === 'status_changed' && a.detail && (
                  <p className="text-xs text-muted-foreground">
                    {STATUS_LABELS[(a.detail.from as TicketStatus) ?? 'new']} →{' '}
                    {STATUS_LABELS[(a.detail.to as TicketStatus) ?? 'new']}
                  </p>
                )}
                <p className="text-xs text-muted-foreground">{formatWhen(a.createdAt)}</p>
              </li>
            ))}
          </ol>
        </section>
      </div>
    </div>
  );
}

function AssignPanel({ current, onAssign, busy }: { current: string | null; onAssign: (employeeId: string) => void; busy: boolean }) {
  const usersQuery = useQuery({ queryKey: ['users-options'], queryFn: ticketsApi.users, staleTime: 60_000 });
  const options = (usersQuery.data ?? []).filter((u) => u.employee);

  return (
    <section className="rounded-xl border border-border bg-card p-5">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Assignment</h2>
      <label htmlFor="assignee" className="sr-only">
        Assign to
      </label>
      <select
        id="assignee"
        value={current ?? ''}
        disabled={busy || usersQuery.isLoading}
        onChange={(e) => e.target.value && onAssign(e.target.value)}
        className="mt-3 w-full cursor-pointer rounded-md border border-border bg-background px-3 py-2 text-sm transition-colors hover:border-ring/40 focus:border-ring disabled:cursor-not-allowed disabled:opacity-60"
      >
        <option value="">Unassigned</option>
        {options.map((u) => (
          <option key={u.id} value={u.employee!.id}>
            {u.name} ({u.email})
          </option>
        ))}
      </select>
    </section>
  );
}
