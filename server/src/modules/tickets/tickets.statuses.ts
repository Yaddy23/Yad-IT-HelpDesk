/** Ticket state vocabulary shared by validators, service and UI. */
export const TICKET_STATUSES = [
  'new',
  'in_progress',
  'pending_employee',
  'pending_vendor',
  'resolved',
  'closed',
  'canceled',
] as const;

export type TicketStatusValue = (typeof TICKET_STATUSES)[number];

/** Open (non-terminal) states. */
export const OPEN_STATUSES: TicketStatusValue[] = [
  'new',
  'in_progress',
  'pending_employee',
  'pending_vendor',
];
