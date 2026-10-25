import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import { apiErrorMessage } from '@/lib/api';
import {
  MATCH_REASON_LABELS,
  problemApi,
  problemKeys,
  useDetectionSuggestions,
  type DetectionSuggestion,
} from '@/lib/problemApi';
import { buttonGhost, buttonPrimary, cardBase, sectionTitle } from './styles';

/**
 * The detection engine's review queue, tenant-wide: clusters of incidents the
 * scheduled scan flagged as resembling an existing problem or looking like a
 * new one. A person accepts (raising or linking a problem) or rejects;
 * accepting reuses POST /problems/from-incidents, which marks the suggestion
 * ACCEPTED server-side.
 */
export default function DetectionSuggestionsPanel() {
  const suggestionsQuery = useDetectionSuggestions({ refetchInterval: 60_000 });
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: problemKeys.suggestions() });
    queryClient.invalidateQueries({ queryKey: problemKeys.lists() });
    // The link path lands on an existing problem whose detail may be cached.
    queryClient.invalidateQueries({ queryKey: problemKeys.details() });
  };

  const acceptMutation = useMutation({
    mutationFn: async (suggestion: DetectionSuggestion) => {
      if (suggestion.problemId) {
        // The cluster resembles an existing problem: link the incidents to it.
        await problemApi.linkIncidents(suggestion.problemId, suggestion.incidents.map((i) => i.id));
        return { problemId: suggestion.problemId, number: suggestion.problem?.number ?? '' };
      }
      const problem = await problemApi.createFromIncidents(suggestion.incidents.map((i) => i.id));
      return { problemId: problem.id, number: problem.number };
    },
    onMutate: (suggestion) => setBusyId(suggestion.id),
    // Land on the problem the reviewer just answered, so the act is confirmed
    // by its result rather than by the row vanishing from the queue.
    onSuccess: ({ problemId }) => {
      invalidate();
      navigate(`/problems/${problemId}`);
    },
    onError: (e, suggestion) =>
      setRowErrors((prev) => ({ ...prev, [suggestion.id]: apiErrorMessage(e, 'Failed to accept suggestion') })),
    onSettled: () => setBusyId(null),
  });

  const rejectMutation = useMutation({
    mutationFn: (id: string) => problemApi.rejectSuggestion(id),
    onMutate: (id) => setBusyId(id),
    onSuccess: invalidate,
    onError: (e, id) => setRowErrors((prev) => ({ ...prev, [id]: apiErrorMessage(e, 'Failed to reject suggestion') })),
    onSettled: () => setBusyId(null),
  });

  if (suggestionsQuery.isLoading) {
    return (
      <div className={`${cardBase} p-5`} aria-busy="true">
        <h2 className={sectionTitle}>Detection suggestions</h2>
        <div className="mt-3 h-12 animate-pulse rounded-md bg-muted" />
      </div>
    );
  }

  if (suggestionsQuery.isError) {
    return (
      <div className={`${cardBase} p-5`}>
        <h2 className={sectionTitle}>Detection suggestions</h2>
        <p role="alert" className="mt-3 text-sm text-destructive">
          {apiErrorMessage(suggestionsQuery.error, 'Failed to load suggestions')}
        </p>
      </div>
    );
  }

  const suggestions = suggestionsQuery.data ?? [];

  return (
    <div className={`${cardBase} p-5`}>
      <div className="flex items-center justify-between gap-2">
        <h2 className={sectionTitle}>Detection suggestions</h2>
        <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground" aria-label="Pending suggestions">
          {suggestions.length}
        </span>
      </div>

      {suggestions.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">
          No pending suggestions. The engine scans open incidents for recurring patterns.
        </p>
      ) : (
        <ul className="mt-4 space-y-4">
          {suggestions.map((suggestion) => (
            <li key={suggestion.id} className="rounded-lg border border-border p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-md bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary">
                  {Math.round(suggestion.score)}% match
                </span>
                {suggestion.problem ? (
                  <span className="text-sm">
                    Resembles{' '}
                    <Link to={`/problems/${suggestion.problem.id}`} className="font-mono text-xs text-primary hover:underline">
                      {suggestion.problem.number}
                    </Link>{' '}
                    <span className="text-muted-foreground">— {suggestion.problem.title}</span>
                  </span>
                ) : (
                  <span className="text-sm">Looks like a new problem</span>
                )}
              </div>

              <ul className="mt-2 space-y-1">
                {suggestion.incidents.map((incident) => (
                  <li key={incident.id} className="flex items-baseline gap-2 text-sm">
                    <span className="font-mono text-xs text-muted-foreground">{incident.number}</span>
                    <span className="truncate">{incident.title}</span>
                  </li>
                ))}
              </ul>

              {suggestion.matchReasons.length > 0 && (
                <p className="mt-2 text-xs text-muted-foreground">
                  {suggestion.matchReasons.map((reason) => MATCH_REASON_LABELS[reason] ?? reason).join(' · ')}
                </p>
              )}

              {rowErrors[suggestion.id] && (
                <p role="alert" className="mt-2 text-sm text-destructive">
                  {rowErrors[suggestion.id]}
                </p>
              )}

              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  disabled={busyId === suggestion.id}
                  onClick={() => {
                    setRowErrors((prev) => ({ ...prev, [suggestion.id]: '' }));
                    acceptMutation.mutate(suggestion);
                  }}
                  className={buttonPrimary}
                >
                  {busyId === suggestion.id ? 'Working…' : suggestion.problem ? 'Link incidents' : 'Create problem'}
                </button>
                <button
                  type="button"
                  disabled={busyId === suggestion.id}
                  onClick={() => {
                    setRowErrors((prev) => ({ ...prev, [suggestion.id]: '' }));
                    rejectMutation.mutate(suggestion.id);
                  }}
                  className={buttonGhost}
                >
                  Reject
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
