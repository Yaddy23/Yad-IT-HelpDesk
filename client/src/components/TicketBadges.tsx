import type { Priority, SlaIndicator, TicketStatus } from '@/lib/ticketsApi';

const PRIORITY_STYLES: Record<Priority, string> = {
  low: 'bg-muted text-muted-foreground border-border',
  medium: 'bg-secondary/10 text-secondary border-secondary/30',
  high: 'bg-warning/15 text-warning border-warning/40',
  critical: 'bg-destructive/15 text-destructive border-destructive/40',
};

const STATUS_STYLES: Record<TicketStatus, string> = {
  new: 'bg-secondary/10 text-secondary border-secondary/30',
  in_progress: 'bg-primary/10 text-primary border-primary/30',
  pending_employee: 'bg-warning/10 text-warning border-warning/40',
  pending_vendor: 'bg-warning/10 text-warning border-warning/40',
  resolved: 'bg-accent/10 text-accent border-accent/40',
  closed: 'bg-muted text-muted-foreground border-border',
  canceled: 'bg-muted text-muted-foreground border-border',
};

const STATUS_LABELS: Record<TicketStatus, string> = {
  new: 'New',
  in_progress: 'In progress',
  pending_employee: 'Pending employee',
  pending_vendor: 'Pending vendor',
  resolved: 'Resolved',
  closed: 'Closed',
  canceled: 'Canceled',
};

const SLA_STATE_STYLES: Record<SlaIndicator['state'], string> = {
  within: 'bg-secondary/10 text-secondary border-secondary/30',
  approaching: 'bg-warning/15 text-warning border-warning/40',
  breached: 'bg-destructive/15 text-destructive border-destructive/40',
  paused: 'bg-muted text-muted-foreground border-border',
  met: 'bg-accent/10 text-accent border-accent/40',
  missed: 'bg-destructive/15 text-destructive border-destructive/40',
};

const SLA_STATE_LABELS: Record<SlaIndicator['state'], string> = {
  within: 'On track',
  approaching: 'At risk',
  breached: 'Breached',
  paused: 'Paused',
  met: 'Met',
  missed: 'Missed',
};

const SLA_TYPE_LABELS: Record<SlaIndicator['type'], string> = {
  response: 'First response',
  resolution: 'Resolution',
};

function formatSlaTiming(sla: SlaIndicator): string {
  if (sla.targetMins === null) return `${Math.round(sla.elapsedMins)}m elapsed`;
  return `${Math.round(sla.elapsedMins)}m / ${sla.targetMins}m`;
}

/** SLA chips under the ticket title: one per matched policy target. */
export function SlaChips({ sla }: { sla: SlaIndicator[] | undefined }) {
  if (!sla || sla.length === 0) return null;
  return (
    <>
      {sla.map((s) => (
        <span
          key={s.id}
          title={
            s.deadlineAt
              ? `${SLA_TYPE_LABELS[s.type]} target: ${new Date(s.deadlineAt).toLocaleString()}`
              : SLA_TYPE_LABELS[s.type]
          }
          className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium ${SLA_STATE_STYLES[s.state]}`}
        >
          <span className="text-muted-foreground">{SLA_TYPE_LABELS[s.type]}</span>
          {SLA_STATE_LABELS[s.state]}
          <span aria-hidden="true">·</span>
          {formatSlaTiming(s)}
        </span>
      ))}
    </>
  );
}

export function PriorityBadge({ priority }: { priority: Priority }) {
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium capitalize ${PRIORITY_STYLES[priority]}`}>
      {priority}
    </span>
  );
}

export function StatusBadge({ status }: { status: TicketStatus }) {
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[status]}`}>
      {STATUS_LABELS[status]}
    </span>
  );
}

export { STATUS_LABELS };
