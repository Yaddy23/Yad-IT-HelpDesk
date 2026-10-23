import type { ApprovalStep, SrStatus } from '@/lib/serviceApi';

const STATUS_STYLES: Record<SrStatus, string> = {
  pending_approval: 'bg-warning/10 text-warning border-warning/40',
  info_requested: 'bg-secondary/10 text-secondary border-secondary/30',
  in_fulfillment: 'bg-primary/10 text-primary border-primary/30',
  fulfilled: 'bg-accent/10 text-accent border-accent/40',
  rejected: 'bg-destructive/15 text-destructive border-destructive/40',
  canceled: 'bg-muted text-muted-foreground border-border',
};

const STATUS_LABELS: Record<SrStatus, string> = {
  pending_approval: 'Pending approval',
  info_requested: 'Info requested',
  in_fulfillment: 'In fulfillment',
  fulfilled: 'Fulfilled',
  rejected: 'Rejected',
  canceled: 'Canceled',
};

export function SrStatusBadge({ status }: { status: SrStatus }) {
  return (
    <span className={`inline-flex items-center whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[status]}`}>
      {STATUS_LABELS[status]}
    </span>
  );
}

export const SR_STATUS_LABELS = STATUS_LABELS;

export const MODE_LABELS: Record<ApprovalStep['mode'], string> = {
  single: 'One of',
  all: 'All of',
  any: 'Any of',
  sequential: 'In sequence',
};

/** Short relative deadline, e.g. "due in 2 days" / "overdue 3h". */
export function deadlineLabel(deadlineAt: string | null): string | null {
  if (!deadlineAt) return null;
  const diffMs = Date.parse(deadlineAt) - Date.now();
  const hours = Math.round(Math.abs(diffMs) / 3_600_000);
  const text = hours >= 48 ? `${Math.round(hours / 24)} days` : `${hours}h`;
  return diffMs >= 0 ? `due in ${text}` : `overdue ${text}`;
}
