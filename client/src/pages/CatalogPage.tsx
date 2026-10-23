import { useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { apiErrorMessage } from '@/lib/api';
import { catalogApi, requestsApi, type CatalogItem, type FormField } from '@/lib/serviceApi';

const inputClass =
  'w-full rounded-md border border-border bg-card px-3 py-2 text-sm transition-colors hover:border-ring/40 focus:border-ring';
const buttonPrimary =
  'cursor-pointer rounded-md bg-primary px-4 py-2 text-sm font-medium text-on-primary transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50';
const buttonGhost =
  'cursor-pointer rounded-md border border-border bg-card px-3 py-1.5 text-sm transition-colors hover:border-ring/40 disabled:cursor-not-allowed disabled:opacity-40';

export default function CatalogPage() {
  const catalogQuery = useQuery({ queryKey: ['catalog'], queryFn: catalogApi.list });
  const [requesting, setRequesting] = useState<CatalogItem | null>(null);
  const [requested, setRequested] = useState<{ number: string; status: string } | null>(null);

  // Group active items by category, keeping the server's sort order.
  const groups = useMemo(() => {
    const items = catalogQuery.data ?? [];
    const map = new Map<string, CatalogItem[]>();
    for (const item of items) {
      const key = item.category?.trim() || 'Other services';
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(item);
    }
    return [...map.entries()];
  }, [catalogQuery.data]);

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Service catalog</h1>
          <p className="text-sm text-muted-foreground">Request services from IT — approvals are routed automatically.</p>
        </div>
        <Link to="/my-requests" className="cursor-pointer text-sm text-primary hover:underline">
          My requests →
        </Link>
      </div>

      {catalogQuery.isLoading ? (
        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="h-36 animate-pulse rounded-xl bg-muted" />
          ))}
        </div>
      ) : catalogQuery.isError ? (
        <p role="alert" className="mt-6 text-sm text-destructive">
          {apiErrorMessage(catalogQuery.error, 'Failed to load the catalog')}
        </p>
      ) : groups.length === 0 ? (
        <div className="mt-6 rounded-xl border border-border bg-card p-10 text-center">
          <p className="text-sm text-muted-foreground">No services are published yet.</p>
        </div>
      ) : (
        groups.map(([category, items]) => (
          <section key={category} className="mt-6">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">{category}</h2>
            <div className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {items.map((item) => (
                <div key={item.id} className="flex flex-col rounded-xl border border-border bg-card p-4">
                  <h3 className="font-medium">{item.name}</h3>
                  {item.description && (
                    <p className="mt-1 line-clamp-3 flex-1 text-sm text-muted-foreground">{item.description}</p>
                  )}
                  <div className="mt-3 flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">
                      {item.approvalRule?.active ? 'Approval required' : 'No approval needed'}
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        setRequested(null);
                        setRequesting(item);
                      }}
                      className="cursor-pointer rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-on-primary transition-opacity hover:opacity-90"
                    >
                      Request
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </section>
        ))
      )}

      {requesting && (
        <RequestDialog
          item={requesting}
          onClose={() => setRequesting(null)}
          onCreated={(r) => {
            setRequesting(null);
            setRequested(r);
          }}
        />
      )}

      {requested && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Request submitted"
          onKeyDown={(e) => {
            if (e.key === 'Escape') setRequested(null);
          }}
        >
          <div className="w-full max-w-md rounded-xl border border-border bg-card p-5 text-center">
            <h3 className="text-base font-semibold">Request submitted</h3>
            <p className="mt-2 text-sm text-muted-foreground">
              {requested.number} —{' '}
              {requested.status === 'in_fulfillment'
                ? 'no approval was needed, it is already being handled.'
                : 'it is now waiting for approval.'}
            </p>
            <div className="mt-4 flex justify-center gap-2">
              <Link to="/my-requests" className={buttonPrimary}>
                Track it
              </Link>
              <button type="button" onClick={() => setRequested(null)} className={buttonGhost}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Request dialog — renders the item's form schema ─────────────────────── */

function RequestDialog({
  item,
  onClose,
  onCreated,
}: {
  item: CatalogItem;
  onClose: () => void;
  onCreated: (r: { number: string; status: string }) => void;
}) {
  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  const [error, setError] = useState('');

  const submitRequest = useMutation({
    mutationFn: () => requestsApi.create(item.id, answers),
    onSuccess: (created) => onCreated({ number: created.number, status: created.status }),
    onError: (e) => setError(apiErrorMessage(e, 'Could not submit the request')),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setError('');
    submitRequest.mutate();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={`Request ${item.name}`}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose();
      }}
    >
      <form onSubmit={submit} noValidate className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-xl border border-border bg-card p-5">
        <h3 className="text-base font-semibold">Request {item.name}</h3>
        {item.description && <p className="mt-1 text-sm text-muted-foreground">{item.description}</p>}

        <div className="mt-4 space-y-4">
          {item.formSchema.map((field) => (
            <FormFieldInput key={field.name} field={field} value={answers[field.name]} onChange={(v) => setAnswers({ ...answers, [field.name]: v })} />
          ))}
        </div>

        {error && (
          <p role="alert" className="mt-3 text-sm text-destructive">
            {error}
          </p>
        )}
        <div className="mt-4 flex gap-2">
          <button type="submit" disabled={submitRequest.isPending} className={buttonPrimary}>
            {submitRequest.isPending ? 'Submitting…' : 'Submit request'}
          </button>
          <button type="button" onClick={onClose} className={buttonGhost}>
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}

function FormFieldInput({
  field,
  value,
  onChange,
}: {
  field: FormField;
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  const label = (
    <span className="mb-1 block font-medium">
      {field.label}
      {field.required ? ' *' : ''}
    </span>
  );
  const help = field.help ? <span className="mt-1 block text-xs text-muted-foreground">{field.help}</span> : null;
  const commonClass = inputClass;

  switch (field.type) {
    case 'textarea':
      return (
        <label className="block text-sm">
          {label}
          <textarea rows={3} maxLength={5000} required={field.required} value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} className={commonClass} />
          {help}
        </label>
      );
    case 'select':
      return (
        <label className="block text-sm">
          {label}
          <select required={field.required} value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} className={commonClass}>
            <option value="" disabled>
              Choose…
            </option>
            {(field.options ?? []).map((opt) => (
              <option key={opt} value={opt}>
                {opt}
              </option>
            ))}
          </select>
          {help}
        </label>
      );
    case 'number':
      return (
        <label className="block text-sm">
          {label}
          <input type="number" required={field.required} value={String(value ?? '')} onChange={(e) => onChange(e.target.value === '' ? '' : Number(e.target.value))} className={commonClass} />
          {help}
        </label>
      );
    case 'date':
      return (
        <label className="block text-sm">
          {label}
          <input type="date" required={field.required} value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} className={commonClass} />
          {help}
        </label>
      );
    case 'checkbox':
      return (
        <label className="flex cursor-pointer items-center gap-2 text-sm">
          <input type="checkbox" checked={value === true} onChange={(e) => onChange(e.target.checked)} className="cursor-pointer" />
          <span className="font-medium">
            {field.label}
            {field.required ? ' *' : ''}
          </span>
          {help}
        </label>
      );
    default:
      return (
        <label className="block text-sm">
          {label}
          <input type="text" maxLength={200} required={field.required} value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} className={commonClass} />
          {help}
        </label>
      );
  }
}
