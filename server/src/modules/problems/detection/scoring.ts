/**
 * Pure scoring for recurring-incident detection. No database, no clock beyond
 * the `now` a caller passes — so the scheduled worker and the manual "find
 * related" endpoint cannot disagree, and every branch is unit-testable.
 */

import { DETECTION_CRITERIA, MATCH_REASONS } from './criteria.js';

/**
 * The shape a scoring call needs from an incident. Deliberately NOT the Prisma
 * `Ticket` row: `Ticket` has no service/asset/symptoms columns (see
 * `incidentCriteriaFromTicket` for how they are derived).
 */
export interface IncidentCriteria {
  service?: string | null;
  category?: string | null;
  assetId?: string | null;
  symptoms?: string | null;
}

/** The shape a scoring call needs from a problem. */
export interface ProblemCriteria {
  affectedServices?: string[] | null;
  affectedAssets?: string[] | null;
  title?: string | null;
  description?: string | null;
  rootCause?: string | null;
  workaround?: string | null;
}

export interface ScoredProblem<T> {
  problem: T;
  score: number;
  reasons: string[];
}

const MIN_TOKEN_LENGTH = 3;

/** Words too common to signal a match; keeping them inflates every score. */
const STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'that', 'this', 'from', 'are', 'was', 'were',
  'has', 'have', 'had', 'not', 'but', 'all', 'any', 'can', 'cannot', 'its',
  'our', 'you', 'your', 'when', 'after', 'before', 'into', 'out', 'over',
  'under', 'again', 'once', 'during', 'while', 'about', 'been', 'being',
  'does', 'did', 'doing', 'than', 'then', 'them', 'they', 'there', 'here',
  'issue', 'issues', 'error', 'errors', 'problem', 'problems', 'user', 'users',
  'getting', 'gets', 'still', 'also', 'very', 'some', 'more', 'most', 'only',
]);

/** Lowercase alphanumeric tokens, stopwords and 1-2 char noise dropped. */
export function tokenize(text: string | null | undefined): string[] {
  if (!text) return [];
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= MIN_TOKEN_LENGTH && !STOPWORDS.has(token));
}

/**
 * Overlap coefficient (Szymkiewicz-Simpson): |A n B| / min(|A|, |B|).
 *
 * Jaccard is the usual default, but it punishes length differences — a one-line
 * symptom report would never score against a paragraph of root-cause text even
 * when every symptom word is present. The overlap coefficient answers the
 * question actually being asked: "does the shorter text describe the same
 * thing as the longer one?"
 */
export function symptomSimilarity(a: string | null | undefined, b: string | null | undefined): number {
  const left = new Set(tokenize(a));
  const right = new Set(tokenize(b));
  if (left.size === 0 || right.size === 0) return 0;
  let shared = 0;
  for (const token of left) if (right.has(token)) shared += 1;
  return shared / Math.min(left.size, right.size);
}

/** True when every meaningful token of `term` appears in `tokens`. */
function mentions(term: string, tokens: Set<string>): boolean {
  const termTokens = tokenize(term);
  return termTokens.length > 0 && termTokens.every((token) => tokens.has(token));
}

/**
 * Fraction of the declared values the incident matched. An empty declaration
 * scores 0 rather than 1: a problem that names no services has told us nothing
 * to match on, so it must not collect points for it.
 */
function matchRatio(declared: string[] | null | undefined, matched: (value: string) => boolean): number {
  const values = (declared ?? []).filter((value) => typeof value === 'string' && value.trim().length > 0);
  if (values.length === 0) return 0;
  return values.filter(matched).length / values.length;
}

/** The problem's free text, used for the symptom-similarity term. */
function problemText(problem: ProblemCriteria): string {
  return [problem.title, problem.description, problem.rootCause, problem.workaround]
    .filter((part): part is string => typeof part === 'string' && part.trim().length > 0)
    .join(' ');
}

/**
 * Score one incident against one problem, 0-100, plus the reasons behind it.
 *
 * The service term falls back to the incident's symptom text: a report reading
 * "network disconnect" against a problem whose affected service is "Network"
 * is a real match, and `Ticket.category` is a coarse field that frequently
 * disagrees with how the problem was filed.
 */
export function explainIncidentAgainstProblem(
  incident: IncidentCriteria,
  problem: ProblemCriteria,
): { score: number; reasons: string[] } {
  const { weights } = DETECTION_CRITERIA;

  // Everything the incident says about itself, in one token bag.
  const incidentTokens = new Set([...tokenize(incident.service), ...tokenize(incident.symptoms)]);

  const serviceRatio = matchRatio(problem.affectedServices, (service) => mentions(service, incidentTokens));
  const assetRatio = matchRatio(
    problem.affectedAssets,
    (asset) => (incident.assetId != null && asset.toLowerCase() === incident.assetId.toLowerCase()) || mentions(asset, incidentTokens),
  );

  const text = problemText(problem);
  const symptomRatio = text ? symptomSimilarity(incident.symptoms, text) : 0;

  const raw = serviceRatio * weights.service + assetRatio * weights.asset + symptomRatio * weights.symptoms;
  const score = Math.min(100, Math.round(raw));

  const reasons: string[] = [];
  if (serviceRatio > 0) reasons.push(MATCH_REASONS.sameService);
  if (assetRatio > 0) reasons.push(MATCH_REASONS.sameAsset);
  if (symptomRatio > 0) reasons.push(MATCH_REASONS.symptomSimilarity);

  return { score, reasons };
}

/** Score one incident against one problem, 0-100. */
export function scoreIncidentAgainstProblem(incident: IncidentCriteria, problem: ProblemCriteria): number {
  return explainIncidentAgainstProblem(incident, problem).score;
}

/**
 * Rank problems against an incident, best first. Ties keep the input order, so
 * a stable problem list produces a stable suggestion list.
 */
export function findSimilarProblems<T extends ProblemCriteria>(
  incident: IncidentCriteria,
  problems: T[],
  threshold: number = DETECTION_CRITERIA.threshold,
): ScoredProblem<T>[] {
  return problems
    .map((problem) => {
      const { score, reasons } = explainIncidentAgainstProblem(incident, problem);
      return { problem, score, reasons };
    })
    .filter((scored) => scored.score >= threshold)
    .sort((a, b) => b.score - a.score);
}

/**
 * Boost for a cluster of same-category incidents inside the pattern window.
 *
 * `Ticket` carries no service or asset link, so category plus arrival time is
 * the only signal that several reports are one outage rather than a coincidence.
 * Returns 0 below the minimum cluster size, so this can be added to a score
 * unconditionally.
 */
export function timePatternBoost(
  incidents: Array<{ category?: string | null; createdAt?: Date | string | null }>,
  category: string | null | undefined,
  now: Date = new Date(),
): number {
  if (!category) return 0;
  const windowStart = now.getTime() - DETECTION_CRITERIA.patternWindowHours * 3_600_000;
  const matching = incidents.filter((incident) => {
    if (incident.category !== category || !incident.createdAt) return false;
    const at = incident.createdAt instanceof Date ? incident.createdAt : new Date(incident.createdAt);
    return !Number.isNaN(at.getTime()) && at.getTime() >= windowStart;
  });
  if (matching.length < DETECTION_CRITERIA.patternMinIncidents) return 0;
  const over = matching.length - DETECTION_CRITERIA.patternMinIncidents + 1;
  return Math.min(DETECTION_CRITERIA.maxPatternBoost, over * 5);
}

/**
 * Map a `Ticket` row onto the scoring shape.
 *
 * Ruling (SDD ledger): `Ticket` has no service, asset, or symptom columns. The
 * service term uses `category`; symptoms are the title and description. There is
 * no asset relation on a ticket at all, so `assetId` is null and the asset term
 * can only be won through the symptom text.
 */
export function incidentCriteriaFromTicket(ticket: {
  category?: string | null;
  title?: string | null;
  description?: string | null;
}): IncidentCriteria {
  return {
    service: ticket.category ?? null,
    category: ticket.category ?? null,
    assetId: null,
    symptoms: [ticket.title, ticket.description].filter(Boolean).join(' '),
  };
}

/** Map a `Problem` row onto the scoring shape. */
export function problemCriteriaFromProblem(problem: ProblemCriteria): ProblemCriteria {
  return {
    affectedServices: problem.affectedServices ?? [],
    affectedAssets: problem.affectedAssets ?? [],
    title: problem.title ?? null,
    description: problem.description ?? null,
    rootCause: problem.rootCause ?? null,
    workaround: problem.workaround ?? null,
  };
}
