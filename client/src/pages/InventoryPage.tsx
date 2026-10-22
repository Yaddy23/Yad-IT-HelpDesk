import { useState } from 'react';
import type { FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { AssetHubTabs } from '@/components/AssetBadges';
import { apiErrorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { assetsApi, type InventoryItem } from '@/lib/assetsApi';

const inputClass =
  'w-full rounded-md border border-border bg-card px-3 py-2 text-sm transition-colors hover:border-ring/40 focus:border-ring';

export default function InventoryPage() {
  const { hasPermission } = useAuth();
  const queryClient = useQueryClient();
  const [params, setParams] = useSearchParams();
  const q = params.get('q') ?? '';
  const lowStock = params.get('lowStock') === 'true';
  const [searchDraft, setSearchDraft] = useState(q);
  const [showCreate, setShowCreate] = useState(false);
  const [selected, setSelected] = useState<InventoryItem | null>(null);
  const [error, setError] = useState('');

  const itemsQuery = useQuery({
    queryKey: ['inventory', { q, lowStock }],
    queryFn: () => assetsApi.inventory({ q, lowStock }),
  });

  const setParam = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next);
  };

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['inventory'] });
  };

  const stockMove = useMutation({
    mutationFn: (input: { itemId: string; type: 'in' | 'out' | 'adjust'; delta?: number; resultingQuantity?: number; reason: string }) =>
      assetsApi.moveStock(input.itemId, { type: input.type, delta: input.delta, resultingQuantity: input.resultingQuantity, reason: input.reason }),
    onSuccess: () => {
      setError('');
      setSelected(null);
      invalidate();
    },
    onError: (e) => setError(apiErrorMessage(e, 'Stock movement failed')),
  });

  const handleSearch = (e: FormEvent) => {
    e.preventDefault();
    setParam('q', searchDraft.trim());
  };

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Inventory</h1>
          <p className="text-sm text-muted-foreground">{itemsQuery.data ? `${itemsQuery.data.meta.total} items on hand` : 'Loading…'}</p>
        </div>
        {hasPermission('assets:create') && (
          <button
            type="button"
            onClick={() => setShowCreate((v) => !v)}
            aria-expanded={showCreate}
            className="cursor-pointer rounded-md bg-primary px-4 py-2 text-sm font-medium text-on-primary transition-opacity hover:opacity-90"
          >
            {showCreate ? 'Close form' : 'New item'}
          </button>
        )}
      </div>

      <div className="mt-4">
        <AssetHubTabs />
      </div>

      {showCreate && <CreateItemForm onDone={() => setShowCreate(false)} />}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setParam('lowStock', lowStock ? '' : 'true')}
          aria-pressed={lowStock}
          className={`cursor-pointer rounded-full border px-3 py-1.5 text-sm transition-colors ${
            lowStock
              ? 'border-warning bg-warning/15 text-warning'
              : 'border-border bg-card text-muted-foreground hover:border-ring/40 hover:text-foreground'
          }`}
        >
          Low stock only
        </button>
        <form onSubmit={handleSearch} className="ml-auto w-full max-w-xs">
          <input
            type="search"
            value={searchDraft}
            onChange={(e) => setSearchDraft(e.target.value)}
            placeholder="Search name or SKU…"
            aria-label="Search inventory"
            className="w-full rounded-md border border-border bg-card py-1.5 px-3 text-sm transition-colors hover:border-ring/40 focus:border-ring"
          />
        </form>
      </div>

      <div className="mt-4 overflow-x-auto rounded-xl border border-border bg-card">
        {itemsQuery.isLoading ? (
          <div className="space-y-2 p-5">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="h-10 animate-pulse rounded-md bg-muted" />
            ))}
          </div>
        ) : itemsQuery.isError ? (
          <p role="alert" className="p-5 text-sm text-destructive">
            {apiErrorMessage(itemsQuery.error, 'Failed to load inventory')}
          </p>
        ) : itemsQuery.data?.data.length === 0 ? (
          <p className="p-10 text-center text-sm text-muted-foreground">No items match this view.</p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-4 py-3 font-medium">Item</th>
                <th className="hidden px-4 py-3 font-medium md:table-cell">SKU</th>
                <th className="px-4 py-3 font-medium">On hand</th>
                <th className="hidden px-4 py-3 font-medium md:table-cell">Reorder at</th>
                <th className="px-4 py-3 font-medium">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {itemsQuery.data?.data.map((item) => {
                const low = item.quantity <= item.reorderPoint;
                return (
                  <tr key={item.id} className="border-b border-border/60 transition-colors last:border-0 hover:bg-muted/50">
                    <td className="px-4 py-3">
                      <p className="font-medium">{item.name}</p>
                      {item.location && <p className="text-xs text-muted-foreground">{item.location.name}</p>}
                    </td>
                    <td className="hidden px-4 py-3 font-mono text-xs text-muted-foreground md:table-cell">{item.sku ?? '—'}</td>
                    <td className="px-4 py-3">
                      <span className={low ? 'font-medium text-destructive' : ''}>
                        {item.quantity} {item.unit}
                        {low && <span className="ml-2 text-xs">· low</span>}
                      </span>
                    </td>
                    <td className="hidden px-4 py-3 text-muted-foreground md:table-cell">{item.reorderPoint}</td>
                    <td className="px-4 py-3 text-right">
                      {hasPermission('assets:update') && (
                        <button
                          type="button"
                          onClick={() => setSelected(item)}
                          className="cursor-pointer rounded-md border border-border bg-card px-2.5 py-1 text-xs transition-colors hover:border-ring/40"
                        >
                          Move stock
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {selected && (
        <StockMoveDialog
          item={selected}
          busy={stockMove.isPending}
          error={error}
          onClose={() => setSelected(null)}
          onSubmit={(input) => stockMove.mutate({ ...input, itemId: selected.id })}
        />
      )}
    </div>
  );
}

function StockMoveDialog({
  item,
  busy,
  error,
  onClose,
  onSubmit,
}: {
  item: InventoryItem;
  busy: boolean;
  error: string;
  onClose: () => void;
  onSubmit: (input: { type: 'in' | 'out' | 'adjust'; delta?: number; resultingQuantity?: number; reason: string }) => void;
}) {
  const [type, setType] = useState<'in' | 'out' | 'adjust'>('out');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-label={`Move stock for ${item.name}`}>
      <div className="w-full max-w-md rounded-xl border border-border bg-card p-5">
        <h3 className="text-base font-semibold">Move stock — {item.name}</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Currently {item.quantity} {item.unit} on hand.
        </p>
        {error && (
          <p role="alert" className="mt-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        )}
        <form
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            const n = Number(amount);
            if (type === 'adjust') onSubmit({ type, resultingQuantity: n, reason });
            else onSubmit({ type, delta: n, reason });
          }}
          className="mt-4 space-y-3"
        >
          <div className="flex gap-2" role="radiogroup" aria-label="Movement type">
            {(['out', 'in', 'adjust'] as const).map((t) => (
              <button
                key={t}
                type="button"
                role="radio"
                aria-checked={type === t}
                onClick={() => setType(t)}
                className={`flex-1 cursor-pointer rounded-md border px-3 py-2 text-sm capitalize transition-colors ${
                  type === t ? 'border-primary bg-primary text-on-primary' : 'border-border bg-card hover:border-ring/40'
                }`}
              >
                {t === 'in' ? 'Stock in' : t === 'out' ? 'Stock out' : 'Adjust'}
              </button>
            ))}
          </div>
          <label className="block text-sm">
            <span className="mb-1 block font-medium">{type === 'adjust' ? 'Counted quantity' : 'Amount'}</span>
            <input required type="number" min="0" step="1" value={amount} onChange={(e) => setAmount(e.target.value)} className={inputClass} />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block font-medium">Reason</span>
            <input required value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why is stock moving?" className={inputClass} />
          </label>
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={onClose} className="cursor-pointer rounded-md border border-border bg-card px-4 py-2 text-sm transition-colors hover:border-ring/40">
              Cancel
            </button>
            <button
              type="submit"
              disabled={busy}
              className="cursor-pointer rounded-md bg-primary px-4 py-2 text-sm font-medium text-on-primary transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy ? 'Saving…' : 'Record movement'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function CreateItemForm({ onDone }: { onDone: () => void }) {
  const queryClient = useQueryClient();
  const [error, setError] = useState('');
  const [form, setForm] = useState({ name: '', sku: '', unit: 'pcs', reorderPoint: '0', initialQuantity: '0', unitCost: '' });

  const create = useMutation({
    mutationFn: () =>
      assetsApi.createItem({
        name: form.name,
        sku: form.sku || undefined,
        unit: form.unit || undefined,
        reorderPoint: form.reorderPoint ? Number(form.reorderPoint) : undefined,
        initialQuantity: form.initialQuantity ? Number(form.initialQuantity) : undefined,
        unitCost: form.unitCost ? Number(form.unitCost) : undefined,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['inventory'] });
      onDone();
    },
    onError: (e) => setError(apiErrorMessage(e, 'Could not create item')),
  });

  return (
    <form
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        create.mutate();
      }}
      className="mt-4 rounded-xl border border-border bg-card p-5"
      aria-label="Create inventory item"
    >
      <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-6">
        <label className="block text-sm sm:col-span-2">
          <span className="mb-1 block font-medium">Name *</span>
          <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={inputClass} />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-medium">SKU</span>
          <input value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })} className={inputClass} />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-medium">Unit</span>
          <input value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} className={inputClass} />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-medium">Reorder point</span>
          <input type="number" min="0" value={form.reorderPoint} onChange={(e) => setForm({ ...form, reorderPoint: e.target.value })} className={inputClass} />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-medium">Initial quantity</span>
          <input type="number" min="0" value={form.initialQuantity} onChange={(e) => setForm({ ...form, initialQuantity: e.target.value })} className={inputClass} />
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
          {create.isPending ? 'Creating…' : 'Create item'}
        </button>
        <button type="button" onClick={onDone} className="cursor-pointer rounded-md border border-border bg-card px-4 py-2 text-sm transition-colors hover:border-ring/40">
          Cancel
        </button>
      </div>
    </form>
  );
}
