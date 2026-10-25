import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import { apiErrorMessage } from '@/lib/api';
import { problemApi, problemKeys, type ProblemDetail } from '@/lib/problemApi';

import { buttonGhost, buttonPrimary, inputBase, labelBase } from './styles';

/**
 * Fix verification wizard (spec Section 5.4): the path to RESOLVED when the
 * problem has linked change requests. Step 1 picks the implemented changes
 * the verification covers, step 2 records the confirmation and resolution
 * summary, and submitting resolves the problem with verifiedFix: true — the
 * only non-manager way the server accepts that transition.
 */
export default function FixVerificationWizard({
  problem,
  onClose,
}: {
  problem: ProblemDetail;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [step, setStep] = useState<1 | 2>(1);
  const [selected, setSelected] = useState<string[]>([]);
  const [confirmed, setConfirmed] = useState(false);
  const [summary, setSummary] = useState('');
  const [error, setError] = useState<string | null>(null);

  const verifyMutation = useMutation({
    mutationFn: () =>
      problemApi.transitionStatus(problem.id, 'RESOLVED', {
        resolutionSummary: summary.trim(),
        verifiedFix: true,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: problemKeys.detail(problem.id) });
      queryClient.invalidateQueries({ queryKey: problemKeys.lists() });
      onClose();
    },
    onError: (e) => setError(apiErrorMessage(e, 'Failed to resolve problem')),
  });

  const toggle = (changeId: string) => {
    setSelected((current) =>
      current.includes(changeId) ? current.filter((c) => c !== changeId) : [...current, changeId],
    );
  };

  // A change unlinked while the wizard is open must not be recorded as
  // verified — verify against what is still linked, and block the submit if
  // nothing is.
  const verifiedChanges = selected.filter((id) => problem.changeRequestIds.includes(id));

  const canSubmit = step === 2 && confirmed && summary.trim().length >= 5 && verifiedChanges.length > 0;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Verify fix and resolve"
    >
      <div className="w-full max-w-lg rounded-xl border border-border bg-card p-5">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Verify fix · Step {step} of 2
        </p>
        <h2 className="mt-1 text-lg font-semibold">Resolve problem</h2>

        {step === 1 && (
          <div className="mt-4 space-y-3">
            <p className="text-sm text-muted-foreground">
              Select the change requests that were implemented and whose result
              you have verified.
            </p>
            <fieldset className="space-y-2">
              <legend className="sr-only">Implemented changes</legend>
              {problem.changeRequestIds.map((changeId) => (
                <label key={changeId} className="flex cursor-pointer items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={selected.includes(changeId)}
                    onChange={() => toggle(changeId)}
                    className="h-4 w-4 cursor-pointer accent-primary"
                  />
                  <span className="font-mono">{changeId}</span>
                </label>
              ))}
            </fieldset>
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <button type="button" onClick={onClose} className={buttonGhost}>
                Cancel
              </button>
              <button
                type="button"
                disabled={selected.length === 0}
                onClick={() => {
                  setError(null);
                  setStep(2);
                }}
                className={buttonPrimary}
              >
                Next
              </button>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="mt-4 space-y-4">
            <p className="text-sm text-muted-foreground">
              Verifying against{' '}
              <span className="font-mono">{verifiedChanges.join(', ')}</span>.
            </p>
            <label className="flex cursor-pointer items-start gap-2 text-sm">
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(e) => setConfirmed(e.target.checked)}
                className="mt-0.5 h-4 w-4 cursor-pointer accent-primary"
              />
              The implemented fix stops the recurring incidents — I verified it
              in the affected environment.
            </label>
            <div>
              <label htmlFor="fix-verification-summary" className={labelBase}>
                Resolution summary
              </label>
              <textarea
                id="fix-verification-summary"
                rows={3}
                maxLength={10000}
                value={summary}
                onChange={(e) => setSummary(e.target.value)}
                placeholder="What was deployed, what you tested, and the result."
                className={`${inputBase} mt-1`}
              />
            </div>
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setError(null);
                  setStep(1);
                }}
                className={buttonGhost}
                disabled={verifyMutation.isPending}
              >
                Back
              </button>
              <button
                type="button"
                disabled={!canSubmit || verifyMutation.isPending}
                onClick={() => verifyMutation.mutate()}
                className={buttonPrimary}
              >
                {verifyMutation.isPending ? 'Resolving…' : 'Verify fix & resolve'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
