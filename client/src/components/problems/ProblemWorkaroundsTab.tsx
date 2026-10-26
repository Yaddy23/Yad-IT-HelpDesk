import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { FormEvent } from 'react';

import { apiErrorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import {
  problemApi,
  problemKeys,
  useKnownErrors,
  formatDateTime,
  getKnownErrorStatusBadgeClass,
  type ProblemDetail,
} from '@/lib/problemApi';

import { badgeBase, buttonPrimary, cardBase, inputBase, labelBase, sectionTitle, skeletonRow } from './styles';

interface Props {
  problem: ProblemDetail;
  /** `problems:manage_rca` — gates the workaround editor. */
  canManage: boolean;
}

/**
 * Workaround editor plus every known error raised from this problem. A
 * published known error is the durable home for a workaround; the field here
 * is the problem's own record of the interim fix.
 */
export default function ProblemWorkaroundsTab({ problem, canManage }: Props) {
  const queryClient = useQueryClient();
  const { hasAnyPermission } = useAuth();
  const [workaround, setWorkaround] = useState(problem.workaround ?? '');
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setWorkaround(problem.workaround ?? '');
  }, [problem]);

  const knownErrorsQuery = useKnownErrors({ problemId: problem.id, limit: 50 });

  const saveMutation = useMutation({
    mutationFn: () => problemApi.setWorkaround(problem.id, workaround.trim()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: problemKeys.detail(problem.id) });
      setSaved(true);
      // The confirmation is transient feedback, not state — clear it so the
      // next edit does not show a stale "saved" for untouched content.
      setTimeout(() => setSaved(false), 3000);
    },
    onError: (e) => setError(apiErrorMessage(e, 'Failed to save workaround')),
  });

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setSaved(false);
    saveMutation.mutate();
  };

  return (
    <div className="space-y-4">
      <form onSubmit={handleSubmit} className={`${cardBase} p-5`} aria-busy={saveMutation.isPending}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className={sectionTitle}>Workaround</h2>
          {problem.workaroundDocumentedAt && (
            <span className="text-xs text-muted-foreground">
              Documented {formatDateTime(problem.workaroundDocumentedAt)}
            </span>
          )}
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          The interim fix that restores service while a permanent fix is developed.
        </p>

        {canManage ? (
          <>
            <label htmlFor="workaround" className={`${labelBase} mt-4`}>
              Workaround steps
            </label>
            <textarea
              id="workaround"
              rows={6}
              maxLength={10000}
              value={workaround}
              onChange={(e) => setWorkaround(e.target.value)}
              placeholder="Describe how to restore service without addressing the root cause…"
              className={`${inputBase} mt-1`}
            />
            {error && (
              <p role="alert" className="mt-3 text-sm text-destructive">
                {error}
              </p>
            )}
            <div className="mt-4 flex items-center gap-3">
              <button type="submit" disabled={saveMutation.isPending || !workaround.trim()} className={buttonPrimary}>
                {saveMutation.isPending ? 'Saving…' : 'Save workaround'}
              </button>
              {saved && (
                <span role="status" className="text-sm text-green-700 dark:text-green-400">
                  Workaround saved.
                </span>
              )}
            </div>
          </>
        ) : problem.workaround?.trim() ? (
          <p className="mt-3 whitespace-pre-wrap text-sm">{problem.workaround}</p>
        ) : (
          <p className="mt-3 text-sm text-muted-foreground">No workaround set.</p>
        )}
      </form>

      <section className={`${cardBase} p-5`}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className={sectionTitle}>Known errors from this problem</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Publishing a workaround as a known error makes it searchable for the service desk.
            </p>
          </div>
          {hasAnyPermission(['known_errors:create']) && (
            <Link
              to={`/known-errors/new?problemId=${problem.id}`}
              className="cursor-pointer rounded-md border border-border bg-background px-3 py-1.5 text-sm transition-colors hover:border-ring hover:bg-muted"
            >
              New known error
            </Link>
          )}
        </div>

        {knownErrorsQuery.isLoading ? (
          <div className="mt-4 space-y-2" aria-busy="true">
            <div className={skeletonRow} />
            <div className={skeletonRow} />
          </div>
        ) : knownErrorsQuery.isError ? (
          <p role="alert" className="mt-4 text-sm text-destructive">
            {apiErrorMessage(knownErrorsQuery.error, 'Failed to load known errors')}
          </p>
        ) : knownErrorsQuery.data?.data.length === 0 ? (
          <p className="mt-4 text-sm text-muted-foreground">
            No known errors raised from this problem yet.
          </p>
        ) : (
          <ul className="mt-4 divide-y divide-border/60">
            {knownErrorsQuery.data?.data.map((ke) => (
              <li key={ke.id} className="flex items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <Link to={`/known-errors/${ke.id}`} className="text-sm text-primary hover:underline">
                    <span className="font-mono text-xs">{ke.number}</span> {ke.title}
                  </Link>
                  {ke.publishedArticleId && (
                    <p className="text-xs text-muted-foreground">Published to knowledge base</p>
                  )}
                </div>
                <span className={`${badgeBase} ${getKnownErrorStatusBadgeClass(ke.status)}`}>
                  {ke.status.replace('_', ' ')}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
