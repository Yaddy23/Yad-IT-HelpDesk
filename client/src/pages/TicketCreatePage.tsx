import { useState } from 'react';
import type { FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';

import { apiErrorMessage } from '@/lib/api';
import { ticketsApi, type ImpactUrgency } from '@/lib/ticketsApi';

const LEVELS: { value: ImpactUrgency; label: string }[] = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
];

const CATEGORIES = ['hardware', 'software', 'network', 'access', 'email', 'printing', 'finance_system', 'other'];

export default function TicketCreatePage() {
  const navigate = useNavigate();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState(CATEGORIES[0]);
  const [impact, setImpact] = useState<ImpactUrgency>('medium');
  const [urgency, setUrgency] = useState<ImpactUrgency>('medium');
  const [error, setError] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: ticketsApi.create,
    onSuccess: (ticket) => navigate(`/tickets/${ticket.id}`),
  });

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    create.mutate(
      { title, description, category, impact, urgency },
      { onError: (err) => setError(apiErrorMessage(err, 'Could not create the ticket')) },
    );
  };

  const levelButtons = (
    value: ImpactUrgency,
    setValue: (v: ImpactUrgency) => void,
    label: string,
    hint: string,
  ) => (
    <fieldset>
      <legend className="mb-1.5 block text-sm font-medium">{label}</legend>
      <div className="flex gap-2">
        {LEVELS.map((l) => (
          <button
            key={l.value}
            type="button"
            onClick={() => setValue(l.value)}
            aria-pressed={value === l.value}
            className={`cursor-pointer rounded-md border px-4 py-1.5 text-sm transition-colors ${
              value === l.value
                ? 'border-primary bg-primary text-on-primary'
                : 'border-border bg-card text-muted-foreground hover:border-ring/40 hover:text-foreground'
            }`}
          >
            {l.label}
          </button>
        ))}
      </div>
      <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
    </fieldset>
  );

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="text-2xl font-semibold">New ticket</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Priority is computed automatically from impact × urgency using the configured matrix.
      </p>

      <form onSubmit={handleSubmit} className="mt-6 space-y-5 rounded-xl border border-border bg-card p-6" aria-describedby={error ? 'create-error' : undefined}>
        <div>
          <label htmlFor="title" className="mb-1.5 block text-sm font-medium">
            Title
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
          />
        </div>

        <div>
          <label htmlFor="description" className="mb-1.5 block text-sm font-medium">
            Description
          </label>
          <textarea
            id="description"
            required
            minLength={10}
            rows={5}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What happened? What did you expect? Any error messages?"
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm transition-colors hover:border-ring/40 focus:border-ring"
          />
        </div>

        <div>
          <label htmlFor="category" className="mb-1.5 block text-sm font-medium">
            Category
          </label>
          <select
            id="category"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="w-full cursor-pointer rounded-md border border-border bg-background px-3 py-2 text-sm transition-colors hover:border-ring/40 focus:border-ring"
          >
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c.replace('_', ' ')}
              </option>
            ))}
          </select>
        </div>

        <div className="grid gap-5 sm:grid-cols-2">
          {levelButtons(impact, setImpact, 'Impact', 'How many people are affected?')}
          {levelButtons(urgency, setUrgency, 'Urgency', 'How quickly does it need fixing?')}
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
            {create.isPending ? 'Creating…' : 'Create ticket'}
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
