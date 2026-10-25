import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { CloseIcon, LinkIcon, SearchIcon } from '@/components/icons';
import { apiErrorMessage } from '@/lib/api';
import {
  problemKeys,
  problemApi,
  formatDateTime,
  type ProblemDetail,
  type ProblemIncident,
} from '@/lib/problemApi';
import { ticketsApi, type Ticket } from '@/lib/ticketsApi';

import { buttonGhost, buttonPrimary, cardBase, inputBase, sectionTitle } from './styles';

interface Props {
  problem: ProblemDetail;
  /** `problems:link_incidents` — gates the link/unlink controls. */
  canLink: boolean;
}

/**
 * Incident picker: searches tickets server-side and lets the user tick
 * several before linking in one call. Already-linked tickets are disabled so
 * the server's duplicate-link guard never has to fire.
 */
function LinkIncidentsDialog({
  problem,
  onClose,
}: {
  problem: ProblemDetail;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Map<string, Ticket>>(new Map());
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  const linkedIds = new Set(problem.incidents.map((i) => i.incidentId));

  const resultsQuery = useQuery({
    queryKey: ['tickets-search', search],
    queryFn: () => ticketsApi.list({ q: search || undefined, limit: 10 }),
    placeholderData: (prev) => prev,
  });

  const linkMutation = useMutation({
    mutationFn: () => problemApi.linkIncidents(problem.id, [...selected.keys()], note || undefined),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: problemKeys.detail(problem.id) });
      onClose();
    },
    onError: (e) => setError(apiErrorMessage(e, 'Failed to link incidents')),
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
      aria-label="Link incidents"
    >
      <div className="max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-xl border border-border bg-card p-5">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Link incidents</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close dialog"
            className="cursor-pointer rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <CloseIcon size={18} />
          </button>
        </div>

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
            placeholder="Search tickets by number or title…"
            aria-label="Search tickets"
            className={`${inputBase} pl-8`}
          />
        </form>

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
              const alreadyLinked = linkedIds.has(ticket.id);
              return (
                <label
                  key={ticket.id}
                  className={`flex cursor-pointer items-center gap-3 p-3 transition-colors hover:bg-muted/50 ${
                    alreadyLinked ? 'cursor-not-allowed opacity-50' : ''
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={selected.has(ticket.id)}
                    disabled={alreadyLinked}
                    onChange={() => toggle(ticket)}
                    className="h-4 w-4 cursor-pointer accent-primary"
                    aria-label={`Select ${ticket.number}`}
                  />
                  <span className="font-mono text-xs text-primary">{ticket.number}</span>
                  <span className="min-w-0 flex-1 truncate text-sm">{ticket.title}</span>
                  <span className="text-xs text-muted-foreground">{ticket.status}</span>
                  {alreadyLinked && <span className="text-xs text-muted-foreground">linked</span>}
                </label>
              );
            })
          )}
        </div>

        <div className="mt-3">
          <label htmlFor="incident-link-note" className="block text-sm font-medium">
            Note <span className="font-normal text-muted-foreground">(optional)</span>
          </label>
          <input
            id="incident-link-note"
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={500}
            className={`${inputBase} mt-1`}
          />
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
            onClick={() => linkMutation.mutate()}
            disabled={selected.size === 0 || linkMutation.isPending}
            className={buttonPrimary}
          >
            {linkMutation.isPending ? 'Linking…' : `Link ${selected.size || ''} incident${selected.size === 1 ? '' : 's'}`}
          </button>
        </div>
      </div>
    </div>
  );
}

function IncidentRow({
  link,
  canLink,
  onUnlink,
  unlinkPending,
}: {
  link: ProblemIncident;
  canLink: boolean;
  onUnlink: () => void;
  unlinkPending: boolean;
}) {
  return (
    <tr className="border-b border-border/60 last:border-0 hover:bg-muted/50">
      <td className="whitespace-nowrap px-4 py-3 font-mono text-xs">
        <Link to={`/tickets/${link.incidentId}`} className="text-primary hover:underline">
          {link.incident.number}
        </Link>
      </td>
      <td className="max-w-xs px-4 py-3">
        <Link to={`/tickets/${link.incidentId}`} className="block truncate hover:underline">
          {link.incident.title}
        </Link>
      </td>
      <td className="hidden px-4 py-3 text-muted-foreground md:table-cell">{link.incident.status}</td>
      <td className="hidden px-4 py-3 text-muted-foreground md:table-cell">{link.incident.category}</td>
      <td className="hidden whitespace-nowrap px-4 py-3 text-muted-foreground lg:table-cell">
        {link.linkedBy.name} · {formatDateTime(link.linkedAt)}
      </td>
      <td className="px-4 py-3 text-right">
        {canLink && (
          <button
            type="button"
            onClick={onUnlink}
            disabled={unlinkPending}
            className="cursor-pointer rounded-md border border-destructive/40 px-2.5 py-1 text-xs text-destructive transition-colors hover:bg-destructive/10 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {unlinkPending ? 'Unlinking…' : 'Unlink'}
          </button>
        )}
      </td>
    </tr>
  );
}

export default function ProblemIncidentsTab({ problem, canLink }: Props) {
  const queryClient = useQueryClient();
  const [showLinkDialog, setShowLinkDialog] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const unlinkMutation = useMutation({
    mutationFn: (incidentId: string) => problemApi.unlinkIncident(problem.id, incidentId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: problemKeys.detail(problem.id) }),
    onError: (e) => setError(apiErrorMessage(e, 'Failed to unlink incident')),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className={sectionTitle}>
          Linked incidents ({problem.incidents.length})
        </h2>
        {canLink && (
          <button type="button" onClick={() => setShowLinkDialog(true)} className={buttonGhost}>
            <span className="inline-flex items-center gap-1.5">
              <LinkIcon size={14} />
              Link incidents
            </span>
          </button>
        )}
      </div>

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      <div className={`${cardBase} overflow-hidden`}>
        {problem.incidents.length === 0 ? (
          <div className="p-10 text-center">
            <p className="text-sm text-muted-foreground">No incidents linked.</p>
            {canLink && (
              <p className="mt-1 text-sm text-muted-foreground">
                Link recurring incidents so the problem tracks everything it explains.
              </p>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-4 py-3 font-medium">Number</th>
                  <th className="px-4 py-3 font-medium">Title</th>
                  <th className="hidden px-4 py-3 font-medium md:table-cell">Status</th>
                  <th className="hidden px-4 py-3 font-medium md:table-cell">Category</th>
                  <th className="hidden px-4 py-3 font-medium lg:table-cell">Linked</th>
                  <th className="px-4 py-3">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {problem.incidents.map((link) => (
                  <IncidentRow
                    key={link.id}
                    link={link}
                    canLink={canLink}
                    onUnlink={() => unlinkMutation.mutate(link.incidentId)}
                    unlinkPending={unlinkMutation.isPending && unlinkMutation.variables === link.incidentId}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showLinkDialog && (
        <LinkIncidentsDialog problem={problem} onClose={() => setShowLinkDialog(false)} />
      )}
    </div>
  );
}
