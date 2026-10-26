import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { CloseIcon, SearchIcon } from '@/components/icons';
import { apiErrorMessage } from '@/lib/api';
import { problemApi, problemKeys } from '@/lib/problemApi';
import { ticketsApi, type Ticket } from '@/lib/ticketsApi';

import { buttonGhost, buttonPrimary, inputBase } from './styles';

/**
 * Manual incident grouping on an incident's detail page: search other tickets
 * by symptom text (the tickets API supports free-text `q`, plus status and
 * priority), tick the ones that belong together, and raise one problem over
 * the whole selection — the current incident plus every ticked ticket.
 */
export default function FindRelatedModal({
  incidentId,
  incidentNumber,
  onClose,
}: {
  incidentId: string;
  incidentNumber: string;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [selected, setSelected] = useState<Map<string, Ticket>>(new Map());
  const [error, setError] = useState<string | null>(null);

  const resultsQuery = useQuery({
    queryKey: ['tickets-search', search, status],
    queryFn: () =>
      ticketsApi.list({
        q: search || undefined,
        status: status || undefined,
        limit: 10,
      }),
    placeholderData: (prev) => prev,
  });

  const createMutation = useMutation({
    mutationFn: () => problemApi.createFromIncidents([incidentId, ...selected.keys()]),
    onSuccess: (problem) => {
      queryClient.invalidateQueries({ queryKey: problemKeys.lists() });
      queryClient.invalidateQueries({ queryKey: problemKeys.suggestions() });
      onClose();
      navigate(`/problems/${problem.id}`);
    },
    onError: (e) => setError(apiErrorMessage(e, 'Failed to create problem')),
  });

  const toggle = (ticket: Ticket) => {
    setSelected((prev) => {
      const next = new Map(prev);
      if (next.has(ticket.id)) next.delete(ticket.id);
      else next.set(ticket.id, ticket);
      return next;
    });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Find related incidents"
    >
      <div className="max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-xl border border-border bg-card p-5">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Find related incidents</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close dialog"
            className="cursor-pointer rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <CloseIcon size={18} />
          </button>
        </div>

        <p className="mt-1 text-sm text-muted-foreground">
          Create a problem from {incidentNumber} together with any other tickets that share the same underlying cause.
        </p>

        <form
          className="relative mt-4"
          onSubmit={(e) => {
            e.preventDefault();
            // The query key already carries the term; submit simply commits it.
            setSearch(search.trim());
          }}
        >
          <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground">
            <SearchIcon size={16} />
          </span>
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search tickets by number, title or symptom…"
            aria-label="Search tickets"
            className={`${inputBase} pl-8`}
          />
        </form>

        <div className="mt-2 flex gap-2">
          <label className="text-sm">
            <span className="sr-only">Status filter</span>
            <select value={status} onChange={(e) => setStatus(e.target.value)} className={inputBase} aria-label="Filter by status">
              <option value="">Any status</option>
              <option value="new">New</option>
              <option value="in_progress">In progress</option>
              <option value="pending_employee">Pending employee</option>
              <option value="resolved">Resolved</option>
            </select>
          </label>
        </div>

        <div className="mt-3 divide-y divide-border/60 rounded-lg border border-border">
          {resultsQuery.isLoading ? (
            <p className="p-3 text-sm text-muted-foreground">Searching…</p>
          ) : resultsQuery.isError ? (
            <p role="alert" className="p-3 text-sm text-destructive">
              {apiErrorMessage(resultsQuery.error, 'Failed to search tickets')}
            </p>
          ) : resultsQuery.data?.data.length === 0 ? (
            <p className="p-3 text-sm text-muted-foreground">No tickets match “{search}”.</p>
          ) : (
            resultsQuery.data?.data.map((ticket) => {
              const isSelf = ticket.id === incidentId;
              return (
                <label
                  key={ticket.id}
                  className={`flex items-center gap-3 p-3 transition-colors ${
                    isSelf ? 'bg-muted/50' : 'cursor-pointer hover:bg-muted/50'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={isSelf || selected.has(ticket.id)}
                    disabled={isSelf}
                    onChange={() => toggle(ticket)}
                    className="h-4 w-4 cursor-pointer accent-primary disabled:cursor-not-allowed"
                    aria-label={isSelf ? `${ticket.number} (this incident, included)` : `Select ${ticket.number}`}
                  />
                  <span className="font-mono text-xs text-primary">{ticket.number}</span>
                  <span className="min-w-0 flex-1 truncate text-sm">{ticket.title}</span>
                  <span className="text-xs text-muted-foreground">{ticket.status}</span>
                  {isSelf && <span className="text-xs text-muted-foreground">this incident</span>}
                </label>
              );
            })
          )}
        </div>

        {error && (
          <p role="alert" className="mt-3 text-sm text-destructive">
            {error}
          </p>
        )}

        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onClose} className={buttonGhost}>
            Cancel
          </button>
          <button
            type="button"
            onClick={() => createMutation.mutate()}
            disabled={createMutation.isPending}
            className={buttonPrimary}
          >
            {createMutation.isPending
              ? 'Creating…'
              : `Create problem (${1 + selected.size} incident${selected.size === 0 ? '' : 's'})`}
          </button>
        </div>
      </div>
    </div>
  );
}
