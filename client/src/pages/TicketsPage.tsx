import { useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';

import { PriorityBadge, StatusBadge } from '@/components/TicketBadges';
import { SearchIcon } from '@/components/icons';
import { apiErrorMessage } from '@/lib/api';
import { ticketsApi, type Queue } from '@/lib/ticketsApi';

const QUEUES: { value: Queue; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'unassigned', label: 'Unassigned' },
  { value: 'my', label: 'My queue' },
  { value: 'mine', label: 'Requested by me' },
];

export default function TicketsPage() {
  const [params, setParams] = useSearchParams();
  const queue = (params.get('queue') ?? 'all') as Queue;
  const q = params.get('q') ?? '';
  const sla = params.get('sla') === 'at_risk' ? 'at_risk' : undefined;
  const page = Number(params.get('page') ?? '1');

  const [searchDraft, setSearchDraft] = useState(q);

  const ticketsQuery = useQuery({
    queryKey: ['tickets', { queue, q, sla, page }],
    queryFn: () => ticketsApi.list({ queue, q, sla, page, sort: 'newest' }),
  });
  const countsQuery = useQuery({ queryKey: ['ticket-queues'], queryFn: ticketsApi.queues });

  const setParam = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    if (key !== 'page') next.delete('page');
    setParams(next);
  };

  const handleSearch = (e: FormEvent) => {
    e.preventDefault();
    setParam('q', searchDraft.trim());
  };

  const meta = ticketsQuery.data?.meta;

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Tickets</h1>
          <p className="text-sm text-muted-foreground">
            {countsQuery.data
              ? `${countsQuery.data.open} open · ${countsQuery.data.unassigned} unassigned · ${countsQuery.data.assignedToMe} in my queue`
              : 'Loading…'}
          </p>
        </div>
        <Link
          to="/tickets/new"
          className="cursor-pointer rounded-md bg-primary px-4 py-2 text-sm font-medium text-on-primary transition-opacity hover:opacity-90"
        >
          New ticket
        </Link>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {QUEUES.map((q2) => (
          <button
            key={q2.value}
            type="button"
            onClick={() => setParam('queue', q2.value)}
            className={`cursor-pointer rounded-full border px-3 py-1.5 text-sm transition-colors ${
              queue === q2.value
                ? 'border-primary bg-primary text-on-primary'
                : 'border-border bg-card text-muted-foreground hover:border-ring/40 hover:text-foreground'
            }`}
          >
            {q2.label}
          </button>
        ))}
        <button
          type="button"
          onClick={() => setParam('sla', sla ? '' : 'at_risk')}
          aria-pressed={!!sla}
          className={`cursor-pointer rounded-full border px-3 py-1.5 text-sm transition-colors ${
            sla
              ? 'border-destructive bg-destructive text-on-destructive'
              : 'border-border bg-card text-muted-foreground hover:border-ring/40 hover:text-foreground'
          }`}
        >
          SLA at risk
        </button>
        <form onSubmit={handleSearch} className="relative ml-auto w-full max-w-xs">
          <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground">
            <SearchIcon size={16} />
          </span>
          <input
            type="search"
            value={searchDraft}
            onChange={(e) => setSearchDraft(e.target.value)}
            placeholder="Search number or title…"
            aria-label="Search tickets"
            className="w-full rounded-md border border-border bg-card py-1.5 pl-8 pr-3 text-sm transition-colors hover:border-ring/40 focus:border-ring"
          />
        </form>
      </div>

      <div className="mt-4 overflow-hidden rounded-xl border border-border bg-card">
        {ticketsQuery.isLoading ? (
          <div className="space-y-2 p-5">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="h-10 animate-pulse rounded-md bg-muted" />
            ))}
          </div>
        ) : ticketsQuery.isError ? (
          <p role="alert" className="p-5 text-sm text-destructive">
            {apiErrorMessage(ticketsQuery.error, 'Failed to load tickets')}
          </p>
        ) : ticketsQuery.data?.data.length === 0 ? (
          <div className="p-10 text-center">
            <p className="text-sm text-muted-foreground">No tickets in this view yet.</p>
            <Link to="/tickets/new" className="mt-2 inline-block cursor-pointer text-sm text-primary hover:underline">
              Create the first one
            </Link>
          </div>
        ) : (
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-4 py-3 font-medium">Number</th>
                <th className="px-4 py-3 font-medium">Title</th>
                <th className="hidden px-4 py-3 font-medium md:table-cell">Requester</th>
                <th className="px-4 py-3 font-medium">Priority</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="hidden px-4 py-3 font-medium lg:table-cell">Assignee</th>
              </tr>
            </thead>
            <tbody>
              {ticketsQuery.data?.data.map((t) => (
                <tr key={t.id} className="border-b border-border/60 transition-colors last:border-0 hover:bg-muted/50">
                  <td className="whitespace-nowrap px-4 py-3 font-mono text-xs">
                    <Link to={`/tickets/${t.id}`} className="text-primary hover:underline">
                      {t.number}
                    </Link>
                  </td>
                  <td className="max-w-xs px-4 py-3">
                    <Link to={`/tickets/${t.id}`} className="block truncate hover:underline">
                      {t.title}
                    </Link>
                  </td>
                  <td className="hidden max-w-[10rem] truncate px-4 py-3 text-muted-foreground md:table-cell">
                    {t.requester.name}
                  </td>
                  <td className="px-4 py-3">
                    <PriorityBadge priority={t.priority} />
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={t.status} />
                  </td>
                  <td className="hidden max-w-[10rem] truncate px-4 py-3 text-muted-foreground lg:table-cell">
                    {t.assignee?.name ?? '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {meta && meta.pages > 1 && (
        <div className="mt-4 flex items-center justify-between text-sm text-muted-foreground">
          <span>
            Page {meta.page} of {meta.pages} · {meta.total} tickets
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={meta.page <= 1}
              onClick={() => setParam('page', String(meta.page - 1))}
              className="cursor-pointer rounded-md border border-border bg-card px-3 py-1.5 transition-colors hover:border-ring/40 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Previous
            </button>
            <button
              type="button"
              disabled={meta.page >= meta.pages}
              onClick={() => setParam('page', String(meta.page + 1))}
              className="cursor-pointer rounded-md border border-border bg-card px-3 py-1.5 transition-colors hover:border-ring/40 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
