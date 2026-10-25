import { useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import { apiErrorMessage } from '@/lib/api';
import {
  problemApi,
  problemKeys,
  useProblem,
  useProblems,
  type KnownErrorVisibility,
} from '@/lib/problemApi';

import { cardBase, inputBase, labelBase, sectionTitle } from '@/components/problems/styles';

/** Split a comma-separated input into a clean array for the affected-* fields. */
function parseList(value: string): string[] {
  return value
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
}

export default function KnownErrorCreatePage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [params] = useSearchParams();
  const problemIdParam = params.get('problemId');

  const problemQuery = useProblem(problemIdParam ?? '', { enabled: Boolean(problemIdParam), retry: false });
  const problem = problemQuery.data;

  const [pickedProblemId, setPickedProblemId] = useState('');
  const [title, setTitle] = useState('');
  const [rootCause, setRootCause] = useState('');
  const [symptoms, setSymptoms] = useState('');
  const [workaround, setWorkaround] = useState('');
  const [resolutionNotes, setResolutionNotes] = useState('');
  const [affectedServices, setAffectedServices] = useState('');
  const [affectedAssets, setAffectedAssets] = useState('');
  const [affectedCIs, setAffectedCIs] = useState('');
  const [visibility, setVisibility] = useState<KnownErrorVisibility>('IT_ONLY');
  const [error, setError] = useState<string | null>(null);

  // Without ?problemId= the author picks a problem; list their candidates.
  const problemsQuery = useProblems(
    { limit: 100, sort: 'updatedAt', order: 'desc' },
    { enabled: !problemIdParam }
  );

  const effectiveProblemId = problemIdParam ?? pickedProblemId;

  const createMutation = useMutation({
    mutationFn: () =>
      problemApi.createKnownError({
        problemId: effectiveProblemId,
        title,
        rootCause,
        symptoms,
        workaround,
        ...(resolutionNotes.trim() ? { resolutionNotes } : {}),
        affectedServices: parseList(affectedServices),
        affectedAssets: parseList(affectedAssets),
        affectedCIs: parseList(affectedCIs),
        visibility,
      }),
    onSuccess: (created) => {
      queryClient.invalidateQueries({ queryKey: problemKeys.knownErrors.all });
      navigate(`/known-errors/${created.id}`);
    },
    onError: (e) => setError(apiErrorMessage(e, 'Failed to create known error')),
  });

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    createMutation.mutate();
  };

  return (
    <div className="mx-auto max-w-3xl">
      <Link to="/known-errors" className="text-sm text-primary hover:underline">
        ← Known Errors
      </Link>
      <h1 className="mt-1 text-2xl font-semibold">New known error</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        A known error records an understood root cause and its workaround so the
        service desk can resolve matching incidents without waiting for the fix.
      </p>

      <form onSubmit={handleSubmit} className={`${cardBase} mt-4 space-y-4 p-5`}>
        {/* Source problem */}
        <div>
          <h2 className={sectionTitle}>Problem</h2>
          {problemIdParam ? (
            <p className="mt-2 text-sm">
              {problemQuery.isLoading && 'Loading problem…'}
              {problemQuery.isError && (
                <span role="alert" className="text-destructive">
                  {apiErrorMessage(problemQuery.error, 'Problem not found')}
                </span>
              )}
              {problem && (
                <span>
                  <span className="font-mono text-xs text-muted-foreground">{problem.number}</span>{' '}
                  {problem.title}
                </span>
              )}
            </p>
          ) : (
            <div className="mt-2">
              <label htmlFor="ke-problem" className={labelBase}>
                Source problem
              </label>
              <select
                id="ke-problem"
                value={pickedProblemId}
                onChange={(e) => setPickedProblemId(e.target.value)}
                required
                className={`${inputBase} mt-1`}
              >
                <option value="">Select a problem…</option>
                {problemsQuery.data?.data.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.number} — {p.title}
                  </option>
                ))}
              </select>
              {problemsQuery.isError && (
                <p role="alert" className="mt-1 text-sm text-destructive">
                  {apiErrorMessage(problemsQuery.error, 'Failed to load problems')}
                </p>
              )}
            </div>
          )}
        </div>

        <div className="border-t border-border pt-4">
          <label htmlFor="ke-title" className={labelBase}>
            Title
          </label>
          <input
            id="ke-title"
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
            placeholder="e.g. VPN drops every 30 minutes for branch users"
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
            placeholder="What is actually broken, and how was it established?"
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
            placeholder="What the reporter experiences — how to recognize this known error"
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
            placeholder="Steps that restore service without fixing the root cause"
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
            placeholder="Filled in once a permanent fix exists"
            className={`${inputBase} mt-1`}
          />
        </div>

        <div className="border-t border-border pt-4">
          <h2 className={sectionTitle}>Affected configuration</h2>
          <p className="mt-1 text-xs text-muted-foreground">Comma-separated lists.</p>
          <div className="mt-2 grid gap-3 sm:grid-cols-3">
            <div>
              <label htmlFor="ke-services" className={labelBase}>
                Services
              </label>
              <input
                id="ke-services"
                type="text"
                value={affectedServices}
                onChange={(e) => setAffectedServices(e.target.value)}
                placeholder="VPN, Email"
                className={`${inputBase} mt-1`}
              />
            </div>
            <div>
              <label htmlFor="ke-assets" className={labelBase}>
                Assets
              </label>
              <input
                id="ke-assets"
                type="text"
                value={affectedAssets}
                onChange={(e) => setAffectedAssets(e.target.value)}
                placeholder="LAP-0042"
                className={`${inputBase} mt-1`}
              />
            </div>
            <div>
              <label htmlFor="ke-cis" className={labelBase}>
                CIs
              </label>
              <input
                id="ke-cis"
                type="text"
                value={affectedCIs}
                onChange={(e) => setAffectedCIs(e.target.value)}
                placeholder="ci-vpn-gw-01"
                className={`${inputBase} mt-1`}
              />
            </div>
          </div>
        </div>

        <div>
          <label htmlFor="ke-visibility" className={labelBase}>
            Visibility
          </label>
          <select
            id="ke-visibility"
            value={visibility}
            onChange={(e) => setVisibility(e.target.value as KnownErrorVisibility)}
            className={`${inputBase} mt-1`}
          >
            <option value="IT_ONLY">IT only</option>
            <option value="EMPLOYEE_SELF_SERVICE">Employee self-service</option>
          </select>
          {visibility === 'EMPLOYEE_SELF_SERVICE' && (
            <p className="mt-1 text-xs text-muted-foreground">
              Employee visibility takes effect once the known error is published.
            </p>
          )}
        </div>

        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}

        <div className="flex gap-2">
          <button
            type="submit"
            disabled={!effectiveProblemId || createMutation.isPending}
            className="cursor-pointer rounded-md bg-primary px-4 py-2 text-sm font-medium text-on-primary transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {createMutation.isPending ? 'Creating…' : 'Create known error'}
          </button>
          <Link
            to="/known-errors"
            className="cursor-pointer rounded-md border border-border bg-background px-4 py-2 text-sm transition-colors hover:border-ring hover:bg-muted"
          >
            Cancel
          </Link>
        </div>
      </form>
    </div>
  );
}
