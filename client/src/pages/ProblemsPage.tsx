import { useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';

import { SearchIcon } from '@/components/icons';
import { apiErrorMessage } from '@/lib/api';
import DetectionSuggestionsPanel from '@/components/problems/DetectionSuggestionsPanel';
import {
  useProblems,
  type ProblemStatus,
  type ProblemPriority,
  type ListProblemsQuery,
  getProblemStatusBadgeClass,
  formatProblemNumber,
} from '@/lib/problemApi';

const STATUSES: { value: ProblemStatus | ''; label: string }[] = [
  { value: '', label: 'All' },
  { value: 'IDENTIFIED', label: 'Identified' },
  { value: 'INVESTIGATION', label: 'Investigation' },
  { value: 'ROOT_CAUSE_KNOWN', label: 'Root Cause Known' },
  { value: 'WORKAROUND_DOCUMENTED', label: 'Workaround Documented' },
  { value: 'PENDING_CHANGE', label: 'Pending Change' },
  { value: 'RESOLVED', label: 'Resolved' },
  { value: 'CLOSED', label: 'Closed' },
];

/**
 * Statuses render as their human labels. The enum carries more than one
 * underscore (`ROOT_CAUSE_KNOWN`, `WORKAROUND_DOCUMENTED`), so the obvious
 * `status.replace('_', ' ')` would print "ROOT CAUSE_KNOWN".
 */
const STATUS_LABELS: Record<string, string> = Object.fromEntries(
  STATUSES.map((s) => [s.value, s.label]),
);

const PRIORITIES: { value: ProblemPriority | ''; label: string }[] = [
  { value: '', label: 'All' },
  { value: 'LOW', label: 'Low' },
  { value: 'MEDIUM', label: 'Medium' },
  { value: 'HIGH', label: 'High' },
  { value: 'CRITICAL', label: 'Critical' },
];

/** Non-optional: every sortable field is a concrete value, and `setParam` takes a string. */
const SORTS: { value: NonNullable<ListProblemsQuery['sort']>; label: string }[] = [
  { value: 'identifiedAt', label: 'Identified' },
  { value: 'updatedAt', label: 'Updated' },
  { value: 'priority', label: 'Priority' },
  { value: 'status', label: 'Status' },
];

export default function ProblemsPage() {
  const [params, setParams] = useSearchParams();
  const status = params.get('status') ?? '';
  const priority = params.get('priority') ?? '';
  const search = params.get('search') ?? '';
  const sort = (params.get('sort') as ListProblemsQuery['sort']) ?? 'identifiedAt';
  const order = (params.get('order') as 'asc' | 'desc') ?? 'desc';
  const page = Number(params.get('page') ?? '1');

  const [searchDraft, setSearchDraft] = useState(search);
  const [statusDraft, setStatusDraft] = useState(status);
  const [priorityDraft, setPriorityDraft] = useState(priority);

  const problemsQuery = useProblems({
    status: statusDraft || undefined,
    priority: priorityDraft || undefined,
    search: searchDraft.trim() || undefined,
    sort,
    order,
    page,
  });

  const setParam = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    if (key !== 'page') next.delete('page');
    setParams(next);
  };

  const handleSearch = (e: FormEvent) => {
    e.preventDefault();
    setParam('search', searchDraft.trim());
    setSearchDraft(searchDraft.trim());
  };

  const handleStatusChange = (value: string) => {
    setStatusDraft(value);
    setParam('status', value);
  };

  const handlePriorityChange = (value: string) => {
    setPriorityDraft(value);
    setParam('priority', value);
  };

  const handleSortChange = (value: NonNullable<ListProblemsQuery['sort']>) => {
    if (value === sort) {
      setParam('order', order === 'asc' ? 'desc' : 'asc');
    } else {
      setParam('sort', value);
      setParam('order', 'desc');
    }
  };

  const meta = problemsQuery.data?.meta;

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Problems</h1>
          <p className="text-sm text-muted-foreground">
            {problemsQuery.data
              ? `${problemsQuery.data.meta.total} problems`
              : 'Loading…'}
          </p>
        </div>
        <Link
          to="/problems/new"
          className="cursor-pointer rounded-md bg-primary px-4 py-2 text-sm font-medium text-on-primary transition-opacity hover:opacity-90"
        >
          New problem
        </Link>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0 space-y-4">
          <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-1">
          {STATUSES.map((s) => (
            <button
              key={s.value}
              type="button"
              onClick={() => handleStatusChange(s.value)}
              className={`cursor-pointer rounded-full border px-3 py-1.5 text-sm transition-colors ${
                statusDraft === s.value
                  ? 'border-primary bg-primary text-on-primary'
                  : 'border-border bg-card text-muted-foreground hover:border-ring/40 hover:text-foreground'
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>
        <div className="flex gap-1">
          {PRIORITIES.map((p) => (
            <button
              key={p.value}
              type="button"
              onClick={() => handlePriorityChange(p.value)}
              className={`cursor-pointer rounded-full border px-3 py-1.5 text-sm transition-colors ${
                priorityDraft === p.value
                  ? 'border-primary bg-primary text-on-primary'
                  : 'border-border bg-card text-muted-foreground hover:border-ring/40 hover:text-foreground'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
        <div className="flex gap-1 ml-auto">
          {SORTS.map((s) => (
            <button
              key={s.value}
              type="button"
              onClick={() => handleSortChange(s.value)}
              className={`cursor-pointer rounded-md border px-3 py-1.5 text-sm transition-colors ${
                sort === s.value
                  ? 'border-primary bg-primary text-on-primary'
                  : 'border-border bg-card text-muted-foreground hover:border-ring/40 hover:text-foreground'
              }`}
            >
              {s.label} {sort === s.value ? (order === 'asc' ? '↑' : '↓') : ''}
            </button>
          ))}
        </div>
        <form onSubmit={handleSearch} className="relative ml-auto w-full max-w-xs">
          <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground">
            <SearchIcon size={16} />
          </span>
          <input
            type="search"
            value={searchDraft}
            onChange={(e) => setSearchDraft(e.target.value)}
            placeholder="Search number or title…"
            aria-label="Search problems"
            className="w-full rounded-md border border-border bg-card py-1.5 pl-8 pr-3 text-sm transition-colors hover:border-ring/40 focus:border-ring"
          />
        </form>
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-card">
        {problemsQuery.isLoading ? (
          <div className="space-y-2 p-5" aria-busy="true">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="h-10 animate-pulse rounded-md bg-muted" />
            ))}
          </div>
        ) : problemsQuery.isError ? (
          <p role="alert" className="p-5 text-sm text-destructive">
            {apiErrorMessage(problemsQuery.error, 'Failed to load problems')}
          </p>
        ) : problemsQuery.data?.data.length === 0 ? (
          <div className="p-10 text-center">
            <p className="text-sm text-muted-foreground">No problems yet.</p>
            <Link to="/problems/new" className="mt-2 inline-block cursor-pointer text-sm text-primary hover:underline">
              Create the first one
            </Link>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-4 py-3 font-medium">Number</th>
                  <th className="px-4 py-3 font-medium">Title</th>
                  <th className="hidden px-4 py-3 font-medium md:table-cell">Owner</th>
                  <th className="px-4 py-3 font-medium">Priority</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="hidden px-4 py-3 font-medium lg:table-cell">Identified</th>
                </tr>
              </thead>
              <tbody>
                {problemsQuery.data?.data.map((p) => (
                  <tr key={p.id} className="border-b border-border/60 transition-colors last:border-0 hover:bg-muted/50">
                    <td className="whitespace-nowrap px-4 py-3 font-mono text-xs">
                      <Link to={`/problems/${p.id}`} className="text-primary hover:underline">
                        {formatProblemNumber(p.number)}
                      </Link>
                    </td>
                    <td className="max-w-xs px-4 py-3">
                      <Link to={`/problems/${p.id}`} className="block truncate hover:underline">
                        {p.title}
                      </Link>
                    </td>
                    <td className="hidden max-w-[10rem] truncate px-4 py-3 text-muted-foreground md:table-cell">
                      {p.owner.name}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
                          p.priority === 'CRITICAL'
                            ? 'bg-red-500/10 text-red-700 dark:text-red-400'
                            : p.priority === 'HIGH'
                              ? 'bg-orange-500/10 text-orange-700 dark:text-orange-400'
                              : p.priority === 'MEDIUM'
                                ? 'bg-amber-500/10 text-amber-700 dark:text-amber-400'
                                : 'bg-gray-500/10 text-gray-700 dark:text-gray-400'
                        }`}
                      >
                        {p.priority}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${getProblemStatusBadgeClass(p.status)}`}>
                        {STATUS_LABELS[p.status] ?? p.status}
                      </span>
                    </td>
                    <td className="hidden max-w-[10rem] truncate px-4 py-3 text-muted-foreground lg:table-cell">
                      {new Date(p.identifiedAt).toLocaleDateString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {meta && meta.pages > 1 && (
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>
            Page {meta.page} of {meta.pages} · {meta.total} problems
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
        <aside aria-label="Detection suggestions">
          <DetectionSuggestionsPanel />
        </aside>
      </div>
    </div>
  );
}