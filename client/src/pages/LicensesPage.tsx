import { useState } from 'react';
import type { FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { AssetHubTabs } from '@/components/AssetBadges';
import { apiErrorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { assetsApi, type LicenseType, type SoftwareLicense } from '@/lib/assetsApi';

const inputClass =
  'w-full rounded-md border border-border bg-card px-3 py-2 text-sm transition-colors hover:border-ring/40 focus:border-ring';

const TYPE_LABELS: Record<LicenseType, string> = {
  perpetual: 'Perpetual',
  subscription: 'Subscription',
  oem: 'OEM',
  volume: 'Volume',
};

export default function LicensesPage() {
  const { hasPermission } = useAuth();
  const queryClient = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [selected, setSelected] = useState<SoftwareLicense | null>(null);
  const [error, setError] = useState('');

  const licensesQuery = useQuery({
    queryKey: ['licenses'],
    queryFn: () => assetsApi.licenses({}),
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['licenses'] });
    void queryClient.invalidateQueries({ queryKey: ['license'] });
  };

  const returnSeat = useMutation({
    mutationFn: (assignmentId: string) => assetsApi.returnSeat(assignmentId, 'Returned from licenses page'),
    onSuccess: () => {
      setError('');
      invalidate();
    },
    onError: (e) => setError(apiErrorMessage(e, 'Return failed')),
  });

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Licenses</h1>
          <p className="text-sm text-muted-foreground">{licensesQuery.data ? `${licensesQuery.data.meta.total} licenses tracked` : 'Loading…'}</p>
        </div>
        {hasPermission('assets:create') && (
          <button
            type="button"
            onClick={() => setShowCreate((v) => !v)}
            aria-expanded={showCreate}
            className="cursor-pointer rounded-md bg-primary px-4 py-2 text-sm font-medium text-on-primary transition-opacity hover:opacity-90"
          >
            {showCreate ? 'Close form' : 'New license'}
          </button>
        )}
      </div>

      <div className="mt-4">
        <AssetHubTabs />
      </div>

      {showCreate && <CreateLicenseForm onDone={() => setShowCreate(false)} />}

      {error && (
        <p role="alert" className="mt-3 text-sm text-destructive">
          {error}
        </p>
      )}

      <div className="mt-4 overflow-x-auto rounded-xl border border-border bg-card">
        {licensesQuery.isLoading ? (
          <div className="space-y-2 p-5">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="h-10 animate-pulse rounded-md bg-muted" />
            ))}
          </div>
        ) : licensesQuery.isError ? (
          <p role="alert" className="p-5 text-sm text-destructive">
            {apiErrorMessage(licensesQuery.error, 'Failed to load licenses')}
          </p>
        ) : licensesQuery.data?.data.length === 0 ? (
          <p className="p-10 text-center text-sm text-muted-foreground">No licenses tracked yet.</p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-4 py-3 font-medium">Name</th>
                <th className="hidden px-4 py-3 font-medium md:table-cell">Type</th>
                <th className="px-4 py-3 font-medium">Seats</th>
                <th className="hidden px-4 py-3 font-medium lg:table-cell">Expires</th>
                <th className="px-4 py-3 font-medium">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {licensesQuery.data?.data.map((l) => {
                const full = l.seatsInUse >= l.seats;
                return (
                  <tr key={l.id} className="border-b border-border/60 transition-colors last:border-0 hover:bg-muted/50">
                    <td className="px-4 py-3">
                      <p className="font-medium">{l.name}</p>
                      {l.vendor && <p className="text-xs text-muted-foreground">{l.vendor.name}</p>}
                    </td>
                    <td className="hidden px-4 py-3 text-muted-foreground md:table-cell">{TYPE_LABELS[l.type]}</td>
                    <td className="px-4 py-3">
                      <span className={full ? 'font-medium text-destructive' : ''}>
                        {l.seatsInUse} / {l.seats}
                      </span>
                    </td>
                    <td className="hidden whitespace-nowrap px-4 py-3 text-muted-foreground lg:table-cell">
                      {l.expiresAt ? new Date(l.expiresAt).toLocaleDateString() : '—'}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {hasPermission('assets:assign') && (
                        <button
                          type="button"
                          onClick={() => setSelected(l)}
                          className="cursor-pointer rounded-md border border-border bg-card px-2.5 py-1 text-xs transition-colors hover:border-ring/40"
                        >
                          Manage seats
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
        <SeatsDialog
          license={selected}
          onClose={() => setSelected(null)}
          onChanged={invalidate}
          onError={(m) => setError(m)}
          onReturn={(id) => returnSeat.mutate(id)}
          returning={returnSeat.isPending}
        />
      )}
    </div>
  );
}

function SeatsDialog({
  license,
  onClose,
  onChanged,
  onError,
  onReturn,
  returning,
}: {
  license: SoftwareLicense;
  onClose: () => void;
  onChanged: () => void;
  onError: (message: string) => void;
  onReturn: (assignmentId: string) => void;
  returning: boolean;
}) {
  const [employeeId, setEmployeeId] = useState('');
  const employeesQuery = useQuery({ queryKey: ['asset-employees'], queryFn: assetsApi.employees });
  const detailQuery = useQuery({ queryKey: ['license', license.id], queryFn: () => assetsApi.licenseDetail(license.id) });

  const assign = useMutation({
    mutationFn: () => assetsApi.assignSeat(license.id, employeeId),
    onSuccess: () => {
      setEmployeeId('');
      onChanged();
      void detailQuery.refetch();
    },
    onError: (e) => onError(apiErrorMessage(e, 'Assign failed')),
  });

  const active = detailQuery.data?.assignments.filter((a) => a.status === 'active') ?? [];
  const history = detailQuery.data?.assignments ?? [];
  const full = active.length >= license.seats;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-label={`Seats for ${license.name}`}>
      <div className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-xl border border-border bg-card p-5">
        <h3 className="text-base font-semibold">{license.name}</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          {active.length} of {license.seats} seats in use.
        </p>

        <form
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            if (employeeId) assign.mutate();
          }}
          className="mt-4 flex flex-wrap items-end gap-2"
        >
          <label className="block flex-1 text-sm">
            <span className="mb-1 block font-medium">Assign seat</span>
            <select required value={employeeId} onChange={(e) => setEmployeeId(e.target.value)} className={`${inputClass} cursor-pointer`} disabled={full}>
              <option value="">{full ? 'No seats left' : 'Choose employee…'}</option>
              {employeesQuery.data?.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name} ({e.employeeId})
                </option>
              ))}
            </select>
          </label>
          <button
            type="submit"
            disabled={full || assign.isPending}
            className="cursor-pointer rounded-md bg-primary px-4 py-2 text-sm font-medium text-on-primary transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Assign
          </button>
        </form>

        <ul className="mt-4 divide-y divide-border/60">
          {history.map((a) => (
            <li key={a.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
              <div className="min-w-0">
                <p className="truncate font-medium">{a.employee.name}</p>
                <p className="text-xs text-muted-foreground">
                  {a.status === 'active'
                    ? `Since ${new Date(a.assignedAt).toLocaleDateString()}`
                    : `Returned ${a.returnedAt ? new Date(a.returnedAt).toLocaleDateString() : ''}`}
                </p>
              </div>
              {a.status === 'active' ? (
                <button
                  type="button"
                  disabled={returning}
                  onClick={() => onReturn(a.id)}
                  className="cursor-pointer rounded-md border border-border bg-card px-2.5 py-1 text-xs transition-colors hover:border-ring/40 disabled:opacity-40"
                >
                  Return
                </button>
              ) : (
                <span className="rounded-full border border-border bg-muted px-2 py-0.5 text-xs text-muted-foreground">Returned</span>
              )}
            </li>
          ))}
        </ul>

        <div className="mt-4 flex justify-end">
          <button type="button" onClick={onClose} className="cursor-pointer rounded-md border border-border bg-card px-4 py-2 text-sm transition-colors hover:border-ring/40">
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

function CreateLicenseForm({ onDone }: { onDone: () => void }) {
  const queryClient = useQueryClient();
  const [error, setError] = useState('');
  const [form, setForm] = useState({ name: '', seats: '5', type: 'perpetual', licenseKey: '', expiresAt: '' });

  const create = useMutation({
    mutationFn: () =>
      assetsApi.createLicense({
        name: form.name,
        seats: Number(form.seats),
        type: form.type as LicenseType,
        licenseKey: form.licenseKey || undefined,
        expiresAt: form.expiresAt ? new Date(form.expiresAt).toISOString() : undefined,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['licenses'] });
      onDone();
    },
    onError: (e) => setError(apiErrorMessage(e, 'Could not create license')),
  });

  return (
    <form
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        create.mutate();
      }}
      className="mt-4 rounded-xl border border-border bg-card p-5"
      aria-label="Create license"
    >
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <label className="block text-sm lg:col-span-2">
          <span className="mb-1 block font-medium">Name *</span>
          <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={inputClass} />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-medium">Seats</span>
          <input required type="number" min="1" value={form.seats} onChange={(e) => setForm({ ...form, seats: e.target.value })} className={inputClass} />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-medium">Type</span>
          <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })} className={`${inputClass} cursor-pointer`}>
            {(Object.keys(TYPE_LABELS) as LicenseType[]).map((t) => (
              <option key={t} value={t}>
                {TYPE_LABELS[t]}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-medium">Expires</span>
          <input type="date" value={form.expiresAt} onChange={(e) => setForm({ ...form, expiresAt: e.target.value })} className={inputClass} />
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
          {create.isPending ? 'Creating…' : 'Create license'}
        </button>
        <button type="button" onClick={onDone} className="cursor-pointer rounded-md border border-border bg-card px-4 py-2 text-sm transition-colors hover:border-ring/40">
          Cancel
        </button>
      </div>
    </form>
  );
}
