import { useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { AssetStatusBadge, AssetHubTabs } from '@/components/AssetBadges';
import { SearchIcon } from '@/components/icons';
import { useAuth } from '@/lib/auth';
import { apiErrorMessage } from '@/lib/api';
import { assetsApi, ASSET_STATUS_LABELS, CATEGORY_LABELS, type AssetCategory, type AssetStatus } from '@/lib/assetsApi';

const STATUSES = Object.keys(ASSET_STATUS_LABELS) as AssetStatus[];
const CATEGORIES = Object.keys(CATEGORY_LABELS) as AssetCategory[];

export default function AssetsPage() {
  const { hasPermission } = useAuth();
  const [params, setParams] = useSearchParams();
  const q = params.get('q') ?? '';
  const status = params.get('status') ?? '';
  const category = params.get('category') ?? '';
  const page = Number(params.get('page') ?? '1');

  const [searchDraft, setSearchDraft] = useState(q);
  const [showCreate, setShowCreate] = useState(false);

  const assetsQuery = useQuery({
    queryKey: ['assets', { q, status, category, page }],
    queryFn: () => assetsApi.list({ q, status, category, page }),
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
    setParam('q', searchDraft.trim());
  };

  const meta = assetsQuery.data?.meta;

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Assets</h1>
          <p className="text-sm text-muted-foreground">
            {meta ? `${meta.total} assets on record` : 'Loading…'}
          </p>
        </div>
        {hasPermission('assets:create') && (
          <button
            type="button"
            onClick={() => setShowCreate((v) => !v)}
            aria-expanded={showCreate}
            className="cursor-pointer rounded-md bg-primary px-4 py-2 text-sm font-medium text-on-primary transition-opacity hover:opacity-90"
          >
            {showCreate ? 'Close form' : 'New asset'}
          </button>
        )}
      </div>

      <div className="mt-4">
        <AssetHubTabs />
      </div>

      {showCreate && <CreateAssetForm onDone={() => setShowCreate(false)} />}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <select
          value={status}
          onChange={(e) => setParam('status', e.target.value)}
          aria-label="Filter by status"
          className="cursor-pointer rounded-md border border-border bg-card px-3 py-1.5 text-sm transition-colors hover:border-ring/40 focus:border-ring"
        >
          <option value="">All statuses</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {ASSET_STATUS_LABELS[s]}
            </option>
          ))}
        </select>
        <select
          value={category}
          onChange={(e) => setParam('category', e.target.value)}
          aria-label="Filter by category"
          className="cursor-pointer rounded-md border border-border bg-card px-3 py-1.5 text-sm transition-colors hover:border-ring/40 focus:border-ring"
        >
          <option value="">All categories</option>
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {CATEGORY_LABELS[c]}
            </option>
          ))}
        </select>
        <form onSubmit={handleSearch} className="relative ml-auto w-full max-w-xs">
          <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground">
            <SearchIcon size={16} />
          </span>
          <input
            type="search"
            value={searchDraft}
            onChange={(e) => setSearchDraft(e.target.value)}
            placeholder="Search number, name, serial…"
            aria-label="Search assets"
            className="w-full rounded-md border border-border bg-card py-1.5 pl-8 pr-3 text-sm transition-colors hover:border-ring/40 focus:border-ring"
          />
        </form>
      </div>

      <div className="mt-4 overflow-x-auto rounded-xl border border-border bg-card">
        {assetsQuery.isLoading ? (
          <div className="space-y-2 p-5">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="h-10 animate-pulse rounded-md bg-muted" />
            ))}
          </div>
        ) : assetsQuery.isError ? (
          <p role="alert" className="p-5 text-sm text-destructive">
            {apiErrorMessage(assetsQuery.error, 'Failed to load assets')}
          </p>
        ) : assetsQuery.data?.data.length === 0 ? (
          <div className="p-10 text-center">
            <p className="text-sm text-muted-foreground">No assets match this view.</p>
            {hasPermission('assets:create') && (
              <button type="button" onClick={() => setShowCreate(true)} className="mt-2 cursor-pointer text-sm text-primary hover:underline">
                Register the first one
              </button>
            )}
          </div>
        ) : (
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-4 py-3 font-medium">Number</th>
                <th className="px-4 py-3 font-medium">Name</th>
                <th className="hidden px-4 py-3 font-medium md:table-cell">Category</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="hidden px-4 py-3 font-medium lg:table-cell">Custodian</th>
                <th className="hidden px-4 py-3 font-medium lg:table-cell">Location</th>
              </tr>
            </thead>
            <tbody>
              {assetsQuery.data?.data.map((a) => (
                <tr key={a.id} className="border-b border-border/60 transition-colors last:border-0 hover:bg-muted/50">
                  <td className="whitespace-nowrap px-4 py-3 font-mono text-xs">
                    <Link to={`/assets/${a.id}`} className="text-primary hover:underline">
                      {a.number}
                    </Link>
                  </td>
                  <td className="max-w-xs px-4 py-3">
                    <Link to={`/assets/${a.id}`} className="block truncate hover:underline">
                      {a.name}
                    </Link>
                  </td>
                  <td className="hidden px-4 py-3 text-muted-foreground md:table-cell">{CATEGORY_LABELS[a.category]}</td>
                  <td className="px-4 py-3">
                    <AssetStatusBadge status={a.status} />
                  </td>
                  <td className="hidden max-w-[10rem] truncate px-4 py-3 text-muted-foreground lg:table-cell">
                    {a.custodian?.name ?? '—'}
                  </td>
                  <td className="hidden max-w-[10rem] truncate px-4 py-3 text-muted-foreground lg:table-cell">
                    {a.location?.name ?? '—'}
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
            Page {meta.page} of {meta.pages} · {meta.total} assets
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

const inputClass =
  'w-full rounded-md border border-border bg-card px-3 py-2 text-sm transition-colors hover:border-ring/40 focus:border-ring';

function CreateAssetForm({ onDone }: { onDone: () => void }) {
  const queryClient = useQueryClient();
  const [error, setError] = useState('');
  const [form, setForm] = useState({
    name: '',
    category: 'hardware',
    manufacturer: '',
    model: '',
    serialNumber: '',
    purchaseCost: '',
    warrantyExpiry: '',
  });

  const create = useMutation({
    mutationFn: () =>
      assetsApi.create({
        name: form.name,
        category: form.category,
        manufacturer: form.manufacturer || undefined,
        model: form.model || undefined,
        serialNumber: form.serialNumber || undefined,
        purchaseCost: form.purchaseCost ? Number(form.purchaseCost) : undefined,
        warrantyExpiry: form.warrantyExpiry ? new Date(form.warrantyExpiry).toISOString() : undefined,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['assets'] });
      onDone();
    },
    onError: (e) => setError(apiErrorMessage(e, 'Could not create asset')),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setError('');
    create.mutate();
  };

  return (
    <form onSubmit={submit} className="mt-4 rounded-xl border border-border bg-card p-5" aria-label="Create asset">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <label className="block text-sm">
          <span className="mb-1 block font-medium">Name *</span>
          <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={inputClass} />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-medium">Category</span>
          <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} className={`${inputClass} cursor-pointer`}>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {CATEGORY_LABELS[c]}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-medium">Manufacturer</span>
          <input value={form.manufacturer} onChange={(e) => setForm({ ...form, manufacturer: e.target.value })} className={inputClass} />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-medium">Model</span>
          <input value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} className={inputClass} />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-medium">Serial number</span>
          <input value={form.serialNumber} onChange={(e) => setForm({ ...form, serialNumber: e.target.value })} className={inputClass} />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-medium">Purchase cost</span>
          <input type="number" min="0" step="0.01" value={form.purchaseCost} onChange={(e) => setForm({ ...form, purchaseCost: e.target.value })} className={inputClass} />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-medium">Warranty expiry</span>
          <input type="date" value={form.warrantyExpiry} onChange={(e) => setForm({ ...form, warrantyExpiry: e.target.value })} className={inputClass} />
        </label>
      </div>
      {error && (
        <p role="alert" className="mt-3 text-sm text-destructive">
          {error}
        </p>
      )}
      <div className="mt-4 flex gap-2">
        <button
          type="submit"
          disabled={create.isPending}
          className="cursor-pointer rounded-md bg-primary px-4 py-2 text-sm font-medium text-on-primary transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {create.isPending ? 'Creating…' : 'Create asset'}
        </button>
        <button
          type="button"
          onClick={onDone}
          className="cursor-pointer rounded-md border border-border bg-card px-4 py-2 text-sm transition-colors hover:border-ring/40"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
