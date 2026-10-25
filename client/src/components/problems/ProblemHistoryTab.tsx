import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';

import { apiErrorMessage } from '@/lib/api';
import { problemApi, problemKeys, formatDateTime } from '@/lib/problemApi';

import { cardBase, sectionTitle, skeletonRow } from './styles';

const PAGE_SIZE = 20;

/**
 * Human labels for the audit actions the server writes
 * (`STATUS_CHANGED`, `INCIDENT_LINKED`, `RCA_UPDATED`, `WORKAROUND_SET`,
 * `CHANGE_LINKED`, …). Unknown actions fall through to their raw form.
 */
const ACTION_LABELS: Record<string, string> = {
  STATUS_CHANGED: 'Status changed',
  INCIDENT_LINKED: 'Incident linked',
  INCIDENT_UNLINKED: 'Incident unlinked',
  RCA_UPDATED: 'RCA updated',
  WORKAROUND_SET: 'Workaround set',
  CHANGE_LINKED: 'Change request linked',
  CHANGE_UNLINKED: 'Change request unlinked',
};

/**
 * Summarize old→new for the common cases instead of dumping raw JSON.
 * The values are server-written payloads, so only known keys are rendered —
 * anything unrecognized renders as text (React escapes it; nothing executes).
 */
function ChangeSummary({ oldValue, newValue }: { oldValue: unknown; newValue: unknown }) {
  const old = (oldValue ?? null) as Record<string, unknown> | null;
  const now = (newValue ?? null) as Record<string, unknown> | null;

  const parts: string[] = [];
  if (old?.status && now?.status && old.status !== now.status) {
    parts.push(`${String(old.status)} → ${String(now.status)}`);
  }
  if (Array.isArray(now?.incidentIds)) {
    parts.push(`${now.incidentIds.length} incident${now.incidentIds.length === 1 ? '' : 's'} linked`);
  }
  if (old?.incidentId) parts.push(`incident ${String(old.incidentId).slice(0, 8)}… removed`);
  if (typeof now?.workaround === 'string' && now.workaround) {
    parts.push(`workaround: ${now.workaround.slice(0, 80)}${now.workaround.length > 80 ? '…' : ''}`);
  }
  if (typeof now?.changeId === 'string') parts.push(`change ${String(now.changeId).slice(0, 8)}…`);
  if (now?.rootCause !== undefined && now?.rcaType !== undefined) parts.push('RCA fields updated');

  return parts.length > 0 ? <span className="text-sm">{parts.join(' · ')}</span> : null;
}

export default function ProblemHistoryTab({ problemId }: { problemId: string }) {
  const [page, setPage] = useState(1);

  const auditQuery = useQuery({
    queryKey: problemKeys.audit(problemId, { page, limit: PAGE_SIZE }),
    queryFn: () => problemApi.getAuditLog(problemId, { page, limit: PAGE_SIZE }),
  });

  return (
    <div className="space-y-4">
      <h2 className={sectionTitle}>History</h2>

      <div className={`${cardBase} overflow-hidden`}>
        {auditQuery.isLoading ? (
          <div className="space-y-2 p-5" aria-busy="true">
            {[...Array(4)].map((_, i) => (
              <div key={i} className={skeletonRow} />
            ))}
          </div>
        ) : auditQuery.isError ? (
          <p role="alert" className="p-5 text-sm text-destructive">
            {apiErrorMessage(auditQuery.error, 'Failed to load history')}
          </p>
        ) : auditQuery.data?.length === 0 ? (
          <p className="p-10 text-center text-sm text-muted-foreground">No history yet.</p>
        ) : (
          <ol className="divide-y divide-border/60">
            {auditQuery.data?.map((entry) => (
              <li key={entry.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-4 py-3">
                <span className="text-sm font-medium">{ACTION_LABELS[entry.action] ?? entry.action}</span>
                <ChangeSummary oldValue={entry.oldValue} newValue={entry.newValue} />
                <span className="ml-auto whitespace-nowrap text-xs text-muted-foreground">
                  {entry.actor?.name ?? 'System'} · {formatDateTime(entry.createdAt)}
                </span>
              </li>
            ))}
          </ol>
        )}
      </div>

      {auditQuery.data && auditQuery.data.length === PAGE_SIZE && (
        <div className="flex justify-end gap-2 text-sm">
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
            className="cursor-pointer rounded-md border border-border bg-card px-3 py-1.5 transition-colors hover:border-ring/40 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Previous
          </button>
          <button
            type="button"
            onClick={() => setPage((p) => p + 1)}
            className="cursor-pointer rounded-md border border-border bg-card px-3 py-1.5 transition-colors hover:border-ring/40"
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}
