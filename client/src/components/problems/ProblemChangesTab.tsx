import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import { apiErrorMessage } from '@/lib/api';
import { getNotificationsSocket } from '@/lib/notificationsSocket';
import {
  problemApi,
  problemKeys,
  PROBLEM_STATUS_TRANSITIONS,
  type ProblemDetail,
} from '@/lib/problemApi';
import { useAuth } from '@/lib/auth';

import ChangeLinkModal from './ChangeLinkModal';
import FixVerificationWizard from './FixVerificationWizard';
import {
  buttonDestructive,
  buttonGhost,
  buttonPrimary,
  cardBase,
  sectionTitle,
} from './styles';

/**
 * Changes tab (spec Section 5.4): the problem's linked external change
 * requests. Change ids are opaque — no change module exists to enrich them —
 * so the tab manages the links and gates the fix-verification path to
 * RESOLVED. Change events arrive out of band (the external system posts them
 * to the server); a socket notification invalidates the problem detail so
 * fresh links show up live.
 */
export default function ProblemChangesTab({
  problem,
  canLink,
}: {
  problem: ProblemDetail;
  canLink: boolean;
}) {
  const { hasPermission } = useAuth();
  const queryClient = useQueryClient();
  const [showLinkModal, setShowLinkModal] = useState(false);
  const [showVerifyWizard, setShowVerifyWizard] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Change events notify the owner over the notifications socket; refresh the
  // problem detail when one lands so newly linked state appears without a
  // manual reload.
  useEffect(() => {
    const socket = getNotificationsSocket();
    if (!socket) return;
    const onChangeEvent = () => {
      void queryClient.invalidateQueries({ queryKey: problemKeys.detail(problem.id) });
    };
    socket.on('notification', onChangeEvent);
    return () => {
      socket.off('notification', onChangeEvent);
    };
  }, [problem.id, queryClient]);

  const unlinkMutation = useMutation({
    mutationFn: (changeId: string) => problemApi.unlinkChangeRequest(problem.id, changeId),
    onSuccess: () => {
      setError(null);
      queryClient.invalidateQueries({ queryKey: problemKeys.detail(problem.id) });
      queryClient.invalidateQueries({ queryKey: problemKeys.lists() });
    },
    onError: (e) => setError(apiErrorMessage(e, 'Failed to unlink change request')),
  });

  const linked = problem.changeRequestIds;
  const canResolve = (PROBLEM_STATUS_TRANSITIONS[problem.status] ?? []).includes('RESOLVED');
  // Resolving with a verified fix is the owner's move; the server also allows
  // a manager exception, which stays on the status-select path.
  const canVerifyFix = canResolve && hasPermission('problems:transition');

  return (
    <div className="space-y-4">
      <section className={`${cardBase} p-5`}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className={sectionTitle}>Linked change requests</h2>
          {canLink && (
            <button type="button" onClick={() => setShowLinkModal(true)} className={buttonGhost}>
              Link change
            </button>
          )}
        </div>

        {linked.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">
            No change requests linked. Link the change that carries the
            permanent fix — PENDING_CHANGE requires at least one.
          </p>
        ) : (
          <ul className="mt-3 space-y-2">
            {linked.map((changeId) => (
              <li
                key={changeId}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border px-3 py-2"
              >
                <span className="font-mono text-sm">{changeId}</span>
                {canLink && (
                  <button
                    type="button"
                    onClick={() => unlinkMutation.mutate(changeId)}
                    disabled={unlinkMutation.isPending}
                    className={buttonDestructive}
                    aria-label={`Unlink change ${changeId}`}
                  >
                    Unlink
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}

        {error && (
          <p role="alert" className="mt-3 text-sm text-destructive">
            {error}
          </p>
        )}
      </section>

      {canVerifyFix && linked.length > 0 && (
        <section className={`${cardBase} p-5`}>
          <h2 className={sectionTitle}>Fix verification</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Once the implemented change is in place and you have verified it
            stops the recurring incidents, resolve the problem through the
            verification wizard.
          </p>
          <button
            type="button"
            onClick={() => setShowVerifyWizard(true)}
            className={`${buttonPrimary} mt-3`}
          >
            Verify fix & resolve
          </button>
        </section>
      )}

      {showLinkModal && (
        <ChangeLinkModal problem={problem} onClose={() => setShowLinkModal(false)} />
      )}
      {showVerifyWizard && (
        <FixVerificationWizard problem={problem} onClose={() => setShowVerifyWizard(false)} />
      )}
    </div>
  );
}
