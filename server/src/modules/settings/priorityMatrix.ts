/** Default impact × urgency → priority matrix (admins configure via system settings). */
export const DEFAULT_PRIORITY_MATRIX = {
  high: { high: 'critical', medium: 'high', low: 'medium' },
  medium: { high: 'high', medium: 'medium', low: 'low' },
  low: { high: 'medium', medium: 'low', low: 'low' },
} as const;

export const PRIORITIES = ['low', 'medium', 'high', 'critical'] as const;
export const IMPACT_LEVELS = ['low', 'medium', 'high'] as const;
export const URGENCY_LEVELS = ['low', 'medium', 'high'] as const;

export type Priority = (typeof PRIORITIES)[number];

/** Resolve priority from the matrix; falls back to 'medium' on malformed config. */
export function calculatePriority(
  matrix: unknown,
  impact: string,
  urgency: string,
): Priority {
  const m = matrix as Record<string, Record<string, Priority>> | null;
  return m?.[impact]?.[urgency] ?? 'medium';
}

/** Default ticket states that pause resolution SLAs (admins can change). */
export const DEFAULT_SLA_PAUSE_STATES = ['pending_employee', 'pending_vendor'] as const;
