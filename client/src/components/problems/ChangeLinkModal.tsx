import { useState } from 'react';
import type { FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import { apiErrorMessage } from '@/lib/api';
import { problemApi, problemKeys, type ProblemDetail } from '@/lib/problemApi';

import { buttonGhost, buttonPrimary, inputBase, labelBase } from './styles';

/**
 * Link external change requests to a problem (spec Section 5.4).
 *
 * Change ids are opaque strings owned by an external change system — this
 * platform deliberately has no change module to search — so the modal takes
 * ids as free text instead of offering a search box. Ids are staged as chips
 * and linked in one go; the server ignores a re-link of an existing id.
 */
export default function ChangeLinkModal({
  problem,
  onClose,
}: {
  problem: ProblemDetail;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState('');
  const [staged, setStaged] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const linked = new Set(problem.changeRequestIds);

  const stageDraft = () => {
    const id = draft.trim();
    setError(null);
    if (!id) return;
    if (linked.has(id)) {
      setError(`Change ${id} is already linked.`);
      return;
    }
    // Dedupe inside the updater so a rapid double-click cannot stage the same
    // id twice off stale state.
    setStaged((current) => (current.includes(id) ? current : [...current, id]));
    setDraft('');
  };

  const linkMutation = useMutation({
    mutationFn: async () => {
      // Snapshot: a chip removed mid-flight must not be linked anyway.
      for (const changeId of staged) {
        await problemApi.linkChangeRequest(problem.id, changeId);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: problemKeys.detail(problem.id) });
      queryClient.invalidateQueries({ queryKey: problemKeys.lists() });
      onClose();
    },
    onError: (e) => setError(apiErrorMessage(e, 'Failed to link change request')),
  });

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (staged.length > 0) linkMutation.mutate();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Link change requests"
    >
      <div className="w-full max-w-lg rounded-xl border border-border bg-card p-5">
        <h2 className="text-lg font-semibold">Link change requests</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Paste the change request id from the change system. Staged changes are
          linked when you submit.
        </p>

        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          <div>
            <label htmlFor="change-id-input" className={labelBase}>
              Change request id
            </label>
            <div className="mt-1 flex gap-2">
              <input
                id="change-id-input"
                type="text"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="e.g. CHG-2026-0042"
                className={inputBase}
              />
              <button
                type="button"
                onClick={stageDraft}
                disabled={!draft.trim()}
                className={buttonGhost}
              >
                Add
              </button>
            </div>
          </div>

          {staged.length > 0 && (
            <ul className="flex flex-wrap gap-2" aria-label="Staged change requests">
              {staged.map((changeId) => (
                <li
                  key={changeId}
                  className="flex items-center gap-1.5 rounded-full border border-border px-2.5 py-0.5 text-xs"
                >
                  <span className="font-mono">{changeId}</span>
                  <button
                    type="button"
                    aria-label={`Remove ${changeId}`}
                    disabled={linkMutation.isPending}
                    onClick={() => setStaged((current) => current.filter((c) => c !== changeId))}
                    className="cursor-pointer text-muted-foreground hover:text-destructive disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          )}

          {problem.changeRequestIds.length > 0 && (
            <p className="text-xs text-muted-foreground">
              Already linked:{' '}
              <span className="font-mono">{problem.changeRequestIds.join(', ')}</span>
            </p>
          )}

          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}

          <div className="flex justify-end gap-2">
            <button type="button" onClick={onClose} className={buttonGhost}>
              Cancel
            </button>
            <button type="submit" disabled={staged.length === 0 || linkMutation.isPending} className={buttonPrimary}>
              {linkMutation.isPending
                ? 'Linking…'
                : staged.length === 1
                  ? 'Link 1 change'
                  : `Link ${staged.length} changes`}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
