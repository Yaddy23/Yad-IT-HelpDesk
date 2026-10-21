import type { Priority, TicketStatus } from '@/lib/ticketsApi';

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
