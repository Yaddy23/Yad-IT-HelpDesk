import { useState } from 'react';
import type { FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { ActiveBadge, AdminHubTabs, formatWhen, RoleBadge } from '@/components/AdminBadges';
import { SearchIcon } from '@/components/icons';
import { useAuth } from '@/lib/auth';
import { apiErrorMessage } from '@/lib/api';
import { ROLE_LABELS, ROLES, type AdminUser, type Role, type UserOptions, usersApi } from '@/lib/adminApi';

const inputClass =
  'w-full rounded-md border border-border bg-card px-3 py-2 text-sm transition-colors hover:border-ring/40 focus:border-ring';
const buttonPrimary =
  'cursor-pointer rounded-md bg-primary px-4 py-2 text-sm font-medium text-on-primary transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50';
const buttonGhost =
  'cursor-pointer rounded-md border border-border bg-card px-3 py-1.5 text-sm transition-colors hover:border-ring/40 disabled:cursor-not-allowed disabled:opacity-40';

export default function UsersPage() {
  const { user: currentUser } = useAuth();
  const [params, setParams] = useSearchParams();
  const role = params.get('role') ?? '';
  const q = params.get('q') ?? '';
  const page = Number(params.get('page') ?? '1');

  const [searchDraft, setSearchDraft] = useState(q);
  const [showCreate, setShowCreate] = useState(false);
  const [editing, setEditing] = useState<AdminUser | null>(null);
  const [resetting, setResetting] = useState<AdminUser | null>(null);
  const [notice, setNotice] = useState('');
  const [rowError, setRowError] = useState('');

  const queryClient = useQueryClient();

  const usersQuery = useQuery({
    queryKey: ['admin-users', { role, q, page }],
    queryFn: () => usersApi.list({ role: role || undefined, q: q || undefined, page }),
  });
  const optionsQuery = useQuery({ queryKey: ['user-options'], queryFn: usersApi.options });

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

  const toggleActive = useMutation({
    mutationFn: (target: AdminUser) => usersApi.update(target.id, { active: !target.active }),
    onSuccess: (updated) => {
      setRowError('');
      setNotice(`${updated.name} is now ${updated.active ? 'active' : 'deactivated'}.`);
      void queryClient.invalidateQueries({ queryKey: ['admin-users'] });
    },
    onError: (e) => setRowError(apiErrorMessage(e, 'Could not update the account')),
  });

  const meta = usersQuery.data;
  const rows = usersQuery.data?.data ?? [];

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Users</h1>
          <p className="text-sm text-muted-foreground">
            {meta ? `${meta.total} ${meta.total === 1 ? 'account' : 'accounts'} · roles drive every permission` : 'Loading…'}
          </p>
        </div>
        <button type="button" onClick={() => setShowCreate((v) => !v)} aria-expanded={showCreate} className={buttonPrimary}>
          {showCreate ? 'Close form' : 'New user'}
        </button>
      </div>

      <div className="mt-4">
        <AdminHubTabs />
      </div>

      {notice && (
        <p role="status" className="mt-4 rounded-md border border-accent/40 bg-accent/10 px-3 py-2 text-sm text-accent">
          {notice}
        </p>
      )}
      {rowError && (
        <p role="alert" className="mt-4 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {rowError}
        </p>
      )}

      {showCreate && (
        <CreateUserForm
          options={optionsQuery.data}
          onDone={() => {
            setShowCreate(false);
            setNotice('User created.');
          }}
        />
      )}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <select
          value={role}
          onChange={(e) => setParam('role', e.target.value)}
          aria-label="Filter by role"
          className="cursor-pointer rounded-md border border-border bg-card px-3 py-1.5 text-sm transition-colors hover:border-ring/40 focus:border-ring"
        >
          <option value="">All roles</option>
          {ROLES.map((r) => (
            <option key={r} value={r}>
              {ROLE_LABELS[r]}
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
            placeholder="Search name or email…"
            aria-label="Search users"
            className="w-full rounded-md border border-border bg-card py-1.5 pl-8 pr-3 text-sm transition-colors hover:border-ring/40 focus:border-ring"
          />
        </form>
      </div>

      <div className="mt-4 overflow-x-auto rounded-xl border border-border bg-card">
        {usersQuery.isLoading ? (
          <div className="space-y-2 p-5">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="h-10 animate-pulse rounded-md bg-muted" />
            ))}
          </div>
        ) : usersQuery.isError ? (
          <p role="alert" className="p-5 text-sm text-destructive">
            {apiErrorMessage(usersQuery.error, 'Failed to load users')}
          </p>
        ) : rows.length === 0 ? (
          <p className="p-10 text-center text-sm text-muted-foreground">No accounts match this view.</p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
                <th className="p-3 font-medium">Name</th>
                <th className="p-3 font-medium">Email</th>
                <th className="hidden p-3 font-medium md:table-cell">Employee</th>
                <th className="p-3 font-medium">Roles</th>
                <th className="p-3 font-medium">Status</th>
                {/* Last login is the least critical column: it yields to the action buttons until there is room. */}
                <th className="hidden p-3 font-medium xl:table-cell">Last login</th>
                <th className="p-3 font-medium">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((u) => {
                const isSelf = u.id === currentUser?.id;
                return (
                  <tr key={u.id} className="border-b border-border/60 transition-colors last:border-0 hover:bg-muted/50">
                    <td className="max-w-[14rem] p-3">
                      <span className="block truncate font-medium">{u.name}</span>
                      {u.employee?.jobTitle && (
                        <span className="block truncate text-xs text-muted-foreground">{u.employee.jobTitle}</span>
                      )}
                    </td>
                    <td className="max-w-[16rem] truncate p-3 text-muted-foreground">{u.email}</td>
                    <td className="hidden whitespace-nowrap p-3 font-mono text-xs text-muted-foreground md:table-cell">
                      {u.employee?.employeeId ?? '—'}
                    </td>
                    <td className="p-3">
                      <span className="flex flex-wrap gap-1">
                        {u.roles.map((r) => (
                          <RoleBadge key={r} role={r} />
                        ))}
                      </span>
                    </td>
                    <td className="p-3">
                      <ActiveBadge active={u.active} />
                    </td>
                    <td className="hidden whitespace-nowrap p-3 text-muted-foreground xl:table-cell">
                      <span title={u.lastLoginAt ?? undefined}>{formatWhen(u.lastLoginAt)}</span>
                    </td>
                    <td className="whitespace-nowrap p-3">
                      <div className="flex justify-end gap-2">
                        <button type="button" onClick={() => setEditing(u)} className={buttonGhost}>
                          Edit
                        </button>
                        <button type="button" onClick={() => setResetting(u)} className={buttonGhost}>
                          Reset password
                        </button>
                        <button
                          type="button"
                          onClick={() => toggleActive.mutate(u)}
                          disabled={isSelf || (toggleActive.isPending && toggleActive.variables?.id === u.id)}
                          title={isSelf ? 'You cannot deactivate your own account' : undefined}
                          className={`${buttonGhost} ${u.active && !isSelf ? 'hover:border-destructive/40 hover:text-destructive' : ''}`}
                        >
                          {u.active ? 'Deactivate' : 'Reactivate'}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {meta && meta.pages > 1 && (
        <div className="mt-4 flex items-center justify-between text-sm text-muted-foreground">
          <span>
            Page {meta.page} of {meta.pages} · {meta.total} accounts
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
      )}

      {editing && (
        <EditUserDialog
          user={editing}
          options={optionsQuery.data}
          isSelf={editing.id === currentUser?.id}
          onClose={() => setEditing(null)}
          onSaved={(name) => {
            setEditing(null);
            setNotice(`${name} updated.`);
          }}
        />
      )}

      {resetting && (
        <ResetPasswordDialog
          user={resetting}
          onClose={() => setResetting(null)}
          onDone={(name) => {
            setResetting(null);
            setNotice(`Password reset for ${name} — their other sessions were revoked.`);
          }}
        />
      )}
    </div>
  );
}

/* ── Shared form pieces ───────────────────────────────────────────────────── */

function RolePicker({ value, onChange }: { value: Role[]; onChange: (roles: Role[]) => void }) {
  const toggle = (role: Role) =>
    onChange(value.includes(role) ? value.filter((r) => r !== role) : [...value, role]);

  return (
    <fieldset className="sm:col-span-2 lg:col-span-4">
      <legend className="mb-1 text-sm font-medium">Roles *</legend>
      <div className="flex flex-wrap gap-x-4 gap-y-2">
        {ROLES.map((r) => (
          <label key={r} className="flex cursor-pointer items-center gap-1.5 text-sm">
            <input type="checkbox" checked={value.includes(r)} onChange={() => toggle(r)} className="cursor-pointer" />
            {ROLE_LABELS[r]}
          </label>
        ))}
      </div>
      {value.length === 0 && <p className="mt-1 text-xs text-destructive">Pick at least one role.</p>}
    </fieldset>
  );
}

function OrgSelects({
  form,
  setForm,
  options,
  excludeEmployeeId,
}: {
  form: { departmentId: string; locationId: string; managerEmployeeId: string };
  setForm: (patch: Partial<{ departmentId: string; locationId: string; managerEmployeeId: string }>) => void;
  options: UserOptions | undefined;
  /** The account being edited — nobody reports to themselves, so it is not offered. */
  excludeEmployeeId?: string;
}) {
  return (
    <>
      <label className="block text-sm">
        <span className="mb-1 block font-medium">Department</span>
        <select
          value={form.departmentId}
          onChange={(e) => setForm({ departmentId: e.target.value })}
          className={`${inputClass} cursor-pointer`}
        >
          <option value="">—</option>
          {options?.departments.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name} ({d.code})
            </option>
          ))}
        </select>
      </label>
      <label className="block text-sm">
        <span className="mb-1 block font-medium">Location</span>
        <select
          value={form.locationId}
          onChange={(e) => setForm({ locationId: e.target.value })}
          className={`${inputClass} cursor-pointer`}
        >
          <option value="">—</option>
          {options?.locations.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name} ({l.code})
            </option>
          ))}
        </select>
      </label>
      <label className="block text-sm">
        <span className="mb-1 block font-medium">Manager</span>
        <select
          value={form.managerEmployeeId}
          onChange={(e) => setForm({ managerEmployeeId: e.target.value })}
          className={`${inputClass} cursor-pointer`}
        >
          <option value="">—</option>
          {options?.employees
            .filter((e) => e.id !== excludeEmployeeId)
            .map((e) => (
              <option key={e.id} value={e.id}>
                {e.name} ({e.employeeId})
              </option>
            ))}
        </select>
      </label>
    </>
  );
}

/* ── Create ───────────────────────────────────────────────────────────────── */

function CreateUserForm({ options, onDone }: { options: UserOptions | undefined; onDone: () => void }) {
  const queryClient = useQueryClient();
  const [error, setError] = useState('');
  const [form, setForm] = useState({
    email: '',
    name: '',
    password: '',
    roles: ['employee'] as Role[],
    jobTitle: '',
    departmentId: '',
    locationId: '',
    managerEmployeeId: '',
  });

  const create = useMutation({
    mutationFn: () =>
      usersApi.create({
        email: form.email,
        name: form.name,
        password: form.password,
        roles: form.roles,
        jobTitle: form.jobTitle || undefined,
        departmentId: form.departmentId || undefined,
        locationId: form.locationId || undefined,
        managerEmployeeId: form.managerEmployeeId || undefined,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin-users'] });
      void queryClient.invalidateQueries({ queryKey: ['user-options'] });
      onDone();
    },
    onError: (e) => setError(apiErrorMessage(e, 'Could not create user')),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setError('');
    if (form.roles.length === 0) {
      setError('Pick at least one role.');
      return;
    }
    create.mutate();
  };

  return (
    <form onSubmit={submit} className="mt-4 rounded-xl border border-border bg-card p-5" aria-label="Create user">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <label className="block text-sm">
          <span className="mb-1 block font-medium">Full name *</span>
          <input required minLength={2} maxLength={120} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={inputClass} />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-medium">Email *</span>
          <input required type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className={inputClass} />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-medium">Temporary password *</span>
          <input
            required
            type="password"
            minLength={10}
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
            aria-describedby="password-hint"
            className={inputClass}
          />
          <span id="password-hint" className="mt-1 block text-xs text-muted-foreground">
            At least 10 characters.
          </span>
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-medium">Job title</span>
          <input maxLength={120} value={form.jobTitle} onChange={(e) => setForm({ ...form, jobTitle: e.target.value })} className={inputClass} />
        </label>
        <OrgSelects form={form} setForm={(patch) => setForm({ ...form, ...patch })} options={options} />
        <RolePicker value={form.roles} onChange={(roles) => setForm({ ...form, roles })} />
      </div>
      {error && (
        <p role="alert" className="mt-3 text-sm text-destructive">
          {error}
        </p>
      )}
      <div className="mt-4 flex gap-2">
        <button type="submit" disabled={create.isPending} className={buttonPrimary}>
          {create.isPending ? 'Creating…' : 'Create user'}
        </button>
        <button type="button" onClick={onDone} className={buttonGhost}>
          Cancel
        </button>
      </div>
    </form>
  );
}

/* ── Edit ─────────────────────────────────────────────────────────────────── */

function EditUserDialog({
  user,
  options,
  isSelf,
  onClose,
  onSaved,
}: {
  user: AdminUser;
  options: UserOptions | undefined;
  isSelf: boolean;
  onClose: () => void;
  onSaved: (name: string) => void;
}) {
  const queryClient = useQueryClient();
  const [error, setError] = useState('');
  const [form, setForm] = useState({
    name: user.name,
    roles: user.roles,
    jobTitle: user.employee?.jobTitle ?? '',
    departmentId: user.employee?.departmentId ?? '',
    locationId: user.employee?.locationId ?? '',
    managerEmployeeId: user.employee?.managerId ?? '',
    active: user.active,
  });

  const save = useMutation({
    mutationFn: () =>
      usersApi.update(user.id, {
        name: form.name,
        roles: form.roles,
        jobTitle: form.jobTitle,
        departmentId: form.departmentId,
        locationId: form.locationId,
        managerEmployeeId: form.managerEmployeeId,
        active: form.active,
      }),
    onSuccess: (updated) => {
      void queryClient.invalidateQueries({ queryKey: ['admin-users'] });
      onSaved(updated.name);
    },
    onError: (e) => setError(apiErrorMessage(e, 'Could not save the account')),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setError('');
    if (form.roles.length === 0) {
      setError('Pick at least one role.');
      return;
    }
    save.mutate();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={`Edit ${user.name}`}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose();
      }}
    >
      <form onSubmit={submit} className="max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-xl border border-border bg-card p-5">
        <h3 className="text-base font-semibold">Edit {user.name}</h3>
        <p className="mt-1 text-sm text-muted-foreground">{user.email}</p>

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <label className="block text-sm">
            <span className="mb-1 block font-medium">Full name *</span>
            <input required minLength={2} maxLength={120} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={inputClass} />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block font-medium">Job title</span>
            <input maxLength={120} value={form.jobTitle} onChange={(e) => setForm({ ...form, jobTitle: e.target.value })} className={inputClass} />
          </label>
          <OrgSelects
            form={form}
            setForm={(patch) => setForm({ ...form, ...patch })}
            options={options}
            excludeEmployeeId={user.employee?.id}
          />
          <div className="sm:col-span-2">
            <RolePicker value={form.roles} onChange={(roles) => setForm({ ...form, roles })} />
          </div>
          <label className="flex cursor-pointer items-center gap-2 text-sm sm:col-span-2">
            <input
              type="checkbox"
              checked={form.active}
              disabled={isSelf}
              onChange={(e) => setForm({ ...form, active: e.target.checked })}
              className="cursor-pointer disabled:cursor-not-allowed"
            />
            Account active
            {isSelf && <span className="text-xs text-muted-foreground">— you cannot deactivate your own account</span>}
          </label>
        </div>

        {error && (
          <p role="alert" className="mt-3 text-sm text-destructive">
            {error}
          </p>
        )}
        <div className="mt-4 flex gap-2">
          <button type="submit" disabled={save.isPending} className={buttonPrimary}>
            {save.isPending ? 'Saving…' : 'Save changes'}
          </button>
          <button type="button" onClick={onClose} className={buttonGhost}>
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}

/* ── Reset password ───────────────────────────────────────────────────────── */

function ResetPasswordDialog({
  user,
  onClose,
  onDone,
}: {
  user: AdminUser;
  onClose: () => void;
  onDone: (name: string) => void;
}) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');

  const reset = useMutation({
    mutationFn: () => usersApi.resetPassword(user.id, password),
    onSuccess: () => onDone(user.name),
    onError: (e) => setError(apiErrorMessage(e, 'Could not reset the password')),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setError('');
    if (password !== confirm) {
      setError('The two passwords do not match.');
      return;
    }
    reset.mutate();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={`Reset password for ${user.name}`}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose();
      }}
    >
      <form onSubmit={submit} className="w-full max-w-md rounded-xl border border-border bg-card p-5">
        <h3 className="text-base font-semibold">Reset password</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Setting a new password for {user.name} signs them out everywhere.
        </p>

        <label className="mt-4 block text-sm">
          <span className="mb-1 block font-medium">New password *</span>
          <input
            required
            type="password"
            minLength={10}
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
              setError('');
            }}
            aria-describedby="reset-password-hint"
            className={inputClass}
          />
          <span id="reset-password-hint" className="mt-1 block text-xs text-muted-foreground">
            At least 10 characters.
          </span>
        </label>
        <label className="mt-3 block text-sm">
          <span className="mb-1 block font-medium">Confirm password *</span>
          <input
            required
            type="password"
            value={confirm}
            onChange={(e) => {
              setConfirm(e.target.value);
              setError('');
            }}
            className={inputClass}
          />
        </label>

        {error && (
          <p role="alert" className="mt-3 text-sm text-destructive">
            {error}
          </p>
        )}
        <div className="mt-4 flex gap-2">
          <button type="submit" disabled={reset.isPending} className={buttonPrimary}>
            {reset.isPending ? 'Resetting…' : 'Reset password'}
          </button>
          <button type="button" onClick={onClose} className={buttonGhost}>
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}
