import { useState } from 'react';
import type { FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { ActiveBadge, AdminHubTabs } from '@/components/AdminBadges';
import { SearchIcon } from '@/components/icons';
import { apiErrorMessage } from '@/lib/api';
import {
  type AssignmentGroup,
  type Department,
  type GroupInput,
  type Location,
  type OrgOptions,
  orgApi,
} from '@/lib/adminApi';

const inputClass =
  'w-full rounded-md border border-border bg-card px-3 py-2 text-sm transition-colors hover:border-ring/40 focus:border-ring';
const buttonPrimary =
  'cursor-pointer rounded-md bg-primary px-4 py-2 text-sm font-medium text-on-primary transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50';
const buttonGhost =
  'cursor-pointer rounded-md border border-border bg-card px-3 py-1.5 text-sm transition-colors hover:border-ring/40 disabled:cursor-not-allowed disabled:opacity-40';

const TABS = [
  { key: 'departments', label: 'Departments' },
  { key: 'locations', label: 'Locations' },
  { key: 'groups', label: 'Assignment groups' },
] as const;

type TabKey = (typeof TABS)[number]['key'];

export default function OrganizationPage() {
  const [params, setParams] = useSearchParams();
  const rawTab = params.get('tab');
  const tab: TabKey = TABS.some((t) => t.key === rawTab) ? (rawTab as TabKey) : 'departments';

  const optionsQuery = useQuery({ queryKey: ['org-options'], queryFn: orgApi.options });

  const setTab = (key: TabKey) => {
    const next = new URLSearchParams(params);
    next.set('tab', key);
    next.delete('q');
    next.delete('page');
    setParams(next);
  };

  return (
    <div>
      <div>
        <h1 className="text-2xl font-semibold">Organization</h1>
        <p className="text-sm text-muted-foreground">
          Departments, offices and the assignment groups tickets route through.
        </p>
      </div>

      <div className="mt-4">
        <AdminHubTabs />
      </div>

      <div className="mt-4 border-b border-border">
        <nav className="-mb-px flex gap-1 overflow-x-auto" aria-label="Organization sections">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              aria-current={tab === t.key ? 'page' : undefined}
              className={`cursor-pointer whitespace-nowrap border-b-2 px-3 py-2 text-sm transition-colors ${
                tab === t.key
                  ? 'border-primary font-medium text-primary'
                  : 'border-transparent text-muted-foreground hover:border-border hover:text-foreground'
              }`}
            >
              {t.label}
            </button>
          ))}
        </nav>
      </div>

      {optionsQuery.isError ? (
        <p role="alert" className="mt-4 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {apiErrorMessage(optionsQuery.error, 'Failed to load organization options')}
        </p>
      ) : tab === 'departments' ? (
        <DepartmentsTab options={optionsQuery.data} />
      ) : tab === 'locations' ? (
        <LocationsTab />
      ) : (
        <GroupsTab options={optionsQuery.data} />
      )}
    </div>
  );
}

/* ── Shared chrome ────────────────────────────────────────────────────────── */

function SectionHeader({
  title,
  count,
  actionLabel,
  expanded,
  onToggle,
}: {
  title: string;
  count: number | undefined;
  actionLabel: string;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
      <h2 className="text-sm font-semibold">
        {title}
        {count !== undefined && <span className="ml-2 font-normal text-muted-foreground">{count} total</span>}
      </h2>
      <button type="button" onClick={onToggle} aria-expanded={expanded} className={buttonPrimary}>
        {expanded ? 'Close form' : actionLabel}
      </button>
    </div>
  );
}

function TableShell({
  isLoading,
  isError,
  error,
  isEmpty,
  emptyText,
  children,
}: {
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  isEmpty: boolean;
  emptyText: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mt-3 overflow-x-auto rounded-xl border border-border bg-card">
      {isLoading ? (
        <div className="space-y-2 p-5">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-10 animate-pulse rounded-md bg-muted" />
          ))}
        </div>
      ) : isError ? (
        <p role="alert" className="p-5 text-sm text-destructive">
          {apiErrorMessage(error, 'Failed to load')}
        </p>
      ) : isEmpty ? (
        <p className="p-10 text-center text-sm text-muted-foreground">{emptyText}</p>
      ) : (
        children
      )}
    </div>
  );
}

function useListQuery<T>(key: string, fetcher: (params: { q?: string; page: number }) => Promise<{ data: T[]; page: number; pages: number; total: number }>) {
  const [params, setParams] = useSearchParams();
  const q = params.get('q') ?? '';
  const page = Number(params.get('page') ?? '1');
  const [draft, setDraft] = useState(q);

  const query = useQuery({ queryKey: [key, { q, page }], queryFn: () => fetcher({ q: q || undefined, page }) });

  const setParam = (k: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(k, value);
    else next.delete(k);
    if (k !== 'page') next.delete('page');
    setParams(next);
  };

  return { query, q, page, draft, setDraft, setParam };
}

function ListFilters({
  q,
  draft,
  setDraft,
  setParam,
  placeholder,
  label,
}: {
  q: string;
  draft: string;
  setDraft: (v: string) => void;
  setParam: (k: string, v: string) => void;
  placeholder: string;
  label: string;
}) {
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        setParam('q', draft.trim());
      }}
      className="relative ml-auto w-full max-w-xs"
    >
      <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground">
        <SearchIcon size={16} />
      </span>
      <input
        type="search"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder={placeholder}
        aria-label={label}
        className="w-full rounded-md border border-border bg-card py-1.5 pl-8 pr-3 text-sm transition-colors hover:border-ring/40 focus:border-ring"
      />
      {q && (
        <button
          type="button"
          onClick={() => {
            setDraft('');
            setParam('q', '');
          }}
          className="absolute right-2 top-1/2 -translate-y-1/2 cursor-pointer text-xs text-muted-foreground hover:text-foreground"
        >
          Clear
        </button>
      )}
    </form>
  );
}

function Pagination({
  meta,
  setParam,
  noun,
}: {
  meta: { page: number; pages: number; total: number } | undefined;
  setParam: (k: string, v: string) => void;
  noun: string;
}) {
  if (!meta || meta.pages <= 1) return null;
  return (
    <div className="mt-3 flex items-center justify-between text-sm text-muted-foreground">
      <span>
        Page {meta.page} of {meta.pages} · {meta.total} {noun}
      </span>
      <div className="flex gap-2">
        <button type="button" disabled={meta.page <= 1} onClick={() => setParam('page', String(meta.page - 1))} className={buttonGhost}>
          Previous
        </button>
        <button type="button" disabled={meta.page >= meta.pages} onClick={() => setParam('page', String(meta.page + 1))} className={buttonGhost}>
          Next
        </button>
      </div>
    </div>
  );
}

/* ── Departments ──────────────────────────────────────────────────────────── */

function DepartmentsTab({ options }: { options: OrgOptions | undefined }) {
  const queryClient = useQueryClient();
  const { query, q, draft, setDraft, setParam } = useListQuery<Department>('departments', (p) =>
    orgApi.departments.list(p),
  );
  const [showCreate, setShowCreate] = useState(false);
  const [editing, setEditing] = useState<Department | null>(null);

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['departments'] });
    void queryClient.invalidateQueries({ queryKey: ['org-options'] });
  };

  const rows = query.data?.data ?? [];

  return (
    <>
      <SectionHeader
        title="Departments"
        count={query.data?.total}
        actionLabel="New department"
        expanded={showCreate}
        onToggle={() => setShowCreate((v) => !v)}
      />

      {showCreate && (
        <DepartmentForm
          options={options}
          onCancel={() => setShowCreate(false)}
          onSaved={() => {
            invalidate();
            setShowCreate(false);
          }}
        />
      )}

      <div className="mt-3 flex items-center">
        <ListFilters q={q} draft={draft} setDraft={setDraft} setParam={setParam} placeholder="Search name or code…" label="Search departments" />
      </div>

      <TableShell
        isLoading={query.isLoading}
        isError={query.isError}
        error={query.error}
        isEmpty={rows.length === 0}
        emptyText="No departments yet."
      >
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
              <th className="px-4 py-3 font-medium">Name</th>
              <th className="px-4 py-3 font-medium">Code</th>
              <th className="hidden px-4 py-3 font-medium md:table-cell">Manager</th>
              <th className="hidden px-4 py-3 font-medium lg:table-cell">Office</th>
              <th className="hidden px-4 py-3 font-medium lg:table-cell">Support group</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((d) => (
              <tr key={d.id} className="border-b border-border/60 transition-colors last:border-0 hover:bg-muted/50">
                <td className="max-w-[14rem] truncate px-4 py-3 font-medium">{d.name}</td>
                <td className="px-4 py-3 font-mono text-xs">{d.code}</td>
                <td className="hidden max-w-[12rem] truncate px-4 py-3 text-muted-foreground md:table-cell">
                  {d.manager?.name ?? '—'}
                </td>
                <td className="hidden max-w-[12rem] truncate px-4 py-3 text-muted-foreground lg:table-cell">
                  {d.officeLocation?.name ?? '—'}
                </td>
                <td className="hidden max-w-[12rem] truncate px-4 py-3 text-muted-foreground lg:table-cell">
                  {d.supportGroup?.name ?? '—'}
                </td>
                <td className="px-4 py-3">
                  <ActiveBadge active={d.active} />
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-right">
                  <button type="button" onClick={() => setEditing(d)} className={buttonGhost}>
                    Edit
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableShell>

      <Pagination meta={query.data} setParam={setParam} noun="departments" />

      {editing && (
        <DepartmentEditDialog
          department={editing}
          options={options}
          onClose={() => setEditing(null)}
          onSaved={() => {
            invalidate();
            setEditing(null);
          }}
        />
      )}
    </>
  );
}

function DepartmentForm({
  options,
  onCancel,
  onSaved,
  department,
}: {
  options: OrgOptions | undefined;
  onCancel: () => void;
  onSaved: () => void;
  department?: Department;
}) {
  const [error, setError] = useState('');
  const [form, setForm] = useState({
    name: department?.name ?? '',
    code: department?.code ?? '',
    managerId: department?.manager?.id ?? '',
    officeLocationId: department?.officeLocation?.id ?? '',
    supportGroupId: department?.supportGroup?.id ?? '',
    timezone: department?.timezone ?? '',
    active: department?.active ?? true,
  });

  const save = useMutation({
    mutationFn: () =>
      department
        ? orgApi.departments.update(department.id, form)
        : orgApi.departments.create(form),
    onSuccess: onSaved,
    onError: (e) => setError(apiErrorMessage(e, 'Could not save the department')),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setError('');
    save.mutate();
  };

  return (
    <form
      onSubmit={submit}
      aria-label={department ? 'Edit department' : 'Create department'}
      className={department ? 'mt-4' : 'mt-4 rounded-xl border border-border bg-card p-5'}
    >
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <label className="block text-sm">
          <span className="mb-1 block font-medium">Name *</span>
          <input required minLength={2} maxLength={120} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={inputClass} />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-medium">Code *</span>
          <input
            required
            minLength={2}
            maxLength={20}
            value={form.code}
            onChange={(e) => setForm({ ...form, code: e.target.value })}
            aria-describedby="dept-code-hint"
            className={`${inputClass} font-mono uppercase`}
          />
          <span id="dept-code-hint" className="mt-1 block text-xs text-muted-foreground">
            2–20 characters, stored uppercase.
          </span>
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-medium">Manager</span>
          <select value={form.managerId} onChange={(e) => setForm({ ...form, managerId: e.target.value })} className={`${inputClass} cursor-pointer`}>
            <option value="">—</option>
            {options?.employees.map((emp) => (
              <option key={emp.id} value={emp.id}>
                {emp.name} ({emp.employeeId})
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-medium">Office location</span>
          <select value={form.officeLocationId} onChange={(e) => setForm({ ...form, officeLocationId: e.target.value })} className={`${inputClass} cursor-pointer`}>
            <option value="">—</option>
            {options?.locations.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name} ({l.code})
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-medium">Support group</span>
          <select value={form.supportGroupId} onChange={(e) => setForm({ ...form, supportGroupId: e.target.value })} className={`${inputClass} cursor-pointer`}>
            <option value="">—</option>
            {options?.supportGroups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name} ({g.code})
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-medium">Timezone</span>
          <input maxLength={60} value={form.timezone} onChange={(e) => setForm({ ...form, timezone: e.target.value })} placeholder="UTC" className={inputClass} />
        </label>
        <label className="flex cursor-pointer items-center gap-2 text-sm">
          <input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} className="cursor-pointer" />
          Active
        </label>
      </div>
      {error && (
        <p role="alert" className="mt-3 text-sm text-destructive">
          {error}
        </p>
      )}
      <div className="mt-4 flex gap-2">
        <button type="submit" disabled={save.isPending} className={buttonPrimary}>
          {save.isPending ? 'Saving…' : department ? 'Save changes' : 'Create department'}
        </button>
        <button type="button" onClick={onCancel} className={buttonGhost}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function DepartmentEditDialog({
  department,
  options,
  onClose,
  onSaved,
}: {
  department: Department;
  options: OrgOptions | undefined;
  onClose: () => void;
  onSaved: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={`Edit ${department.name}`}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose();
      }}
    >
      <div className="max-h-[85vh] w-full max-w-3xl overflow-y-auto rounded-xl border border-border bg-card p-5">
        <h3 className="text-base font-semibold">Edit {department.name}</h3>
        <DepartmentForm options={options} onCancel={onClose} onSaved={onSaved} department={department} />
      </div>
    </div>
  );
}

/* ── Locations ────────────────────────────────────────────────────────────── */

function LocationsTab() {
  const queryClient = useQueryClient();
  const { query, q, draft, setDraft, setParam } = useListQuery<Location>('locations', (p) => orgApi.locations.list(p));
  const [showCreate, setShowCreate] = useState(false);
  const [editing, setEditing] = useState<Location | null>(null);

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['locations'] });
    void queryClient.invalidateQueries({ queryKey: ['org-options'] });
  };

  const rows = query.data?.data ?? [];

  return (
    <>
      <SectionHeader
        title="Locations"
        count={query.data?.total}
        actionLabel="New location"
        expanded={showCreate}
        onToggle={() => setShowCreate((v) => !v)}
      />

      {showCreate && (
        <LocationForm
          onCancel={() => setShowCreate(false)}
          onSaved={() => {
            invalidate();
            setShowCreate(false);
          }}
        />
      )}

      <div className="mt-3 flex items-center">
        <ListFilters q={q} draft={draft} setDraft={setDraft} setParam={setParam} placeholder="Search name or code…" label="Search locations" />
      </div>

      <TableShell
        isLoading={query.isLoading}
        isError={query.isError}
        error={query.error}
        isEmpty={rows.length === 0}
        emptyText="No locations yet."
      >
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
              <th className="px-4 py-3 font-medium">Name</th>
              <th className="px-4 py-3 font-medium">Code</th>
              <th className="hidden px-4 py-3 font-medium md:table-cell">Address</th>
              <th className="hidden px-4 py-3 font-medium lg:table-cell">Timezone</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((l) => (
              <tr key={l.id} className="border-b border-border/60 transition-colors last:border-0 hover:bg-muted/50">
                <td className="max-w-[14rem] truncate px-4 py-3 font-medium">{l.name}</td>
                <td className="px-4 py-3 font-mono text-xs">{l.code}</td>
                <td className="hidden max-w-[18rem] truncate px-4 py-3 text-muted-foreground md:table-cell">{l.address ?? '—'}</td>
                <td className="hidden px-4 py-3 text-muted-foreground lg:table-cell">{l.timezone}</td>
                <td className="px-4 py-3">
                  <ActiveBadge active={l.active} />
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-right">
                  <button type="button" onClick={() => setEditing(l)} className={buttonGhost}>
                    Edit
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableShell>

      <Pagination meta={query.data} setParam={setParam} noun="locations" />

      {editing && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          role="dialog"
          aria-modal="true"
          aria-label={`Edit ${editing.name}`}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setEditing(null);
          }}
        >
          <div className="max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-xl border border-border bg-card p-5">
            <h3 className="text-base font-semibold">Edit {editing.name}</h3>
            <LocationForm
              location={editing}
              onCancel={() => setEditing(null)}
              onSaved={() => {
                invalidate();
                setEditing(null);
              }}
            />
          </div>
        </div>
      )}
    </>
  );
}

function LocationForm({
  location,
  onCancel,
  onSaved,
}: {
  location?: Location;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const [error, setError] = useState('');
  const [form, setForm] = useState({
    name: location?.name ?? '',
    code: location?.code ?? '',
    address: location?.address ?? '',
    timezone: location?.timezone ?? '',
    active: location?.active ?? true,
  });

  const save = useMutation({
    mutationFn: () =>
      location ? orgApi.locations.update(location.id, form) : orgApi.locations.create(form),
    onSuccess: onSaved,
    onError: (e) => setError(apiErrorMessage(e, 'Could not save the location')),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setError('');
    save.mutate();
  };

  return (
    <form
      onSubmit={submit}
      aria-label={location ? 'Edit location' : 'Create location'}
      className={location ? 'mt-4' : 'mt-4 rounded-xl border border-border bg-card p-5'}
    >
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <label className="block text-sm">
          <span className="mb-1 block font-medium">Name *</span>
          <input required minLength={2} maxLength={120} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={inputClass} />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-medium">Code *</span>
          <input required minLength={2} maxLength={20} value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} className={`${inputClass} font-mono uppercase`} />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-medium">Timezone</span>
          <input maxLength={60} value={form.timezone} onChange={(e) => setForm({ ...form, timezone: e.target.value })} placeholder="UTC" className={inputClass} />
        </label>
        <label className="block text-sm sm:col-span-2">
          <span className="mb-1 block font-medium">Address</span>
          <input maxLength={300} value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} className={inputClass} />
        </label>
        <label className="flex cursor-pointer items-center gap-2 text-sm">
          <input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} className="cursor-pointer" />
          Active
        </label>
      </div>
      {error && (
        <p role="alert" className="mt-3 text-sm text-destructive">
          {error}
        </p>
      )}
      <div className="mt-4 flex gap-2">
        <button type="submit" disabled={save.isPending} className={buttonPrimary}>
          {save.isPending ? 'Saving…' : location ? 'Save changes' : 'Create location'}
        </button>
        <button type="button" onClick={onCancel} className={buttonGhost}>
          Cancel
        </button>
      </div>
    </form>
  );
}

/* ── Assignment groups ────────────────────────────────────────────────────── */

function GroupsTab({ options }: { options: OrgOptions | undefined }) {
  const queryClient = useQueryClient();
  const { query, q, draft, setDraft, setParam } = useListQuery<AssignmentGroup>('groups', (p) => orgApi.groups.list(p));
  const [showCreate, setShowCreate] = useState(false);
  const [editing, setEditing] = useState<AssignmentGroup | null>(null);

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['groups'] });
    void queryClient.invalidateQueries({ queryKey: ['org-options'] });
  };

  const rows = query.data?.data ?? [];

  return (
    <>
      <SectionHeader
        title="Assignment groups"
        count={query.data?.total}
        actionLabel="New group"
        expanded={showCreate}
        onToggle={() => setShowCreate((v) => !v)}
      />

      {showCreate && (
        <GroupForm
          options={options}
          onCancel={() => setShowCreate(false)}
          onSaved={() => {
            invalidate();
            setShowCreate(false);
          }}
        />
      )}

      <div className="mt-3 flex items-center">
        <ListFilters q={q} draft={draft} setDraft={setDraft} setParam={setParam} placeholder="Search name or code…" label="Search groups" />
      </div>

      <TableShell
        isLoading={query.isLoading}
        isError={query.isError}
        error={query.error}
        isEmpty={rows.length === 0}
        emptyText="No assignment groups yet."
      >
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
              <th className="px-4 py-3 font-medium">Name</th>
              <th className="px-4 py-3 font-medium">Code</th>
              <th className="hidden px-4 py-3 font-medium md:table-cell">Manager</th>
              <th className="px-4 py-3 font-medium">Members</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((g) => (
              <tr key={g.id} className="border-b border-border/60 transition-colors last:border-0 hover:bg-muted/50">
                <td className="max-w-[14rem] px-4 py-3">
                  <span className="block truncate font-medium">{g.name}</span>
                  {g.description && <span className="block truncate text-xs text-muted-foreground">{g.description}</span>}
                </td>
                <td className="px-4 py-3 font-mono text-xs">{g.code}</td>
                <td className="hidden max-w-[12rem] truncate px-4 py-3 text-muted-foreground md:table-cell">
                  {g.manager?.name ?? '—'}
                </td>
                <td className="px-4 py-3">
                  {g.members.length === 0 ? (
                    <span className="text-muted-foreground">None</span>
                  ) : (
                    <span
                      className="inline-flex items-center gap-1"
                      title={g.members.map((m) => m.user.name).join(', ')}
                    >
                      <span className="rounded-full border border-border px-2 py-0.5 text-xs">{g.members.length}</span>
                      <span className="hidden max-w-[14rem] truncate text-xs text-muted-foreground lg:inline">
                        {g.members.map((m) => m.user.name).join(', ')}
                      </span>
                    </span>
                  )}
                </td>
                <td className="px-4 py-3">
                  <ActiveBadge active={g.active} />
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-right">
                  <button type="button" onClick={() => setEditing(g)} className={buttonGhost}>
                    Edit
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableShell>

      <Pagination meta={query.data} setParam={setParam} noun="groups" />

      {editing && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          role="dialog"
          aria-modal="true"
          aria-label={`Edit ${editing.name}`}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setEditing(null);
          }}
        >
          <div className="max-h-[85vh] w-full max-w-3xl overflow-y-auto rounded-xl border border-border bg-card p-5">
            <h3 className="text-base font-semibold">Edit {editing.name}</h3>
            <GroupForm
              group={editing}
              options={options}
              onCancel={() => setEditing(null)}
              onSaved={() => {
                invalidate();
                setEditing(null);
              }}
            />
          </div>
        </div>
      )}
    </>
  );
}

function GroupForm({
  group,
  options,
  onCancel,
  onSaved,
}: {
  group?: AssignmentGroup;
  options: OrgOptions | undefined;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const [error, setError] = useState('');
  const [form, setForm] = useState({
    name: group?.name ?? '',
    code: group?.code ?? '',
    description: group?.description ?? '',
    managerId: group?.manager?.id ?? '',
    memberIds: group?.members.map((m) => m.user.id) ?? [],
    active: group?.active ?? true,
  });

  const save = useMutation({
    mutationFn: () => {
      const payload: Partial<GroupInput> = {
        name: form.name,
        description: form.description,
        managerId: form.managerId,
        memberIds: form.memberIds,
        active: form.active,
      };
      // The API only accepts a code at creation time; the update path ignores it.
      return group ? orgApi.groups.update(group.id, payload) : orgApi.groups.create({ ...payload, code: form.code } as GroupInput);
    },
    onSuccess: onSaved,
    onError: (e) => setError(apiErrorMessage(e, 'Could not save the group')),
  });

  const toggleMember = (userId: string) =>
    setForm((f) => ({
      ...f,
      memberIds: f.memberIds.includes(userId) ? f.memberIds.filter((id) => id !== userId) : [...f.memberIds, userId],
    }));

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setError('');
    save.mutate();
  };

  const users = options?.users ?? [];

  return (
    <form
      onSubmit={submit}
      aria-label={group ? 'Edit group' : 'Create group'}
      className={group ? 'mt-4' : 'mt-4 rounded-xl border border-border bg-card p-5'}
    >
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <label className="block text-sm">
          <span className="mb-1 block font-medium">Name *</span>
          <input required minLength={2} maxLength={120} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={inputClass} />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-medium">Code *</span>
          <input
            required
            minLength={2}
            maxLength={20}
            value={form.code}
            disabled={!!group}
            onChange={(e) => setForm({ ...form, code: e.target.value })}
            className={`${inputClass} font-mono uppercase disabled:cursor-not-allowed disabled:opacity-60`}
          />
          {group && <span className="mt-1 block text-xs text-muted-foreground">The code is fixed once the group exists.</span>}
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-medium">Manager</span>
          <select value={form.managerId} onChange={(e) => setForm({ ...form, managerId: e.target.value })} className={`${inputClass} cursor-pointer`}>
            <option value="">—</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name} ({u.email})
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm sm:col-span-2 lg:col-span-3">
          <span className="mb-1 block font-medium">Description</span>
          <input maxLength={500} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className={inputClass} />
        </label>
        <label className="flex cursor-pointer items-center gap-2 text-sm">
          <input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} className="cursor-pointer" />
          Active
        </label>
      </div>

      <fieldset className="mt-4">
        <legend className="mb-1 text-sm font-medium">
          Members <span className="font-normal text-muted-foreground">({form.memberIds.length} selected)</span>
        </legend>
        <div className="max-h-52 overflow-y-auto rounded-md border border-border p-2">
          {users.length === 0 ? (
            <p className="p-2 text-sm text-muted-foreground">No users available.</p>
          ) : (
            <div className="grid gap-1 sm:grid-cols-2">
              {users.map((u) => (
                <label key={u.id} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-sm transition-colors hover:bg-muted/50">
                  <input type="checkbox" checked={form.memberIds.includes(u.id)} onChange={() => toggleMember(u.id)} className="cursor-pointer" />
                  <span className="truncate">{u.name}</span>
                  <span className="truncate text-xs text-muted-foreground">{u.email}</span>
                </label>
              ))}
            </div>
          )}
        </div>
      </fieldset>

      {error && (
        <p role="alert" className="mt-3 text-sm text-destructive">
          {error}
        </p>
      )}
      <div className="mt-4 flex gap-2">
        <button type="submit" disabled={save.isPending} className={buttonPrimary}>
          {save.isPending ? 'Saving…' : group ? 'Save changes' : 'Create group'}
        </button>
        <button type="button" onClick={onCancel} className={buttonGhost}>
          Cancel
        </button>
      </div>
    </form>
  );
}
