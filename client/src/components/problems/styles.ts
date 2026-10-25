/**
 * Shared class strings for the problem detail tabs. Five components render the
 * same buttons, inputs and badges, so the tokens live here rather than being
 * repeated (and drifting) in each file.
 */

export const buttonPrimary =
  'cursor-pointer rounded-md bg-primary px-4 py-2 text-sm font-medium text-on-primary transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50';

export const buttonGhost =
  'cursor-pointer rounded-md border border-border bg-card px-3 py-1.5 text-sm transition-colors hover:border-ring/40 disabled:cursor-not-allowed disabled:opacity-40';

export const buttonDestructive =
  'cursor-pointer rounded-md border border-destructive/40 px-3 py-1.5 text-sm text-destructive transition-colors hover:bg-destructive/10 disabled:cursor-not-allowed disabled:opacity-40';

export const badgeBase = 'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium';

export const cardBase = 'rounded-xl border border-border bg-card';

export const inputBase =
  'w-full rounded-md border border-border bg-card px-3 py-2 text-sm transition-colors hover:border-ring/40 focus:border-ring';

export const labelBase = 'block text-sm font-medium';

export const sectionTitle = 'text-sm font-semibold uppercase tracking-wide text-muted-foreground';

/** Skeleton rows for a tab that is still fetching. */
export const skeletonRow = 'h-10 animate-pulse rounded-md bg-muted';
