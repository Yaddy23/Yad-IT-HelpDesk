import { useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { FormEvent } from 'react';

import { AlertTriangleIcon, BugIcon, BrainIcon, HistoryIcon, LinkIcon, WrenchIcon } from '@/components/icons';
import { apiErrorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import {
  problemApi,
  problemKeys,
  formatProblemNumber,
  formatDateTime,
  getProblemStatusBadgeClass,
  getProblemPriorityBadgeClass,
  PROBLEM_STATUS_TRANSITIONS,
  getTransitionRequirements,
  PROBLEM_STATUS_LABELS,
  type ProblemDetail,
  type ProblemStatus,
} from '@/lib/problemApi';
import { useProblem } from '@/lib/problemApi';

import ProblemDetailsTab from '@/components/problems/ProblemDetailsTab';
import ProblemIncidentsTab from '@/components/problems/ProblemIncidentsTab';
import ProblemRCATab from '@/components/problems/ProblemRCATab';
import ProblemWorkaroundsTab from '@/components/problems/ProblemWorkaroundsTab';
import ProblemHistoryTab from '@/components/problems/ProblemHistoryTab';
import { badgeBase, buttonPrimary, inputBase, labelBase } from '@/components/problems/styles';

const TABS = [
  { key: 'details', label: 'Details', icon: BugIcon },
  { key: 'incidents', label: 'Incidents', icon: LinkIcon },
  { key: 'rca', label: 'RCA', icon: BrainIcon },
  { key: 'workarounds', label: 'Workarounds', icon: WrenchIcon },
  { key: 'history', label: 'History', icon: HistoryIcon },
] as const;

type TabKey = (typeof TABS)[number]['key'];

function isValidTab(value: string | null): value is TabKey {
  return TABS.some((t) => t.key === value);
}

/**
 * RESOLVED is the one transition that needs more input than a click, so it
 * gets its own dialog: a resolution summary plus either a verified fix or a
 * manager-signed exception reason (the server rejects anything else).
 */
function ResolveDialog({
  problem,
  onClose,
}: {
  problem: ProblemDetail;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [summary, setSummary] = useState('');
  const [verifiedFix, setVerifiedFix] = useState(false);
  const [exceptionReason, setExceptionReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  const resolveMutation = useMutation({
    mutationFn: () =>
      problemApi.transitionStatus(problem.id, 'RESOLVED', {
        resolutionSummary: summary.trim(),
        verifiedFix,
        exceptionReason: exceptionReason.trim() || undefined,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: problemKeys.detail(problem.id) });
      queryClient.invalidateQueries({ queryKey: problemKeys.lists() });
      onClose();
    },
    onError: (e) => setError(apiErrorMessage(e, 'Failed to resolve problem')),
  });

  const canSubmit =
    summary.trim().length >= 5 && (verifiedFix || exceptionReason.trim().length >= 5);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    resolveMutation.mutate();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Resolve problem"
    >
      <div className="w-full max-w-lg rounded-xl border border-border bg-card p-5">
        <h2 className="text-lg font-semibold">Resolve problem</h2>
        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          <div>
            <label htmlFor="resolution-summary" className={labelBase}>
              Resolution summary
            </label>
            <textarea
              id="resolution-summary"
              rows={3}
              maxLength={10000}
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              className={`${inputBase} mt-1`}
              required
              minLength={5}
            />
          </div>
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={verifiedFix}
              onChange={(e) => setVerifiedFix(e.target.checked)}
              className="h-4 w-4 cursor-pointer accent-primary"
            />
            Fix verified
          </label>
          {!verifiedFix && (
            <div>
              <label htmlFor="exception-reason" className={labelBase}>
                Exception reason{' '}
                <span className="font-normal text-muted-foreground">
                  (resolving without a verified fix requires a manager)
                </span>
              </label>
              <input
                id="exception-reason"
                type="text"
                maxLength={1000}
                value={exceptionReason}
                onChange={(e) => setExceptionReason(e.target.value)}
                className={`${inputBase} mt-1`}
              />
            </div>
          )}
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={onClose} className="cursor-pointer rounded-md border border-border bg-card px-3 py-1.5 text-sm transition-colors hover:border-ring/40">
              Cancel
            </button>
            <button type="submit" disabled={!canSubmit || resolveMutation.isPending} className={buttonPrimary}>
              {resolveMutation.isPending ? 'Resolving…' : 'Resolve'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function ProblemDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [params, setParams] = useSearchParams();
  const { hasPermission } = useAuth();
  const queryClient = useQueryClient();

  const tabParam = params.get('tab');
  const activeTab: TabKey = isValidTab(tabParam) ? tabParam : 'details';

  const [showResolveDialog, setShowResolveDialog] = useState(false);
  const [statusError, setStatusError] = useState<string | null>(null);

  const problemQuery = useProblem(id!);

  const transitionMutation = useMutation({
    mutationFn: (status: ProblemStatus) => problemApi.transitionStatus(id!, status),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: problemKeys.detail(id!) });
      queryClient.invalidateQueries({ queryKey: problemKeys.lists() });
      setStatusError(null);
    },
    onError: (e) => setStatusError(apiErrorMessage(e, 'Failed to update status')),
  });

  const setTab = (key: TabKey) => {
    const next = new URLSearchParams(params);
    if (key === 'details') next.delete('tab');
    else next.set('tab', key);
    setParams(next, { replace: true });
  };

  if (problemQuery.isLoading) {
    return (
      <div className="max-w-4xl animate-pulse space-y-4" aria-busy="true">
        <div className="h-8 w-1/3 rounded bg-muted" />
        <div className="h-4 w-1/2 rounded bg-muted" />
        <div className="h-10 w-64 rounded bg-muted" />
        <div className="h-64 rounded-xl bg-muted" />
      </div>
    );
  }

  if (problemQuery.isError) {
    return (
      <div className="rounded-xl border border-border bg-card p-10 text-center">
        <p role="alert" className="text-destructive">
          {apiErrorMessage(problemQuery.error, 'Failed to load problem')}
        </p>
        <Link to="/problems" className="mt-3 inline-block cursor-pointer text-sm text-primary hover:underline">
          Back to problems
        </Link>
      </div>
    );
  }

  const problem = problemQuery.data!;
  const transitions = PROBLEM_STATUS_TRANSITIONS[problem.status] ?? [];
  const missingRequirements = (status: ProblemStatus) => getTransitionRequirements(problem, status);
  const canTransition = hasPermission('problems:transition');
  const canLink = hasPermission('problems:link_incidents');
  const canManageRca = hasPermission('problems:manage_rca');

  return (
    <div className="max-w-4xl">
      {/* Header */}
      <div>
        <Link to="/problems" className="text-sm text-muted-foreground hover:text-foreground hover:underline">
          ← Problems
        </Link>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="font-mono text-xl font-semibold">{formatProblemNumber(problem.number)}</h1>
          <span className={`${badgeBase} ${getProblemPriorityBadgeClass(problem.priority)}`}>
            {problem.priority}
          </span>
          <span className={`${badgeBase} ${getProblemStatusBadgeClass(problem.status)}`}>
            {PROBLEM_STATUS_LABELS[problem.status]}
          </span>
        </div>
        <p className="mt-1 text-lg">{problem.title}</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Owned by {problem.owner.name} · Identified {formatDateTime(problem.identifiedAt)}
        </p>
      </div>

      {/* Status transition */}
      {canTransition && transitions.length > 0 && problem.status !== 'CLOSED' && (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <label htmlFor="status-transition" className="text-sm text-muted-foreground">
            Move to
          </label>
          <select
            id="status-transition"
            value=""
            onChange={(e) => {
              const target = e.target.value as ProblemStatus;
              if (!target) return;
              const missing = missingRequirements(target);
              if (missing.length > 0) {
                setStatusError(
                  `Before moving to ${PROBLEM_STATUS_LABELS[target]} you need ${missing.join(', ')}.`,
                );
                return;
              }
              setStatusError(null);
              if (target === 'RESOLVED') setShowResolveDialog(true);
              else transitionMutation.mutate(target);
            }}
            disabled={transitionMutation.isPending}
            className="cursor-pointer rounded-md border border-border bg-card px-3 py-1.5 text-sm transition-colors hover:border-ring/40 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <option value="">Select status…</option>
            {transitions.map((s) => (
              <option key={s} value={s}>
                {PROBLEM_STATUS_LABELS[s]}
              </option>
            ))}
          </select>
          {transitionMutation.isPending && <span className="text-sm text-muted-foreground">Updating…</span>}
        </div>
      )}

      {statusError && (
        <p role="alert" className="mt-3 flex items-start gap-1.5 text-sm text-destructive">
          <AlertTriangleIcon size={16} className="mt-0.5 shrink-0" />
          {statusError}
        </p>
      )}

      {/* Tabs */}
      <div
        role="tablist"
        aria-label="Problem sections"
        className="mt-6 flex gap-1 overflow-x-auto border-b border-border"
      >
        {TABS.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            type="button"
            role="tab"
            id={`problem-tab-${key}`}
            aria-selected={activeTab === key}
            aria-controls={`problem-panel-${key}`}
            onClick={() => setTab(key)}
            className={`flex cursor-pointer items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2 text-sm transition-colors ${
              activeTab === key
                ? 'border-primary text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            <Icon size={14} />
            {label}
          </button>
        ))}
      </div>

      <div
        role="tabpanel"
        id={`problem-panel-${activeTab}`}
        aria-labelledby={`problem-tab-${activeTab}`}
        className="mt-4"
      >
        {activeTab === 'details' && <ProblemDetailsTab problem={problem} />}
        {activeTab === 'incidents' && <ProblemIncidentsTab problem={problem} canLink={canLink} />}
        {activeTab === 'rca' && <ProblemRCATab problem={problem} canManage={canManageRca} />}
        {activeTab === 'workarounds' && (
          <ProblemWorkaroundsTab problem={problem} canManage={canManageRca} />
        )}
        {activeTab === 'history' && <ProblemHistoryTab problemId={problem.id} />}
      </div>

      {showResolveDialog && (
        <ResolveDialog problem={problem} onClose={() => setShowResolveDialog(false)} />
      )}
    </div>
  );
}
