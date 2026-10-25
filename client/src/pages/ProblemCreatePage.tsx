import { useState } from 'react';
import type { FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';

import { apiErrorMessage } from '@/lib/api';
import { problemApi, type CreateProblemInput, type ProblemPriority, type RCAType } from '@/lib/problemApi';
import { usersApi } from '@/lib/adminApi';

const PRIORITIES: { value: ProblemPriority; label: string }[] = [
  { value: 'LOW', label: 'Low' },
  { value: 'MEDIUM', label: 'Medium' },
  { value: 'HIGH', label: 'High' },
  { value: 'CRITICAL', label: 'Critical' },
];

const RCA_TYPES: { value: RCAType; label: string }[] = [
  { value: 'NONE', label: 'None' },
  { value: 'FIVE_WHYS', label: '5 Whys' },
  { value: 'FISHBONE', label: 'Fishbone' },
];

export default function ProblemCreatePage() {
  const navigate = useNavigate();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [ownerId, setOwnerId] = useState('');
  const [priority, setPriority] = useState<ProblemPriority>('MEDIUM');
  const [affectedServices, setAffectedServices] = useState('');
  const [affectedAssets, setAffectedAssets] = useState('');
  const [affectedCIs, setAffectedCIs] = useState('');
  const [businessImpact, setBusinessImpact] = useState('');
  const [rcaType, setRcaType] = useState<RCAType>('NONE');
  const [error, setError] = useState<string | null>(null);

  const { data: usersData } = useQuery({
    queryKey: ['user-options'],
    queryFn: () => usersApi.options(),
    select: (data) => data.employees,
  });
  const create = useMutation({
    mutationFn: problemApi.create,
    onSuccess: (problem) => {
      navigate(`/problems/${problem.id}`);
    },
  });

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    setError(null);

    const input: CreateProblemInput = {
      title: title.trim(),
      description: description.trim(),
      ownerId,
      priority,
      affectedServices: affectedServices.split(',').map((s) => s.trim()).filter(Boolean),
      affectedAssets: affectedAssets.split(',').map((s) => s.trim()).filter(Boolean),
      affectedCIs: affectedCIs.split(',').map((s) => s.trim()).filter(Boolean),
      businessImpact: businessImpact.trim() || undefined,
      rcaType,
    };

    create.mutate(input, {
      onError: (err) => setError(apiErrorMessage(err, 'Could not create the problem')),
    });
  };

  const priorityButtons = (
    value: ProblemPriority,
    setValue: (v: ProblemPriority) => void,
    label: string,
  ) => (
    <fieldset>
      <legend className="mb-1.5 block text-sm font-medium">{label}</legend>
      <div className="flex flex-wrap gap-2">
        {PRIORITIES.map((p) => (
          <button
            key={p.value}
            type="button"
            onClick={() => setValue(p.value)}
            aria-pressed={value === p.value}
            className={`cursor-pointer rounded-md border px-4 py-1.5 text-sm transition-colors ${
              value === p.value
                ? 'border-primary bg-primary text-on-primary'
                : 'border-border bg-card text-muted-foreground hover:border-ring/40 hover:text-foreground'
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>
    </fieldset>
  );

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="text-2xl font-semibold">New problem</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Create a new problem record for investigation and root cause analysis.
      </p>

      <form onSubmit={handleSubmit} className="mt-6 space-y-5 rounded-xl border border-border bg-card p-6" aria-describedby={error ? 'create-error' : undefined}>
        <div>
          <label htmlFor="title" className="mb-1.5 block text-sm font-medium">
            Title <span className="text-destructive">*</span>
          </label>
          <input
            id="title"
            type="text"
            required
            minLength={5}
            maxLength={200}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Short summary of the problem"
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm transition-colors hover:border-ring/40 focus:border-ring"
            aria-describedby="title-hint"
          />
          <p id="title-hint" className="mt-1 text-xs text-muted-foreground">5–200 characters</p>
        </div>

        <div>
          <label htmlFor="description" className="mb-1.5 block text-sm font-medium">
            Description <span className="text-destructive">*</span>
          </label>
          <textarea
            id="description"
            required
            minLength={10}
            rows={5}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Describe the problem in detail. What happened? What is the impact? Any error messages?"
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm transition-colors hover:border-ring/40 focus:border-ring"
            aria-describedby="description-hint"
          />
          <p id="description-hint" className="mt-1 text-xs text-muted-foreground">At least 10 characters</p>
        </div>

        <div>
          <label htmlFor="ownerId" className="mb-1.5 block text-sm font-medium">
            Owner <span className="text-destructive">*</span>
          </label>
          <select
            id="ownerId"
            value={ownerId}
            onChange={(e) => setOwnerId(e.target.value)}
            required
            className="w-full cursor-pointer rounded-md border border-border bg-background px-3 py-2 text-sm transition-colors hover:border-ring/40 focus:border-ring"
          >
            <option value="">Select owner</option>
            {/* An owner is a login User, not an Employee — only employees
                with a linked account can own a problem, and the value sent to
                the API is the user id. */}
            {usersData
              ?.filter((u) => u.userId)
              .map((u) => (
                <option key={u.userId} value={u.userId}>
                  {u.name}
                </option>
              ))}
          </select>
        </div>

        {priorityButtons(priority, setPriority, 'Priority')}

        <div>
          <label htmlFor="rcaType" className="mb-1.5 block text-sm font-medium">
            RCA Type
          </label>
          <select
            id="rcaType"
            value={rcaType}
            onChange={(e) => setRcaType(e.target.value as RCAType)}
            className="w-full cursor-pointer rounded-md border border-border bg-background px-3 py-2 text-sm transition-colors hover:border-ring/40 focus:border-ring"
          >
            {RCA_TYPES.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
          <p className="mt-1 text-xs text-muted-foreground">Root cause analysis method to use</p>
        </div>

        <div>
          <label htmlFor="affectedServices" className="mb-1.5 block text-sm font-medium">
            Affected Services
          </label>
          <input
            id="affectedServices"
            type="text"
            value={affectedServices}
            onChange={(e) => setAffectedServices(e.target.value)}
            placeholder="Comma-separated service names (e.g., Email, VPN, ERP)"
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm transition-colors hover:border-ring/40 focus:border-ring"
          />
          <p className="mt-1 text-xs text-muted-foreground">Optional, comma-separated</p>
        </div>

        <div>
          <label htmlFor="affectedAssets" className="mb-1.5 block text-sm font-medium">
            Affected Assets
          </label>
          <input
            id="affectedAssets"
            type="text"
            value={affectedAssets}
            onChange={(e) => setAffectedAssets(e.target.value)}
            placeholder="Comma-separated asset tags/names"
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm transition-colors hover:border-ring/40 focus:border-ring"
          />
          <p className="mt-1 text-xs text-muted-foreground">Optional, comma-separated</p>
        </div>

        <div>
          <label htmlFor="affectedCIs" className="mb-1.5 block text-sm font-medium">
            Affected CIs
          </label>
          <input
            id="affectedCIs"
            type="text"
            value={affectedCIs}
            onChange={(e) => setAffectedCIs(e.target.value)}
            placeholder="Comma-separated configuration item names"
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm transition-colors hover:border-ring/40 focus:border-ring"
          />
          <p className="mt-1 text-xs text-muted-foreground">Optional, comma-separated</p>
        </div>

        <div>
          <label htmlFor="businessImpact" className="mb-1.5 block text-sm font-medium">
            Business Impact
          </label>
          <textarea
            id="businessImpact"
            rows={3}
            value={businessImpact}
            onChange={(e) => setBusinessImpact(e.target.value)}
            placeholder="Describe the business impact: users affected, revenue at risk, compliance concerns, etc."
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm transition-colors hover:border-ring/40 focus:border-ring"
          />
          <p className="mt-1 text-xs text-muted-foreground">Optional</p>
        </div>

        {error && (
          <p id="create-error" role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        )}

        <div className="flex gap-3">
          <button
            type="submit"
            disabled={create.isPending}
            className="cursor-pointer rounded-md bg-primary px-5 py-2.5 text-sm font-medium text-on-primary transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {create.isPending ? 'Creating…' : 'Create problem'}
          </button>
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="cursor-pointer rounded-md border border-border bg-card px-5 py-2.5 text-sm transition-colors hover:border-ring/40"
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}