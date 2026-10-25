import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import { apiErrorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import {
  KNOWN_ERROR_STATUS_LABELS,
  KNOWN_ERROR_TRANSITIONS,
  KNOWN_ERROR_VISIBILITY_LABELS,
  getKnownErrorStatusBadgeClass,
  problemApi,
  problemKeys,
  useKnownError,
  type KnownErrorStatus,
} from '@/lib/problemApi';

import {
  buttonGhost,
  buttonPrimary,
  cardBase,
  inputBase,
  labelBase,
  sectionTitle,
} from '@/components/problems/styles';

const TABS = ['details', 'approval', 'linked'] as const;
type Tab = (typeof TABS)[number];

/** Read-only Details tab: the content a reader comes for. */
function DetailsView({ keId }: { keId: string }) {
  const { data: ke, isLoading, isError, error } = useKnownError(keId);
  const { hasAnyPermission } = useAuth();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [rootCause, setRootCause] = useState('');
  const [symptoms, setSymptoms] = useState('');
  const [workaround, setWorkaround] = useState('');
  const [resolutionNotes, setResolutionNotes] = useState('');
  const [visibility, setVisibility] = useState('IT_ONLY');

  useEffect(() => {
    if (!ke || !editing) return;
    setTitle(ke.title);
    setRootCause(ke.rootCause);
    setSymptoms(ke.symptoms);
    setWorkaround(ke.workaround);
    setResolutionNotes(ke.resolutionNotes ?? '');
    setVisibility(ke.visibility);
  }, [ke, editing]);

  const updateMutation = useMutation({
    mutationFn: () =>
      problemApi.updateKnownError(keId, {
        title,
        rootCause,
        symptoms,
        workaround,
        ...(resolutionNotes.trim() ? { resolutionNotes } : {}),
        visibility: visibility as 'IT_ONLY' | 'EMPLOYEE_SELF_SERVICE',
      }),
    onSuccess: () => {
      setEditing(false);
      setFormError(null);
      queryClient.invalidateQueries({ queryKey: problemKeys.knownErrors.detail(keId) });
      queryClient.invalidateQueries({ queryKey: problemKeys.knownErrors.lists() });
    },
    onError: (e) => setFormError(apiErrorMessage(e, 'Failed to save changes')),
  });

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    updateMutation.mutate();
  };

  if (isLoading) {
    return (
      <div className="space-y-2" aria-busy="true">
        <div className="h-24 animate-pulse rounded-md bg-muted" />
        <div className="h-24 animate-pulse rounded-md bg-muted" />
      </div>
    );
  }
  if (isError || !ke) {
    return (
      <p role="alert" className="text-sm text-destructive">
        {apiErrorMessage(error, 'Failed to load known error')}
      </p>
    );
  }

  const canUpdate = hasAnyPermission(['known_errors:update']);

  if (editing) {
    return (
      <form onSubmit={handleSubmit} className={`${cardBase} space-y-4 p-5`}>
        <div>
          <label htmlFor="ke-title" className={labelBase}>
            Title
          </label>
          <input
            id="ke-title"
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
            minLength={5}
            className={`${inputBase} mt-1`}
          />
        </div>
        <div>
          <label htmlFor="ke-root-cause" className={labelBase}>
            Root cause
          </label>
          <textarea
            id="ke-root-cause"
            rows={4}
            value={rootCause}
            onChange={(e) => setRootCause(e.target.value)}
            required
            minLength={10}
            className={`${inputBase} mt-1`}
          />
        </div>
        <div>
          <label htmlFor="ke-symptoms" className={labelBase}>
            Symptoms
          </label>
          <textarea
            id="ke-symptoms"
            rows={3}
            value={symptoms}
            onChange={(e) => setSymptoms(e.target.value)}
            required
            minLength={10}
            className={`${inputBase} mt-1`}
          />
        </div>
        <div>
          <label htmlFor="ke-workaround" className={labelBase}>
            Workaround
          </label>
          <textarea
            id="ke-workaround"
            rows={4}
            value={workaround}
            onChange={(e) => setWorkaround(e.target.value)}
            required
            minLength={10}
            className={`${inputBase} mt-1`}
          />
        </div>
        <div>
          <label htmlFor="ke-resolution-notes" className={labelBase}>
            Resolution notes <span className="font-normal text-muted-foreground">(optional)</span>
          </label>
          <textarea
            id="ke-resolution-notes"
            rows={3}
            value={resolutionNotes}
            onChange={(e) => setResolutionNotes(e.target.value)}
            className={`${inputBase} mt-1`}
          />
        </div>
        <div>
          <label htmlFor="ke-visibility" className={labelBase}>
            Visibility
          </label>
          <select
            id="ke-visibility"
            value={visibility}
            onChange={(e) => setVisibility(e.target.value)}
            className={`${inputBase} mt-1`}
          >
            <option value="IT_ONLY">IT only</option>
            <option value="EMPLOYEE_SELF_SERVICE">Employee self-service</option>
          </select>
          {visibility === 'EMPLOYEE_SELF_SERVICE' && ke.status !== 'PUBLISHED' && (
            <p className="mt-1 text-xs text-muted-foreground">
              Employee visibility takes effect once the known error is published.
            </p>
          )}
        </div>

        {formError && (
          <p role="alert" className="text-sm text-destructive">
            {formError}
          </p>
        )}

        <div className="flex gap-2">
          <button type="submit" disabled={updateMutation.isPending} className={buttonPrimary}>
            {updateMutation.isPending ? 'Saving…' : 'Save changes'}
          </button>
          <button
            type="button"
            onClick={() => {
              setEditing(false);
              setFormError(null);
            }}
            className={buttonGhost}
          >
            Cancel
          </button>
        </div>
      </form>
    );
  }

  return (
    <div className="space-y-4">
      {canUpdate && (
        <div className="flex justify-end">
          <button type="button" onClick={() => setEditing(true)} className={buttonGhost}>
            Edit details
          </button>
        </div>
      )}
      <section className={`${cardBase} p-5`}>
        <h2 className={sectionTitle}>Root cause</h2>
        <p className="mt-2 whitespace-pre-wrap text-sm">{ke.rootCause}</p>
      </section>
      <section className={`${cardBase} p-5`}>
        <h2 className={sectionTitle}>Symptoms</h2>
        <p className="mt-2 whitespace-pre-wrap text-sm">{ke.symptoms}</p>
      </section>
      <section className={`${cardBase} p-5`}>
        <h2 className={sectionTitle}>Workaround</h2>
        <p className="mt-2 whitespace-pre-wrap text-sm">{ke.workaround}</p>
      </section>
      {ke.resolutionNotes && (
        <section className={`${cardBase} p-5`}>
          <h2 className={sectionTitle}>Resolution notes</h2>
          <p className="mt-2 whitespace-pre-wrap text-sm">{ke.resolutionNotes}</p>
        </section>
      )}
      <section className={`${cardBase} p-5`}>
        <h2 className={sectionTitle}>Visibility</h2>
        <p className="mt-2 text-sm">{KNOWN_ERROR_VISIBILITY_LABELS[ke.visibility]}</p>
      </section>
    </div>
  );
}

/** Approval tab: lifecycle transitions plus the approval record. */
function ApprovalView({ keId }: { keId: string }) {
  const { data: ke, isLoading, isError, error } = useKnownError(keId);
  const { hasAnyPermission } = useAuth();
  const queryClient = useQueryClient();
  const [target, setTarget] = useState<KnownErrorStatus | ''>('');
  const [reviewNotes, setReviewNotes] = useState('');
  const [error_, setError_] = useState<string | null>(null);

  const transitionMutation = useMutation({
    mutationFn: () => problemApi.transitionKnownErrorStatus(keId, target as KnownErrorStatus, reviewNotes.trim() ? { reviewNotes } : {}),
    onSuccess: () => {
      setError_(null);
      setReviewNotes('');
      queryClient.invalidateQueries({ queryKey: problemKeys.knownErrors.detail(keId) });
      queryClient.invalidateQueries({ queryKey: problemKeys.knownErrors.lists() });
    },
    onError: (e) => setError_(apiErrorMessage(e, 'Failed to change status')),
  });

  if (isLoading) return <div className="h-24 animate-pulse rounded-md bg-muted" aria-busy="true" />;
  if (isError || !ke) {
    return (
      <p role="alert" className="text-sm text-destructive">
        {apiErrorMessage(error, 'Failed to load known error')}
      </p>
    );
  }

  const canApprove = hasAnyPermission(['known_errors:approve']);
  const allowed = KNOWN_ERROR_TRANSITIONS[ke.status];

  return (
    <div className="space-y-4">
      <section className={`${cardBase} p-5`}>
        <h2 className={sectionTitle}>Status</h2>
        <dl className="mt-3 space-y-2 text-sm">
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground">Current status</dt>
            <dd>{KNOWN_ERROR_STATUS_LABELS[ke.status]}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground">Approved by</dt>
            <dd>{ke.approvedBy?.name ?? '—'}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground">Approved at</dt>
            <dd>{ke.approvedAt ? new Date(ke.approvedAt).toLocaleString() : '—'}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground">Review due</dt>
            <dd>{ke.reviewDueAt ? new Date(ke.reviewDueAt).toLocaleDateString() : '—'}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground">Last reviewed</dt>
            <dd>{ke.lastReviewedAt ? new Date(ke.lastReviewedAt).toLocaleDateString() : '—'}</dd>
          </div>
        </dl>

        {canApprove && allowed.length > 0 && (
          <form
            className="mt-4 space-y-3 border-t border-border pt-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (target) transitionMutation.mutate();
            }}
          >
            <div>
              <label htmlFor="ke-status-transition" className={labelBase}>
                Change status to
              </label>
              <select
                id="ke-status-transition"
                value={target}
                onChange={(e) => setTarget(e.target.value as KnownErrorStatus | '')}
                className={`${inputBase} mt-1`}
              >
                <option value="">Select a status…</option>
                {allowed.map((status) => (
                  <option key={status} value={status}>
                    {KNOWN_ERROR_STATUS_LABELS[status]}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="ke-review-notes" className={labelBase}>
                Review notes <span className="font-normal text-muted-foreground">(optional)</span>
              </label>
              <textarea
                id="ke-review-notes"
                rows={2}
                value={reviewNotes}
                onChange={(e) => setReviewNotes(e.target.value)}
                maxLength={2000}
                className={`${inputBase} mt-1`}
              />
            </div>
            {error_ && (
              <p role="alert" className="text-sm text-destructive">
                {error_}
              </p>
            )}
            <button type="submit" disabled={!target || transitionMutation.isPending} className={buttonPrimary}>
              {transitionMutation.isPending ? 'Applying…' : 'Apply transition'}
            </button>
          </form>
        )}
        {canApprove && allowed.length === 0 && (
          <p className="mt-4 border-t border-border pt-4 text-sm text-muted-foreground">
            Retired known errors are terminal — no further transitions.
          </p>
        )}
      </section>
    </div>
  );
}

/** Linked tab: the source problem and any KB article published from this error. */
function LinkedView({ keId }: { keId: string }) {
  const { data: ke, isLoading, isError, error } = useKnownError(keId);

  if (isLoading) return <div className="h-24 animate-pulse rounded-md bg-muted" aria-busy="true" />;
  if (isError || !ke) {
    return (
      <p role="alert" className="text-sm text-destructive">
        {apiErrorMessage(error, 'Failed to load known error')}
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <section className={`${cardBase} p-5`}>
        <h2 className={sectionTitle}>Problem</h2>
        <p className="mt-2 text-sm">
          <Link to={`/problems/${ke.problem.id}`} className="font-mono text-xs text-primary hover:underline">
            {ke.problem.number}
          </Link>{' '}
          — {ke.problem.title}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          The incidents linked to that problem are the evidence this known error explains.
        </p>
      </section>

      <section className={`${cardBase} p-5`}>
        <h2 className={sectionTitle}>Knowledge base article</h2>
        {ke.publishedArticle ? (
          <p className="mt-2 text-sm">
            <Link to={`/knowledge/${ke.publishedArticle.id}`} className="text-primary hover:underline">
              {ke.publishedArticle.title}
            </Link>{' '}
            <span className="text-xs text-muted-foreground">
              ({ke.publishedArticle.status}, {ke.publishedArticle.visibility === 'EMPLOYEE_SELF_SERVICE' ? 'employee-visible' : 'IT only'})
            </span>
          </p>
        ) : (
          <p className="mt-2 text-sm text-muted-foreground">
            Not published to the knowledge base yet.
          </p>
        )}
      </section>
    </div>
  );
}

export default function KnownErrorDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [params, setParams] = useSearchParams();
  const tabParam = params.get('tab');
  const tab: Tab = TABS.includes(tabParam as Tab) ? (tabParam as Tab) : 'details';
  const { data: ke, isLoading, isError, error } = useKnownError(id ?? '');
  const { hasAnyPermission } = useAuth();
  const queryClient = useQueryClient();
  const [publishError, setPublishError] = useState<string | null>(null);

  const publishMutation = useMutation({
    mutationFn: () => problemApi.publishKnownErrorKB(id ?? ''),
    onSuccess: () => {
      setPublishError(null);
      queryClient.invalidateQueries({ queryKey: problemKeys.knownErrors.detail(id ?? '') });
    },
    onError: (e) => setPublishError(apiErrorMessage(e, 'Failed to publish to knowledge base')),
  });

  const setTab = (next: Tab) => {
    const nextParams = new URLSearchParams(params);
    if (next === 'details') nextParams.delete('tab');
    else nextParams.set('tab', next);
    setParams(nextParams);
  };

  if (isLoading) {
    return (
      <div className="space-y-3" aria-busy="true">
        <div className="h-8 w-72 animate-pulse rounded bg-muted" />
        <div className="h-40 animate-pulse rounded-xl bg-muted" />
      </div>
    );
  }
  if (isError || !ke || !id) {
    return (
      <p role="alert" className="text-sm text-destructive">
        {apiErrorMessage(error, 'Known error not found')}
      </p>
    );
  }

  // Spec Section 5.3: the KB publish button exists for published known errors;
  // employee self-service is the visibility it grants.
  const canPublish = hasAnyPermission(['known_errors:publish']);
  const showPublish = canPublish && ke.status === 'PUBLISHED' && !ke.publishedArticleId;

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <Link to="/known-errors" className="text-sm text-primary hover:underline">
            ← Known Errors
          </Link>
          <h1 className="mt-1 text-2xl font-semibold">{ke.title}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className="font-mono text-xs text-muted-foreground">{ke.number}</span>
            <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${getKnownErrorStatusBadgeClass(ke.status)}`}>
              {KNOWN_ERROR_STATUS_LABELS[ke.status]}
            </span>
            <span className="rounded-full border border-border px-2 py-0.5 text-xs text-muted-foreground">
              {KNOWN_ERROR_VISIBILITY_LABELS[ke.visibility]}
            </span>
            <span className="text-xs text-muted-foreground">Owner: {ke.owner.name}</span>
          </div>
        </div>
        {showPublish && (
          <div>
            <button
              type="button"
              onClick={() => publishMutation.mutate()}
              disabled={publishMutation.isPending}
              className={buttonPrimary}
            >
              {publishMutation.isPending ? 'Publishing…' : 'Publish to KB'}
            </button>
            {publishError && (
              <p role="alert" className="mt-2 text-sm text-destructive">
                {publishError}
              </p>
            )}
          </div>
        )}
      </div>

      <div role="tablist" aria-label="Known error tabs" className="mt-4 flex gap-1 border-b border-border">
        {TABS.map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={`cursor-pointer rounded-t-md px-4 py-2 text-sm capitalize transition-colors ${
              tab === t
                ? 'border-b-2 border-primary font-medium text-foreground'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      <div className="mt-4">
        {tab === 'details' && <DetailsView keId={id} />}
        {tab === 'approval' && <ApprovalView keId={id} />}
        {tab === 'linked' && <LinkedView keId={id} />}
      </div>
    </div>
  );
}
