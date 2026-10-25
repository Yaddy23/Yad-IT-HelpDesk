import { useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';

import { SearchIcon } from '@/components/icons';
import { apiErrorMessage } from '@/lib/api';
import {
  KNOWN_ERROR_STATUS_LABELS,
  KNOWN_ERROR_VISIBILITY_LABELS,
  getKnownErrorStatusBadgeClass,
  useKnownErrors,
  type KnownErrorStatus,
  type KnownErrorVisibility,
  type ListKnownErrorsQuery,
} from '@/lib/problemApi';

const STATUSES: { value: KnownErrorStatus | ''; label: string }[] = [
  { value: '', label: 'All' },
  { value: 'DRAFT', label: 'Draft' },
  { value: 'UNDER_REVIEW', label: 'Under Review' },
  { value: 'PUBLISHED', label: 'Published' },
  { value: 'RETIRED', label: 'Retired' },
];

const VISIBILITIES: { value: KnownErrorVisibility | ''; label: string }[] = [
  { value: '', label: 'All' },
  { value: 'IT_ONLY', label: 'IT only' },
  { value: 'EMPLOYEE_SELF_SERVICE', label: 'Employee self-service' },
];

const SORTS: { value: NonNullable<ListKnownErrorsQuery['sort']>; label: string }[] = [
  { value: 'updatedAt', label: 'Updated' },
  { value: 'createdAt', label: 'Created' },
  { value: 'status', label: 'Status' },
  { value: 'reviewDueAt', label: 'Review due' },
];

export default function KnownErrorsPage() {
  const [params, setParams] = useSearchParams();
  const status = params.get('status') ?? '';
  const visibility = params.get('visibility') ?? '';
  const search = params.get('search') ?? '';
  const sort = (params.get('sort') as ListKnownErrorsQuery['sort']) ?? 'updatedAt';
  const order = (params.get('order') as 'asc' | 'desc') ?? 'desc';
  const page = Number(params.get('page') ?? '1');

  const [searchDraft, setSearchDraft] = useState(search);
  const [statusDraft, setStatusDraft] = useState(status);
  const [visibilityDraft, setVisibilityDraft] = useState(visibility);

  const knownErrorsQuery = useKnownErrors({
    status: statusDraft || undefined,
    visibility: visibilityDraft || undefined,
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

  const meta = knownErrorsQuery.data?.meta;

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Known Errors</h1>
          <p className="text-sm text-muted-foreground">
            {knownErrorsQuery.data ? `${knownErrorsQuery.data.meta.total} known errors` : 'Loading…'}
          </p>
        </div>
        <Link
          to="/known-errors/new"
          className="cursor-pointer rounded-md bg-primary px-4 py-2 text-sm font-medium text-on-primary transition-opacity hover:opacity-90"
        >
          New known error
        </Link>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <div className="flex gap-1">
          {STATUSES.map((s) => (
            <button
              key={s.value || 'all'}
              type="button"
              onClick={() => {
                setStatusDraft(s.value);
                setParam('status', s.value);
              }}
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
          {VISIBILITIES.map((v) => (
            <button
              key={v.value || 'all'}
              type="button"
              onClick={() => {
                setVisibilityDraft(v.value);
                setParam('visibility', v.value);
              }}
              className={`cursor-pointer rounded-full border px-3 py-1.5 text-sm transition-colors ${
                visibilityDraft === v.value
                  ? 'border-primary bg-primary text-on-primary'
                  : 'border-border bg-card text-muted-foreground hover:border-ring/40 hover:text-foreground'
              }`}
            >
              {v.label}
            </button>
          ))}
        </div>
        <div className="flex gap-1 ml-auto">
          {SORTS.map((s) => (
            <button
              key={s.value}
              type="button"
              onClick={() => {
                if (s.value === sort) {
                  setParam('order', order === 'asc' ? 'desc' : 'asc');
                } else {
                  setParam('sort', s.value);
                  setParam('order', 'desc');
                }
              }}
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
            aria-label="Search known errors"
            className="w-full rounded-md border border-border bg-card py-1.5 pl-8 pr-3 text-sm transition-colors hover:border-ring/40 focus:border-ring"
          />
        </form>
      </div>

      <div className="mt-4 overflow-hidden rounded-xl border border-border bg-card">
        {knownErrorsQuery.isLoading ? (
          <div className="space-y-2 p-5" aria-busy="true">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="h-10 animate-pulse rounded-md bg-muted" />
            ))}
          </div>
        ) : knownErrorsQuery.isError ? (
          <p role="alert" className="p-5 text-sm text-destructive">
            {apiErrorMessage(knownErrorsQuery.error, 'Failed to load known errors')}
          </p>
        ) : knownErrorsQuery.data?.data.length === 0 ? (
          <div className="p-10 text-center">
            <p className="text-sm text-muted-foreground">No known errors yet.</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Raise one from a problem's workaround once the root cause is understood.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-4 py-3 font-medium">Number</th>
                  <th className="px-4 py-3 font-medium">Title</th>
                  <th className="hidden px-4 py-3 font-medium md:table-cell">Problem</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="hidden px-4 py-3 font-medium md:table-cell">Visibility</th>
                  <th className="hidden px-4 py-3 font-medium lg:table-cell">Owner</th>
                </tr>
              </thead>
              <tbody>
                {knownErrorsQuery.data?.data.map((ke) => (
                  <tr key={ke.id} className="border-b border-border/60 transition-colors last:border-0 hover:bg-muted/50">
                    <td className="whitespace-nowrap px-4 py-3 font-mono text-xs">
                      <Link to={`/known-errors/${ke.id}`} className="text-primary hover:underline">
                        {ke.number}
                      </Link>
                    </td>
                    <td className="max-w-xs px-4 py-3">
                      <Link to={`/known-errors/${ke.id}`} className="block truncate hover:underline">
                        {ke.title}
                      </Link>
                    </td>
                    <td className="hidden whitespace-nowrap px-4 py-3 font-mono text-xs text-muted-foreground md:table-cell">
                      <Link to={`/problems/${ke.problemId}`} className="hover:underline">
                        View
                      </Link>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${getKnownErrorStatusBadgeClass(ke.status)}`}>
                        {KNOWN_ERROR_STATUS_LABELS[ke.status]}
                      </span>
                    </td>
                    <td className="hidden px-4 py-3 text-muted-foreground md:table-cell">
                      {KNOWN_ERROR_VISIBILITY_LABELS[ke.visibility]}
                    </td>
                    <td className="hidden max-w-[10rem] truncate px-4 py-3 text-muted-foreground lg:table-cell">
                      {ke.owner.name}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {meta && meta.pages > 1 && (
        <div className="mt-4 flex items-center justify-between text-sm text-muted-foreground">
          <span>
            Page {meta.page} of {meta.pages} · {meta.total} known errors
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
