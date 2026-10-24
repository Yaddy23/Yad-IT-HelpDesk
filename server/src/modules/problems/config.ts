import { getSystemSettings } from '../settings/settings.routes.js';

export const PROBLEM_STATUSES = [
  'IDENTIFIED',
  'INVESTIGATION',
  'ROOT_CAUSE_KNOWN',
  'WORKAROUND_DOCUMENTED',
  'PENDING_CHANGE',
  'RESOLVED',
  'CLOSED',
] as const;

export const PROBLEM_PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;

export const RCA_TYPES = ['FIVE_WHYS', 'FISHBONE', 'NONE'] as const;

export const KNOWN_ERROR_STATUSES = ['DRAFT', 'UNDER_REVIEW', 'PUBLISHED', 'RETIRED'] as const;

export const KNOWN_ERROR_VISIBILITIES = ['IT_ONLY', 'EMPLOYEE_SELF_SERVICE'] as const;

export const PROBLEM_STATUS_TRANSITIONS: Record<string, string[]> = {
  IDENTIFIED: ['INVESTIGATION', 'ROOT_CAUSE_KNOWN', 'WORKAROUND_DOCUMENTED', 'PENDING_CHANGE', 'RESOLVED', 'CLOSED'],
  INVESTIGATION: ['ROOT_CAUSE_KNOWN', 'WORKAROUND_DOCUMENTED', 'PENDING_CHANGE', 'RESOLVED', 'CLOSED'],
  ROOT_CAUSE_KNOWN: ['WORKAROUND_DOCUMENTED', 'PENDING_CHANGE', 'RESOLVED', 'CLOSED'],
  WORKAROUND_DOCUMENTED: ['PENDING_CHANGE', 'RESOLVED', 'CLOSED'],
  PENDING_CHANGE: ['RESOLVED', 'CLOSED'],
  RESOLVED: ['CLOSED', 'INVESTIGATION'],
  CLOSED: [],
};

export const KNOWN_ERROR_TRANSITIONS: Record<string, string[]> = {
  DRAFT: ['UNDER_REVIEW', 'RETIRED'],
  UNDER_REVIEW: ['PUBLISHED', 'DRAFT', 'RETIRED'],
  PUBLISHED: ['RETIRED'],
  RETIRED: [],
};

// Feature flag getters reading from system_settings with defaults
export const problemConfig = {
  detectionEnabled: () => getSetting('PROBLEM_DETECTION_ENABLED', true),
  detectionIntervalMin: () => getSetting('PROBLEM_DETECTION_INTERVAL_MIN', 15),
  detectionThreshold: () => getSetting('PROBLEM_DETECTION_THRESHOLD', 75),
  autoCreateEnabled: () => getSetting('PROBLEM_AUTO_CREATE_ENABLED', false),
  redisFallback: () => getSetting('PROBLEM_REDIS_FALLBACK', true),
  knownErrorReviewDays: () => getSetting('KNOWN_ERROR_REVIEW_DAYS', 90),
};

// Spec Section 16.11: flags live in the `system_settings` singleton row,
// cached in memory with a 5-minute TTL so hot paths (detection scans) do not
// hit the DB per call.
const FLAG_CACHE_TTL_MS = 5 * 60 * 1000;
let flagCache: { at: number; flags: Record<string, unknown> } | null = null;

async function loadFlags(): Promise<Record<string, unknown>> {
  if (flagCache && Date.now() - flagCache.at < FLAG_CACHE_TTL_MS) {
    return flagCache.flags;
  }
  try {
    const settings = await getSystemSettings();
    const flags = (settings.featureFlags ?? {}) as Record<string, unknown>;
    flagCache = { at: Date.now(), flags };
    return flags;
  } catch {
    // DB unavailable: fall back to the last known flags, else let the caller's
    // default win. Detection must degrade, not throw.
    return flagCache?.flags ?? {};
  }
}

async function getSetting<T>(key: string, defaultValue: T): Promise<T> {
  const flags = await loadFlags();
  const value = flags[key];
  return value === undefined || value === null ? defaultValue : (value as T);
}

/** Test/seed helper: drop the cached flags so the next read re-fetches. */
export function clearProblemConfigCache(): void {
  flagCache = null;
}