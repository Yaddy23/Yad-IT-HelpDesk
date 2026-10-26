/**
 * Detection criteria: which fields are compared, what each is worth, and the
 * windows that bound a scan.
 *
 * Kept in one file so `scoring.ts` stays pure and the scheduled worker and the
 * on-demand "find related" endpoint score incidents identically — a suggestion
 * a human sees must not depend on which path produced it.
 */

export interface DetectionCriteria {
  /**
   * Weights for the additive score. They sum to 100 so a full match on both
   * declared impact dimensions is exactly 100 without relying on the cap.
   */
  weights: {
    /** Problem's affectedServices vs the incident's service/symptoms. */
    service: number;
    /** Problem's affectedAssets vs the incident's asset. */
    asset: number;
    /** Problem's text (title/description/root cause/workaround) vs symptoms. */
    symptoms: number;
  };
  /** Minimum score for a suggestion to be persisted. */
  threshold: number;
  /** How far back a scheduled scan looks for candidate incidents. */
  windowHours: number;
  /** Same-category incidents inside this window form a time pattern. */
  patternWindowHours: number;
  /** Fewest same-category incidents in the window to count as a pattern. */
  patternMinIncidents: number;
  /** A suggestion nobody reviews expires after this many days. */
  suggestionTtlDays: number;
  /** Ceiling on the time-pattern boost, in score points. */
  maxPatternBoost: number;
}

/**
 * Defaults. `service + asset` = 100 by design: an incident that matches every
 * impact dimension a problem declares is a perfect match, and the symptom term
 * can only ever add to a partial match (the total is capped at 100).
 */
export const DETECTION_CRITERIA: DetectionCriteria = {
  weights: { service: 60, asset: 40, symptoms: 20 },
  threshold: 75,
  windowHours: 24,
  patternWindowHours: 24,
  patternMinIncidents: 3,
  suggestionTtlDays: 7,
  maxPatternBoost: 20,
};

/**
 * A suggestion the engine persists. Mirrors the `DetectionSuggestion` model
 * without the Prisma import, so the pure layer stays testable in isolation.
 */
export interface ScoredIncident {
  incidentId: string;
  problemId: string | null;
  score: number;
  matchReasons: string[];
}

/** Match reasons recorded on a suggestion (spec Section 9). */
export const MATCH_REASONS = {
  sameService: 'same_service',
  sameAsset: 'same_asset',
  symptomSimilarity: 'symptom_similarity',
  timePattern: 'time_pattern',
} as const;
