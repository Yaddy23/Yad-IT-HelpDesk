import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';

import { PriorityBadge, StatusBadge } from '@/components/TicketBadges';
import { SearchIcon } from '@/components/icons';
import { apiErrorMessage } from '@/lib/api';
import { searchApi } from '@/lib/searchApi';

const MIN_QUERY_LENGTH = 2;
const DEBOUNCE_MS = 250;

/** Top-bar global search: debounced, scope-aware, keyboard friendly. */
export default function GlobalSearch() {
  const [term, setTerm] = useState('');
  const [debounced, setDebounced] = useState('');
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  useEffect(() => {
    const t = setTimeout(() => setDebounced(term.trim()), DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [term]);

  // Close when clicking anywhere outside the search box.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const enabled = debounced.length >= MIN_QUERY_LENGTH;
  const resultsQuery = useQuery({
    queryKey: ['search', debounced],
    queryFn: () => searchApi.search(debounced),
    enabled,
    staleTime: 15_000,
  });

  const hasResults = useMemo(
    () => (resultsQuery.data?.tickets.length ?? 0) + (resultsQuery.data?.people.length ?? 0) > 0,
    [resultsQuery.data],
  );

  const openTicket = (id: string) => {
    setOpen(false);
    setTerm('');
    navigate(`/tickets/${id}`);
  };

  const showPanel = open && enabled;

  return (
    <div ref={containerRef} className="relative flex min-w-0 flex-1 items-center sm:max-w-md">
      <span className="absolute left-2.5 text-muted-foreground">
        <SearchIcon size={16} />
      </span>
      <input
        type="search"
        value={term}
        onChange={(e) => {
          setTerm(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') setOpen(false);
        }}
        role="combobox"
        aria-expanded={showPanel}
        aria-controls="global-search-results"
        aria-label="Global search"
        placeholder="Search tickets…"
        className="w-full rounded-md border border-border bg-card py-1.5 pl-8 pr-3 text-sm text-foreground placeholder:text-muted-foreground transition-colors hover:border-ring/40 focus:border-ring"
      />

      {showPanel && (
        <div
          id="global-search-results"
          role="listbox"
          aria-label="Search results"
          className="absolute left-0 right-0 top-full z-50 mt-2 max-h-96 overflow-y-auto rounded-xl border border-border bg-card py-2 shadow-lg"
        >
          {resultsQuery.isLoading && <p className="px-4 py-2 text-sm text-muted-foreground">Searching…</p>}

          {resultsQuery.isError && (
            <p role="alert" className="px-4 py-2 text-sm text-destructive">
              {apiErrorMessage(resultsQuery.error, 'Search failed')}
            </p>
          )}

          {resultsQuery.isSuccess && !hasResults && (
            <p className="px-4 py-2 text-sm text-muted-foreground">No matches for “{debounced}”.</p>
          )}

          {resultsQuery.data && resultsQuery.data.tickets.length > 0 && (
            <div>
              <p className="px-4 pb-1 pt-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Tickets</p>
              {resultsQuery.data.tickets.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  role="option"
                  aria-selected={false}
                  onClick={() => openTicket(t.id)}
                  className="flex w-full cursor-pointer items-center gap-3 px-4 py-2 text-left transition-colors hover:bg-muted"
                >
                  <span className="shrink-0 font-mono text-xs text-muted-foreground">{t.number}</span>
                  <span className="min-w-0 flex-1 truncate text-sm">{t.title}</span>
                  <StatusBadge status={t.status as Parameters<typeof StatusBadge>[0]['status']} />
                  <PriorityBadge priority={t.priority as Parameters<typeof PriorityBadge>[0]['priority']} />
                </button>
              ))}
            </div>
          )}

          {resultsQuery.data && resultsQuery.data.people.length > 0 && (
            <div className="mt-1 border-t border-border pt-1">
              <p className="px-4 pb-1 pt-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">People</p>
              {resultsQuery.data.people.map((p) => (
                <div key={p.id} className="flex items-center gap-3 px-4 py-2">
                  <span className="min-w-0 flex-1 truncate text-sm">{p.name}</span>
                  <span className="truncate text-xs text-muted-foreground">{p.email}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
