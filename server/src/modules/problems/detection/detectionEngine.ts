/**
 * Detection engine: turns a window of open incidents into suggestions a human
 * reviews, or into a new problem raised from a set of incidents they picked.
 *
 * Scoring lives in `scoring.ts` (pure, DB-free). This module owns the database
 * and splits cleanly in two: `scanWindow` reads and ranks, `runDetection`
 * persists what `scanWindow` found. The API's on-demand "find related" uses the
 * read half, so a GET never writes.
 */

import type { DetectionSuggestion, Prisma, Problem } from '@prisma/client';

import { recordAudit } from '../../../core/audit.js';
import { badRequest, notFound } from '../../../core/errors.js';
import { logger } from '../../../core/logger.js';
import { emitToUser } from '../../../core/socket.js';
import { prisma } from '../../../prisma/client.js';
import { generateProblemNumber } from '../numberGenerator.js';
import { problemConfig } from '../config.js';
import { DETECTION_CRITERIA, MATCH_REASONS } from './criteria.js';
import {
  explainIncidentAgainstProblem,
  findSimilarProblems,
  incidentCriteriaFromTicket,
  problemCriteriaFromProblem,
  timePatternBoost,
} from './scoring.js';

/** Upper bound on incidents scored per run — a scan must not become a table walk. */
const MAX_SCAN_INCIDENTS = 500;

/** Ticket statuses that mean the incident is still live. */
const OPEN_TICKET_STATUSES = ['new', 'in_progress', 'pending_employee', 'pending_vendor'] as const;

const problemSelect = {
  id: true,
  number: true,
  title: true,
  description: true,
  status: true,
  ownerId: true,
  affectedServices: true,
  affectedAssets: true,
  rootCause: true,
  workaround: true,
} as const;

const incidentSelect = {
  id: true,
  number: true,
  title: true,
  description: true,
  category: true,
  createdAt: true,
} as const;

/** The problem columns the engine actually reads — narrower than the full row. */
type ProblemRow = Prisma.ProblemGetPayload<{ select: typeof problemSelect }>;

type IncidentRow = Prisma.TicketGetPayload<{ select: typeof incidentSelect }>;

export interface IncidentMatch {
  problemId: string;
  number: string;
  title: string;
  score: number;
  reasons: string[];
}

/** One incident and every problem it resembles, best first. */
export interface IncidentMatches {
  incident: IncidentRow;
  matches: IncidentMatch[];
}

/**
 * Incidents worth scoring: new enough, still open, and not already spoken for.
 *
 * Already-linked incidents and incidents sitting in a live suggestion are
 * dropped — otherwise the review queue refills with the same rows every
 * interval and a reviewer learns to ignore it.
 */
async function loadScanContext(windowStart: Date): Promise<{ problems: ProblemRow[]; incidents: IncidentRow[] }> {
  const problems = await prisma.problem.findMany({
    where: { deletedAt: null, status: { not: 'CLOSED' } },
    select: problemSelect,
  });
  if (problems.length === 0) return { problems, incidents: [] };

  const [linked, pending] = await Promise.all([
    prisma.problemIncident.findMany({ select: { incidentId: true } }),
    prisma.detectionSuggestion.findMany({
      where: { status: 'PENDING', expiresAt: { gt: new Date() } },
      select: { incidentIds: true },
    }),
  ]);
  const claimed = new Set(linked.map((row) => row.incidentId));
  for (const suggestion of pending) for (const id of suggestion.incidentIds) claimed.add(id);

  const candidates = await prisma.ticket.findMany({
    where: { createdAt: { gte: windowStart }, status: { in: [...OPEN_TICKET_STATUSES] } },
    select: incidentSelect,
    orderBy: { createdAt: 'desc' },
    take: MAX_SCAN_INCIDENTS,
  });

  return { problems, incidents: candidates.filter((incident) => !claimed.has(incident.id)) };
}

/** Rank every candidate incident against every open problem, above `threshold`. */
function rankIncidents(
  problems: ProblemRow[],
  incidents: IncidentRow[],
  threshold: number,
): Map<string, IncidentMatches> {
  const criteria = problems.map((problem) => ({ problem, criteria: problemCriteriaFromProblem(problem) }));
  const ranked = new Map<string, IncidentMatches>();

  for (const incident of incidents) {
    const incidentCriteria = incidentCriteriaFromTicket(incident);
    const matches: IncidentMatch[] = [];
    for (const { problem, criteria: problemCriteria } of criteria) {
      const { score, reasons } = explainIncidentAgainstProblem(incidentCriteria, problemCriteria);
      if (score < threshold) continue;
      matches.push({ problemId: problem.id, number: problem.number, title: problem.title, score, reasons });
    }
    matches.sort((a, b) => b.score - a.score);
    ranked.set(incident.id, { incident, matches });
  }
  return ranked;
}

/**
 * Read-only scan: what the detection window looks like right now. Persists
 * nothing, so it is safe behind a GET and safe to call as often as a user
 * clicks.
 */
export async function scanWindow(windowStart: Date, threshold?: number): Promise<IncidentMatches[]> {
  const limit = threshold ?? (await problemConfig.detectionThreshold());
  const { problems, incidents } = await loadScanContext(windowStart);
  if (problems.length === 0 || incidents.length === 0) return [];
  return [...rankIncidents(problems, incidents, limit).values()];
}

/**
 * Scan the window and persist a suggestion for every group worth a human's
 * attention.
 *
 * Each incident is assigned to at most ONE problem — its best-scoring one — so
 * two similar problems cannot both claim it. Incidents matching no problem are
 * grouped by category, and a cluster of `patternMinIncidents` or more becomes a
 * suggestion with no `problemId`: "this looks like a new problem".
 *
 * Returns the suggestions created by this run (an empty array is a normal,
 * quiet result).
 */
export async function runDetection(windowStart: Date): Promise<DetectionSuggestion[]> {
  const threshold = await problemConfig.detectionThreshold();

  if (await problemConfig.autoCreateEnabled()) {
    // Ruling (SDD ledger): auto-create is deferred. Creating a problem with no
    // human actor would mean inventing a system user the spec never defines, or
    // assigning ownership arbitrarily. The engine always suggests; a person
    // accepts. Logged rather than silently ignored so the flag is not a lie.
    logger.warn('[problems] PROBLEM_AUTO_CREATE_ENABLED is on but auto-creation is not implemented — suggestions will be created for review');
  }

  const { problems, incidents } = await loadScanContext(windowStart);
  if (problems.length === 0 || incidents.length === 0) return [];

  const ranked = rankIncidents(problems, incidents, threshold);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + DETECTION_CRITERIA.suggestionTtlDays * 86_400_000);
  const created: DetectionSuggestion[] = [];

  // One suggestion per problem, carrying every incident that chose it.
  const byProblem = new Map<string, { incidentIds: string[]; score: number; reasons: Set<string> }>();
  for (const { incident, matches } of ranked.values()) {
    const best = matches[0];
    if (!best) continue;
    const group = byProblem.get(best.problemId) ?? { incidentIds: [], score: 0, reasons: new Set<string>() };
    group.incidentIds.push(incident.id);
    group.score = Math.max(group.score, best.score);
    for (const reason of best.reasons) group.reasons.add(reason);
    byProblem.set(best.problemId, group);
  }
  for (const [problemId, group] of byProblem) {
    created.push(
      await prisma.detectionSuggestion.create({
        data: {
          incidentIds: group.incidentIds,
          problemId,
          score: group.score,
          matchReasons: [...group.reasons],
          expiresAt,
        },
      }),
    );
  }

  // Unmatched incidents, clustered by category: several reports of the same
  // kind with no problem to hang them on is the strongest "start a problem"
  // signal the data can carry.
  const unclaimed = [...ranked.values()].filter((entry) => entry.matches.length === 0);
  const byCategory = new Map<string, IncidentRow[]>();
  for (const { incident } of unclaimed) {
    const bucket = byCategory.get(incident.category) ?? [];
    bucket.push(incident);
    byCategory.set(incident.category, bucket);
  }
  for (const [category, bucket] of byCategory) {
    const boost = timePatternBoost(bucket, category, now);
    if (boost === 0) continue;
    created.push(
      await prisma.detectionSuggestion.create({
        data: {
          incidentIds: bucket.map((incident) => incident.id),
          problemId: null,
          score: Math.min(100, threshold + boost),
          matchReasons: [MATCH_REASONS.timePattern],
          expiresAt,
        },
      }),
    );
  }

  if (created.length > 0) {
    logger.info(`[problems] detection created ${created.length} suggestion(s) from ${incidents.length} incident(s)`);
  }
  return created;
}

/**
 * Raise a problem from a set of incidents a human selected, and link them to it.
 *
 * Rejects incidents already linked to a DIFFERENT problem: `ProblemIncident` is
 * unique per (problem, incident), so without this check the same incident could
 * be filed under two problems and both would look authoritative.
 */
export async function createProblemFromIncidents(incidentIds: string[], actorId: string): Promise<Problem> {
  const unique = [...new Set(incidentIds)];
  if (unique.length === 0) throw badRequest('At least one incident is required');

  const incidents = await prisma.ticket.findMany({
    where: { id: { in: unique } },
    select: incidentSelect,
    orderBy: { createdAt: 'asc' },
  });
  if (incidents.length !== unique.length) throw badRequest('One or more incidents were not found');

  const alreadyLinked = await prisma.problemIncident.findMany({
    where: { incidentId: { in: unique } },
    select: { incidentId: true, problem: { select: { number: true } } },
  });
  if (alreadyLinked.length > 0) {
    const numbers = [...new Set(alreadyLinked.map((row) => row.problem.number))].join(', ');
    throw badRequest(`Incident(s) already linked to ${numbers}`);
  }

  // The earliest report names the problem: it is the one a human read first.
  const lead = incidents[0];
  const categories = [...new Set(incidents.map((incident) => incident.category).filter(Boolean))];
  const incidentNumbers = incidents.map((incident) => incident.number).join(', ');

  const problem = await prisma.$transaction(async (tx) => {
    const number = await generateProblemNumber(tx);
    return tx.problem.create({
      data: {
        number,
        title: lead.title,
        description: `Raised from ${incidents.length} related incident(s): ${incidentNumbers}\n\n${lead.description}`,
        ownerId: actorId,
        affectedServices: categories,
        affectedAssets: [],
        affectedCIs: [],
        businessImpact: '',
        detectionSource: 'MANUAL',
        incidents: {
          create: incidents.map((incident) => ({
            incidentId: incident.id,
            linkedById: actorId,
            note: 'Linked when the problem was created from these incidents',
          })),
        },
      },
    });
  });

  // Any live suggestion covering these incidents has been answered by the act
  // of creating the problem — leaving it pending would ask the reviewer twice.
  await prisma.detectionSuggestion.updateMany({
    where: { status: 'PENDING', incidentIds: { hasSome: unique } },
    data: { status: 'ACCEPTED', reviewedById: actorId, reviewedAt: new Date() },
  });

  await recordAudit({
    actorId,
    action: 'problem.created_from_incidents',
    targetType: 'Problem',
    targetId: problem.id,
    after: { number: problem.number, incidentIds: unique },
  });
  emitToUser(actorId, 'problem:created', { problemId: problem.id, number: problem.number, title: problem.title });

  return problem;
}

/**
 * Problems that already look like this one — the duplicate check a person runs
 * before filing. Returns the scored problems, best first.
 */
export async function findSimilarToProblem(
  problemId: string,
  threshold?: number,
): Promise<Array<{ problem: ProblemRow; score: number; reasons: string[] }>> {
  const source = await prisma.problem.findFirst({ where: { id: problemId, deletedAt: null }, select: problemSelect });
  // An empty list would be indistinguishable from "this problem does not
  // exist", so the missing case is an error, not a quiet success.
  if (!source) throw notFound('Problem not found');

  const others = await prisma.problem.findMany({
    where: { id: { not: problemId }, deletedAt: null, status: { not: 'CLOSED' } },
    select: problemSelect,
  });
  if (others.length === 0) return [];

  // A problem carries no "symptoms" of its own, so its title and description
  // stand in as the text an incident would have carried.
  const asIncident = incidentCriteriaFromTicket({
    category: source.affectedServices[0] ?? null,
    title: source.title,
    description: source.description,
  });

  return findSimilarProblems(asIncident, others, threshold);
}
