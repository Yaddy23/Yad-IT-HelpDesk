import { useState } from 'react';
import type { FormEvent } from 'react';
import { useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { AssetStatusBadge } from '@/components/AssetBadges';
import { apiErrorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import {
  assetsApi,
  ASSET_STATUS_LABELS,
  CATEGORY_LABELS,
  type AssetDetailData,
  type AssetStatus,
  type WarrantyClaimStatus,
} from '@/lib/assetsApi';

/* Mirrors the server's TRANSITIONS map so the UI only offers legal moves. */
const TRANSITIONS: Record<AssetStatus, AssetStatus[]> = {
  in_stock: ['deployed', 'in_maintenance', 'retired', 'lost'],
  deployed: ['in_repair', 'in_maintenance', 'retired', 'lost'],
  in_repair: ['in_stock', 'deployed', 'retired', 'lost'],
  in_maintenance: ['in_stock', 'deployed', 'retired'],
  retired: [],
  lost: [],
};

const CLAIM_TARGETS: Record<WarrantyClaimStatus, WarrantyClaimStatus[]> = {
  open: ['submitted', 'resolved', 'rejected'],
  submitted: ['approved', 'rejected', 'resolved'],
  approved: ['resolved', 'rejected'],
  rejected: [],
  resolved: [],
};

const card = 'rounded-xl border border-border bg-card p-5';
const inputClass =
  'w-full rounded-md border border-border bg-card px-3 py-2 text-sm transition-colors hover:border-ring/40 focus:border-ring';

export default function AssetDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { hasPermission } = useAuth();
  const queryClient = useQueryClient();
  const [actionError, setActionError] = useState('');

  const assetQuery = useQuery({
    queryKey: ['asset', id],
    queryFn: () => assetsApi.get(id!),
    enabled: !!id,
  });
  const employeesQuery = useQuery({
    queryKey: ['asset-employees'],
    queryFn: assetsApi.employees,
    enabled: hasPermission('assets:assign'),
  });
  const vendorsQuery = useQuery({
    queryKey: ['vendors'],
    queryFn: assetsApi.vendors,
    enabled: hasPermission('assets:update'),
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['asset', id] });
    void queryClient.invalidateQueries({ queryKey: ['assets'] });
  };
  const act = useMutation({
    mutationFn: async (fn: () => Promise<unknown>) => fn(),
    onSuccess: () => {
      setActionError('');
      invalidate();
    },
    onError: (e) => setActionError(apiErrorMessage(e, 'Action failed')),
  });

  if (assetQuery.isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (assetQuery.isError)
    return (
      <p role="alert" className="text-sm text-destructive">
        {apiErrorMessage(assetQuery.error, 'Failed to load asset')}
      </p>
    );

  const a = assetQuery.data!;
  const canTransition = hasPermission('assets:update') && TRANSITIONS[a.status].length > 0;

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="font-mono text-lg text-muted-foreground">{a.number}</h1>
            <AssetStatusBadge status={a.status} />
          </div>
          <h2 className="mt-1 text-2xl font-semibold">{a.name}</h2>
        </div>
        {canTransition && <TransitionControl asset={a} onGo={(fn) => act.mutate(fn)} busy={act.isPending} />}
      </div>

      {actionError && (
        <p role="alert" className="mt-3 text-sm text-destructive">
          {actionError}
        </p>
      )}

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <div className={card}>
          <h3 className="text-sm font-semibold">Details</h3>
          <dl className="mt-3 space-y-2 text-sm">
            <Row label="Category">{CATEGORY_LABELS[a.category]}</Row>
            <Row label="Manufacturer">{a.manufacturer ?? '—'}</Row>
            <Row label="Model">{a.model ?? '—'}</Row>
            <Row label="Serial">{a.serialNumber ?? '—'}</Row>
            <Row label="Custodian">{a.custodian?.name ?? '—'}</Row>
            <Row label="Location">{a.location?.name ?? '—'}</Row>
            <Row label="Department">{a.department?.name ?? '—'}</Row>
            <Row label="Vendor">{a.vendor?.name ?? '—'}</Row>
            <Row label="Purchased">{a.purchasedAt ? new Date(a.purchasedAt).toLocaleDateString() : '—'}</Row>
            <Row label="Cost">{a.purchaseCost != null ? `$${a.purchaseCost.toFixed(2)}` : '—'}</Row>
            <Row label="Warranty until">{a.warrantyExpiry ? new Date(a.warrantyExpiry).toLocaleDateString() : '—'}</Row>
          </dl>
        </div>

        <div className="lg:col-span-2 space-y-4">
          {hasPermission('assets:assign') && <AssignmentSection asset={a} employees={employeesQuery.data ?? []} onGo={(fn) => act.mutate(fn)} busy={act.isPending} />}

          <section className={card} aria-label="Assignment history">
            <h3 className="text-sm font-semibold">Assignment history</h3>
            <HistoryTable
              empty="Never assigned."
              rows={a.assignments.map((as) => ({
                key: as.id,
                main: as.employee.name,
                sub: `Assigned ${new Date(as.assignedAt).toLocaleDateString()} by ${as.assignedBy.name}${as.dueAt ? ` · due ${new Date(as.dueAt).toLocaleDateString()}` : ''}`,
                badge: as.status === 'active' ? 'Active' : 'Returned',
                badgeClass:
                  as.status === 'active'
                    ? 'bg-accent/10 text-accent border-accent/40'
                    : 'bg-muted text-muted-foreground border-border',
              }))}
            />
          </section>

          {hasPermission('assets:update') && (
            <MaintenanceSection
              asset={a}
              vendors={vendorsQuery.data ?? []}
              onGo={(fn) => act.mutate(fn)}
              busy={act.isPending}
            />
          )}

          {hasPermission('assets:update') && (
            <WarrantySection asset={a} vendors={vendorsQuery.data ?? []} onGo={(fn) => act.mutate(fn)} busy={act.isPending} />
          )}
        </div>
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right">{children}</dd>
    </div>
  );
}

function TransitionControl({
  asset,
  onGo,
  busy,
}: {
  asset: AssetDetailData;
  onGo: (fn: () => Promise<unknown>) => void;
  busy: boolean;
}) {
  const options = TRANSITIONS[asset.status];
  const [next, setNext] = useState('');
  return (
    <form
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        if (next) onGo(() => assetsApi.transition(asset.id, next as AssetStatus));
      }}
      className="flex items-center gap-2"
    >
      <label className="text-sm text-muted-foreground" htmlFor="asset-transition">
        Move to
      </label>
      <select
        id="asset-transition"
        value={next}
        onChange={(e) => setNext(e.target.value)}
        className={`${inputClass} cursor-pointer w-auto`}
      >
        <option value="">Choose…</option>
        {options.map((s) => (
          <option key={s} value={s}>
            {ASSET_STATUS_LABELS[s]}
          </option>
        ))}
      </select>
      <button
        type="submit"
        disabled={!next || busy}
        className="cursor-pointer rounded-md border border-border bg-card px-3 py-2 text-sm transition-colors hover:border-ring/40 disabled:cursor-not-allowed disabled:opacity-40"
      >
        Apply
      </button>
    </form>
  );
}

function AssignmentSection({
  asset,
  employees,
  onGo,
  busy,
}: {
  asset: AssetDetailData;
  employees: { id: string; name: string; employeeId: string }[];
  onGo: (fn: () => Promise<unknown>) => void;
  busy: boolean;
}) {
  const [employeeId, setEmployeeId] = useState('');
  const [note, setNote] = useState('');
  const active = asset.assignments.find((x) => x.status === 'active');

  return (
    <section className={card} aria-label="Custody">
      <h3 className="text-sm font-semibold">Custody</h3>
      {active ? (
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-sm">
          <span>
            With <strong>{active.employee.name}</strong> since {new Date(active.assignedAt).toLocaleDateString()}
            {!active.acknowledgedAt && <span className="ml-2 text-warning">· not acknowledged</span>}
          </span>
          <button
            type="button"
            disabled={busy}
            onClick={() => onGo(() => assetsApi.returnAssignment(active.id, 'Returned from detail page'))}
            className="cursor-pointer rounded-md border border-border bg-card px-3 py-1.5 transition-colors hover:border-ring/40 disabled:opacity-40"
          >
            Return asset
          </button>
        </div>
      ) : (
        <form
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            if (employeeId) onGo(() => assetsApi.assign(asset.id, { employeeId, note: note || undefined }));
          }}
          className="mt-3 flex flex-wrap items-end gap-2"
        >
          <label className="block flex-1 text-sm sm:max-w-xs">
            <span className="mb-1 block font-medium">Assign to</span>
            <select required value={employeeId} onChange={(e) => setEmployeeId(e.target.value)} className={`${inputClass} cursor-pointer`}>
              <option value="">Choose employee…</option>
              {employees.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name} ({e.employeeId})
                </option>
              ))}
            </select>
          </label>
          <label className="block flex-1 text-sm sm:max-w-xs">
            <span className="mb-1 block font-medium">Note</span>
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional" className={inputClass} />
          </label>
          <button
            type="submit"
            disabled={busy}
            className="cursor-pointer rounded-md bg-primary px-4 py-2 text-sm font-medium text-on-primary transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Assign
          </button>
        </form>
      )}
    </section>
  );
}

function HistoryTable({
  empty,
  rows,
}: {
  empty: string;
  rows: { key: string; main: React.ReactNode; sub: React.ReactNode; badge?: string; badgeClass?: string; extra?: React.ReactNode }[];
}) {
  if (rows.length === 0) return <p className="mt-2 text-sm text-muted-foreground">{empty}</p>;
  return (
    <ul className="mt-3 divide-y divide-border/60">
      {rows.map((r) => (
        <li key={r.key} className="flex items-start justify-between gap-3 py-2.5 text-sm">
          <div className="min-w-0">
            <p className="truncate font-medium">{r.main}</p>
            <p className="truncate text-xs text-muted-foreground">{r.sub}</p>
            {r.extra}
          </div>
          {r.badge && (
            <span className={`whitespace-nowrap rounded-full border px-2 py-0.5 text-xs ${r.badgeClass}`}>{r.badge}</span>
          )}
        </li>
      ))}
    </ul>
  );
}

function MaintenanceSection({
  asset,
  vendors,
  onGo,
  busy,
}: {
  asset: AssetDetailData;
  vendors: { id: string; name: string }[];
  onGo: (fn: () => Promise<unknown>) => void;
  busy: boolean;
}) {
  const [summary, setSummary] = useState('');
  const [type, setType] = useState('preventive');
  const [vendorId, setVendorId] = useState('');
  const [scheduleName, setScheduleName] = useState('');
  const [intervalDays, setIntervalDays] = useState('90');

  return (
    <section className={card} aria-label="Maintenance">
      <h3 className="text-sm font-semibold">Maintenance</h3>

      {asset.maintenanceSchedules.length > 0 && (
        <ul className="mt-3 space-y-2 text-sm">
          {asset.maintenanceSchedules.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border/60 p-2.5">
              <div>
                <p className="font-medium">{s.name}</p>
                <p className="text-xs text-muted-foreground">
                  Every {s.intervalDays} days · next due {new Date(s.nextDueAt).toLocaleDateString()}
                  {!s.active && ' · inactive'}
                </p>
              </div>
              {s.active && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => onGo(() => assetsApi.completeSchedule(s.id, { summary: `Completed: ${s.name}` }))}
                  className="cursor-pointer rounded-md border border-border bg-card px-3 py-1.5 text-xs transition-colors hover:border-ring/40 disabled:opacity-40"
                >
                  Mark done
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      <HistoryTable
        empty="No maintenance logged."
        rows={asset.maintenanceRecords.map((r) => ({
          key: r.id,
          main: `${r.type}: ${r.summary}`,
          sub: `${new Date(r.performedAt).toLocaleDateString()}${r.vendor ? ` · ${r.vendor.name}` : ''}${r.cost != null ? ` · $${r.cost.toFixed(2)}` : ''}`,
        }))}
      />

      <form
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          if (!summary) return;
          onGo(async () => {
            if (scheduleName && intervalDays) {
              await assetsApi.addSchedule(asset.id, { name: scheduleName, intervalDays: Number(intervalDays) });
            }
            await assetsApi.addMaintenanceRecord(asset.id, {
              type,
              summary,
              vendorId: vendorId || undefined,
            });
          });
        }}
        className="mt-3 grid gap-2 border-t border-border/60 pt-3 sm:grid-cols-4"
      >
        <select value={type} onChange={(e) => setType(e.target.value)} aria-label="Maintenance type" className={`${inputClass} cursor-pointer`}>
          <option value="preventive">Preventive</option>
          <option value="repair">Repair</option>
          <option value="inspection">Inspection</option>
          <option value="upgrade">Upgrade</option>
        </select>
        <input required value={summary} onChange={(e) => setSummary(e.target.value)} placeholder="What was done?" className={inputClass} />
        <select value={vendorId} onChange={(e) => setVendorId(e.target.value)} aria-label="Vendor" className={`${inputClass} cursor-pointer`}>
          <option value="">No vendor</option>
          {vendors.map((v) => (
            <option key={v.id} value={v.id}>
              {v.name}
            </option>
          ))}
        </select>
        <button
          type="submit"
          disabled={busy}
          className="cursor-pointer rounded-md border border-border bg-card px-3 py-2 text-sm transition-colors hover:border-ring/40 disabled:opacity-40"
        >
          Log work
        </button>
        <input value={scheduleName} onChange={(e) => setScheduleName(e.target.value)} placeholder="New schedule name (optional)" className={inputClass} />
        <input
          type="number"
          min="1"
          value={intervalDays}
          onChange={(e) => setIntervalDays(e.target.value)}
          aria-label="Schedule interval in days"
          className={inputClass}
        />
      </form>
    </section>
  );
}

function WarrantySection({
  asset,
  vendors,
  onGo,
  busy,
}: {
  asset: AssetDetailData;
  vendors: { id: string; name: string }[];
  onGo: (fn: () => Promise<unknown>) => void;
  busy: boolean;
}) {
  const [issue, setIssue] = useState('');
  const [vendorId, setVendorId] = useState('');

  return (
    <section className={card} aria-label="Warranty claims">
      <h3 className="text-sm font-semibold">Warranty claims</h3>
      <HistoryTable
        empty="No claims filed."
        rows={asset.warrantyClaims.map((c) => {
          const targets = CLAIM_TARGETS[c.status];
          return {
            key: c.id,
            main: c.issue,
            sub: `Filed ${new Date(c.createdAt).toLocaleDateString()}${c.resolution ? ` · ${c.resolution}` : ''}`,
            badge: c.status,
            badgeClass: '',
            extra: targets.length > 0 ? (
              <ClaimActions claimId={c.id} targets={targets} onGo={onGo} busy={busy} />
            ) : null,
          };
        })}
      />
      <form
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          if (!issue) return;
          onGo(() => assetsApi.addWarrantyClaim(asset.id, { issue, vendorId: vendorId || undefined }));
          setIssue('');
        }}
        className="mt-3 flex flex-wrap items-end gap-2 border-t border-border/60 pt-3"
      >
        <label className="block flex-1 text-sm">
          <span className="mb-1 block font-medium">File a claim</span>
          <input required value={issue} onChange={(e) => setIssue(e.target.value)} placeholder="Describe the fault" className={inputClass} />
        </label>
        <select value={vendorId} onChange={(e) => setVendorId(e.target.value)} aria-label="Vendor" className={`${inputClass} cursor-pointer w-auto`}>
          <option value="">No vendor</option>
          {vendors.map((v) => (
            <option key={v.id} value={v.id}>
              {v.name}
            </option>
          ))}
        </select>
        <button
          type="submit"
          disabled={busy}
          className="cursor-pointer rounded-md border border-border bg-card px-3 py-2 text-sm transition-colors hover:border-ring/40 disabled:opacity-40"
        >
          File claim
        </button>
      </form>
    </section>
  );
}

function ClaimActions({
  claimId,
  targets,
  onGo,
  busy,
}: {
  claimId: string;
  targets: WarrantyClaimStatus[];
  onGo: (fn: () => Promise<unknown>) => void;
  busy: boolean;
}) {
  return (
    <span className="flex gap-1">
      {targets.map((t) => (
        <button
          key={t}
          type="button"
          disabled={busy}
          onClick={() => {
            const resolution = t === 'resolved' ? window.prompt('Resolution note (required):') ?? undefined : undefined;
            if (t === 'resolved' && !resolution) return;
            onGo(() => assetsApi.updateWarrantyClaim(claimId, { status: t, resolution }));
          }}
          className="cursor-pointer rounded-md border border-border bg-card px-2 py-1 text-xs capitalize transition-colors hover:border-ring/40 disabled:opacity-40"
        >
          {t}
        </button>
      ))}
    </span>
  );
}
