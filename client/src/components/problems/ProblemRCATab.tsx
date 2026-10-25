import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { FormEvent } from 'react';

import { apiErrorMessage } from '@/lib/api';
import {
  problemApi,
  problemKeys,
  getRCATypeLabel,
  type ProblemDetail,
  type RCAType,
} from '@/lib/problemApi';

import { buttonPrimary, cardBase, inputBase, labelBase, sectionTitle } from './styles';

interface Props {
  problem: ProblemDetail;
  /** `problems:manage_rca` — gates the editor. */
  canManage: boolean;
}

/**
 * The structured evidence shapes this editor writes. The server stores both
 * as opaque JSON on the Problem row (`fiveWhys`, `fishbone`), so the shape is
 * a client-side contract — the dead `ProblemRCA` table is never written by
 * the server and the detail response carries `rca: null`.
 */
export type FiveWhysData = { steps: string[] };
export type FishboneData = { categories: { name: string; causes: string[] }[] };

const FISHBONE_CATEGORIES = ['People', 'Process', 'Technology', 'Environment', 'Materials', 'Measurement'];

function isFiveWhys(value: unknown): value is FiveWhysData {
  return (
    typeof value === 'object' &&
    value !== null &&
    Array.isArray((value as FiveWhysData).steps)
  );
}

function isFishbone(value: unknown): value is FishboneData {
  return (
    typeof value === 'object' &&
    value !== null &&
    Array.isArray((value as FishboneData).categories)
  );
}

/** Guards against pasted text carrying characters that would break out of a JSON column. */
function sanitizeLine(value: string): string {
  return value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim();
}

function FiveWhysEditor({
  steps,
  onChange,
}: {
  steps: string[];
  onChange: (steps: string[]) => void;
}) {
  const setStep = (index: number, value: string) => {
    const next = [...steps];
    next[index] = value;
    onChange(next);
  };

  return (
    <ol className="space-y-3">
      {[0, 1, 2, 3, 4].map((i) => (
        <li key={i} className="flex items-start gap-3">
          <span className="mt-2 w-6 shrink-0 text-center font-mono text-xs text-muted-foreground">
            {i + 1}.
          </span>
          <div className="min-w-0 flex-1">
            <label htmlFor={`why-${i}`} className="sr-only">
              Why {i + 1}
            </label>
            <textarea
              id={`why-${i}`}
              rows={2}
              maxLength={2000}
              value={steps[i] ?? ''}
              onChange={(e) => setStep(i, e.target.value)}
              placeholder={i === 0 ? 'Why did the problem occur?' : 'Why did that happen?'}
              className={inputBase}
            />
          </div>
        </li>
      ))}
    </ol>
  );
}

function FishboneEditor({
  data,
  onChange,
}: {
  data: FishboneData;
  onChange: (data: FishboneData) => void;
}) {
  const setCategory = (index: number, causes: string[]) => {
    const next = { ...data, categories: [...data.categories] };
    next.categories[index] = { ...next.categories[index], causes };
    onChange(next);
  };

  return (
    <div className="space-y-4">
      {data.categories.map((category, index) => (
        <div key={category.name}>
          <label
            htmlFor={`fishbone-${index}`}
            className="block text-sm font-medium"
          >
            {category.name}
          </label>
          <textarea
            id={`fishbone-${index}`}
            rows={2}
            maxLength={2000}
            value={category.causes.join('\n')}
            onChange={(e) =>
              // Keep the raw lines while typing: sanitizing/filtering here
              // would strip the newline (and trailing spaces) the user just
              // typed out of the controlled value. Sanitization happens on
              // save instead.
              setCategory(
                index,
                e.target.value.split('\n'),
              )
            }
            placeholder="One cause per line"
            className={`${inputBase} mt-1`}
          />
        </div>
      ))}
    </div>
  );
}

export default function ProblemRCATab({ problem, canManage }: Props) {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);

  const [rcaType, setRcaType] = useState<RCAType>(problem.rcaType);
  const [rootCause, setRootCause] = useState(problem.rootCause ?? '');
  const [rcaNotes, setRcaNotes] = useState(problem.rcaNotes ?? '');
  const [confirmed, setConfirmed] = useState(problem.confirmedRootCause);
  const [fiveWhys, setFiveWhys] = useState<string[]>(
    isFiveWhys(problem.fiveWhys) ? problem.fiveWhys.steps : ['', '', '', '', ''],
  );
  const [fishbone, setFishbone] = useState<FishboneData>(
    isFishbone(problem.fishbone)
      ? problem.fishbone
      : { categories: FISHBONE_CATEGORIES.map((name) => ({ name, causes: [] })) },
  );

  // Reset local state when the query refetches (e.g. after a status mutation
  // invalidates the detail) so the editor never edits a stale snapshot.
  useEffect(() => {
    setRcaType(problem.rcaType);
    setRootCause(problem.rootCause ?? '');
    setRcaNotes(problem.rcaNotes ?? '');
    setConfirmed(problem.confirmedRootCause);
    if (isFiveWhys(problem.fiveWhys)) setFiveWhys(problem.fiveWhys.steps);
    if (isFishbone(problem.fishbone)) setFishbone(problem.fishbone);
  }, [problem]);

  const saveMutation = useMutation({
    mutationFn: () =>
      problemApi.updateRCA(problem.id, {
        rcaType,
        rootCause: rootCause.trim() || undefined,
        rcaNotes: rcaNotes.trim() || undefined,
        confirmedRootCause: confirmed,
        ...(rcaType === 'FIVE_WHYS'
          ? { fiveWhys: { steps: fiveWhys.map((s) => sanitizeLine(s)).filter(Boolean) } }
          : {}),
        ...(rcaType === 'FISHBONE'
          ? {
              fishbone: {
                categories: fishbone.categories.map((category) => ({
                  ...category,
                  causes: category.causes.map(sanitizeLine).filter(Boolean),
                })),
              },
            }
          : {}),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: problemKeys.detail(problem.id) }),
    onError: (e) => setError(apiErrorMessage(e, 'Failed to save RCA')),
  });

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    saveMutation.mutate();
  };

  if (!canManage) {
    return (
      <div className="space-y-4">
        <section className={`${cardBase} p-5`}>
          <h2 className={sectionTitle}>Root cause</h2>
          {problem.rootCause?.trim() ? (
            <p className="mt-3 whitespace-pre-wrap text-sm">{problem.rootCause}</p>
          ) : (
            <p className="mt-3 text-sm text-muted-foreground">No root cause documented yet.</p>
          )}
          {problem.confirmedRootCause && (
            <p className="mt-2 text-sm text-green-700 dark:text-green-400">✓ Root cause confirmed</p>
          )}
        </section>
        {problem.rcaNotes?.trim() && (
          <section className={`${cardBase} p-5`}>
            <h2 className={sectionTitle}>RCA notes</h2>
            <p className="mt-3 whitespace-pre-wrap text-sm">{problem.rcaNotes}</p>
          </section>
        )}
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4" aria-busy={saveMutation.isPending}>
      <section className={`${cardBase} p-5`}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className={sectionTitle}>Root cause analysis</h2>
          <div className="flex items-center gap-2">
            <label htmlFor="rca-type" className="text-sm text-muted-foreground">
              Method
            </label>
            <select
              id="rca-type"
              value={rcaType}
              onChange={(e) => setRcaType(e.target.value as RCAType)}
              className="cursor-pointer rounded-md border border-border bg-card px-2 py-1.5 text-sm"
            >
              <option value="NONE">{getRCATypeLabel('NONE')}</option>
              <option value="FIVE_WHYS">{getRCATypeLabel('FIVE_WHYS')}</option>
              <option value="FISHBONE">{getRCATypeLabel('FISHBONE')}</option>
            </select>
          </div>
        </div>

        <div className="mt-4">
          <label htmlFor="root-cause" className={labelBase}>
            Root cause
          </label>
          <textarea
            id="root-cause"
            rows={3}
            maxLength={10000}
            value={rootCause}
            onChange={(e) => setRootCause(e.target.value)}
            placeholder="What is the underlying cause of this problem?"
            className={`${inputBase} mt-1`}
          />
        </div>

        <label className="mt-3 flex cursor-pointer items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(e) => setConfirmed(e.target.checked)}
            className="h-4 w-4 cursor-pointer accent-primary"
          />
          Root cause confirmed
          <span className="text-muted-foreground">
            (required before the problem can move to Root Cause Known)
          </span>
        </label>
      </section>

      {rcaType === 'FIVE_WHYS' && (
        <section className={`${cardBase} p-5`}>
          <h2 className={sectionTitle}>5 Whys</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Ask “why” five times to move from symptom to root cause.
          </p>
          <div className="mt-4">
            <FiveWhysEditor steps={fiveWhys} onChange={setFiveWhys} />
          </div>
        </section>
      )}

      {rcaType === 'FISHBONE' && (
        <section className={`${cardBase} p-5`}>
          <h2 className={sectionTitle}>Fishbone (Ishikawa)</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Brainstorm candidate causes under each category.
          </p>
          <div className="mt-4">
            <FishboneEditor data={fishbone} onChange={setFishbone} />
          </div>
        </section>
      )}

      <section className={`${cardBase} p-5`}>
        <label htmlFor="rca-notes" className={labelBase}>
          RCA notes <span className="font-normal text-muted-foreground">(internal evidence, optional)</span>
        </label>
        <textarea
          id="rca-notes"
          rows={4}
          maxLength={10000}
          value={rcaNotes}
          onChange={(e) => setRcaNotes(e.target.value)}
          className={`${inputBase} mt-1`}
        />
      </section>

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      <div className="flex justify-end">
        <button type="submit" disabled={saveMutation.isPending} className={buttonPrimary}>
          {saveMutation.isPending ? 'Saving…' : 'Save RCA'}
        </button>
      </div>
    </form>
  );
}
