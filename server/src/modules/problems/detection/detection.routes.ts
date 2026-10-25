/**
 * Detection API: the on-demand half of spec Section 9.
 *
 * Every route here is mounted at `/api/v1/problems` AHEAD of `problemsRouter`.
 * Express matches in registration order, so `problemsRouter`'s `GET /:id`
 * would otherwise swallow `GET /detect` and look up a problem whose id is the
 * literal string "detect".
 *
 * Guards are attached per route rather than with `router.use`, so a request
 * that matches nothing here falls through to `problemsRouter` untouched
 * instead of being rejected by this router's permissions.
 */

import { Router } from 'express';
import { z } from 'zod';

import { requireAuth, requirePermission } from '../../../core/auth.js';
import { recordAudit } from '../../../core/audit.js';
import { badRequest, notFound } from '../../../core/errors.js';
import { toAuthed } from '../../../core/request.js';
import { prisma } from '../../../prisma/client.js';
import { problemConfig } from '../config.js';
import { DETECTION_CRITERIA } from './criteria.js';
import { createProblemFromIncidents, findSimilarToProblem, scanWindow } from './detectionEngine.js';
import { explainIncidentAgainstProblem, incidentCriteriaFromTicket, problemCriteriaFromProblem } from './scoring.js';

export const detectionRouter = Router();

const MAX_WINDOW_HOURS = 24 * 7;

const detectQuerySchema = z.object({
  incidentId: z.string().min(1).optional(),
  windowHours: z.coerce.number().int().min(1).max(MAX_WINDOW_HOURS).optional(),
  threshold: z.coerce.number().min(0).max(100).optional(),
});

const similarQuerySchema = z.object({
  threshold: z.coerce.number().min(0).max(100).optional(),
});

const fromIncidentsSchema = z.object({
  incidentIds: z.array(z.string().min(1)).min(1).max(50),
});

const similarParamSchema = z.object({ params: z.object({ id: z.string().min(1) }) });

const suggestionIdSchema = z.string().min(1);

function windowStartFrom(hours: number): Date {
  return new Date(Date.now() - hours * 3_600_000);
}

/**
 * GET /api/v1/problems/detect
 * On-demand detection. Read-only by design — a GET must not write, so the
 * scheduled worker is the only thing that persists suggestions.
 *
 *   ?incidentId=...  → that incident ranked against open problems ("Find related")
 *   (no incidentId)  → the whole window, ranked
 */
detectionRouter.get('/detect', requireAuth, requirePermission('problems:read'), async (req, res, next) => {
  try {
    const query = detectQuerySchema.parse(req.query);
    const windowHours = query.windowHours ?? DETECTION_CRITERIA.windowHours;
    const threshold = query.threshold ?? (await problemConfig.detectionThreshold());

    if (query.incidentId) {
      const incident = await prisma.ticket.findUnique({
        where: { id: query.incidentId },
        select: { id: true, number: true, title: true, description: true, category: true, createdAt: true },
      });
      if (!incident) throw notFound('Incident not found');

      const problems = await prisma.problem.findMany({
        where: { deletedAt: null, status: { not: 'CLOSED' } },
        select: { id: true, number: true, title: true, description: true, affectedServices: true, affectedAssets: true, rootCause: true, workaround: true },
      });

      const incidentCriteria = incidentCriteriaFromTicket(incident);
      const matches = problems
        .map((problem) => {
          const { score, reasons } = explainIncidentAgainstProblem(incidentCriteria, problemCriteriaFromProblem(problem));
          return { problemId: problem.id, number: problem.number, title: problem.title, score, reasons };
        })
        .filter((match) => match.score >= threshold)
        .sort((a, b) => b.score - a.score);

      res.json({ data: { incident, matches }, meta: { threshold, matchCount: matches.length } });
      return;
    }

    const results = await scanWindow(windowStartFrom(windowHours), threshold);
    res.json({
      data: results,
      meta: { scanned: results.length, threshold, windowHours },
    });
  } catch (e) {
    next(e);
  }
});

/**
 * POST /api/v1/problems/from-incidents
 * Raise a problem from incidents a human selected, and link them to it.
 */
detectionRouter.post('/from-incidents', requireAuth, requirePermission('problems:create'), async (req, res, next) => {
  try {
    const actor = toAuthed(req).user!;
    const { incidentIds } = fromIncidentsSchema.parse(req.body ?? {});
    const problem = await createProblemFromIncidents(incidentIds, actor.id);
    res.status(201).json({ data: problem });
  } catch (e) {
    next(e);
  }
});

/**
 * GET /api/v1/problems/suggestions
 * Pending detection suggestions for review, tenant-wide: the review queue the
 * scheduled worker fills. Expired suggestions are hidden — they no longer
 * describe the live window and the next scan replaces them.
 */
detectionRouter.get('/suggestions', requireAuth, requirePermission('problems:read'), async (_req, res, next) => {
  try {
    const suggestions = await prisma.detectionSuggestion.findMany({
      where: { status: 'PENDING', expiresAt: { gt: new Date() } },
      orderBy: [{ score: 'desc' }, { createdAt: 'asc' }],
      take: 50,
    });

    // A suggestion stores only incident ids; reviewers decide from the rows.
    const incidentIds = [...new Set(suggestions.flatMap((s) => s.incidentIds))];
    const [incidents, problems] = await Promise.all([
      incidentIds.length
        ? prisma.ticket.findMany({
            where: { id: { in: incidentIds } },
            select: { id: true, number: true, title: true, status: true, category: true, createdAt: true },
          })
        : Promise.resolve([]),
      prisma.problem.findMany({
        where: { id: { in: suggestions.map((s) => s.problemId).filter((id): id is string => id !== null) } },
        select: { id: true, number: true, title: true, status: true },
      }),
    ]);
    const incidentsById = new Map(incidents.map((incident) => [incident.id, incident]));
    const problemsById = new Map(problems.map((problem) => [problem.id, problem]));

    res.json({
      data: suggestions.map((suggestion) => ({
        id: suggestion.id,
        problemId: suggestion.problemId,
        problem: suggestion.problemId ? problemsById.get(suggestion.problemId) ?? null : null,
        score: suggestion.score,
        matchReasons: suggestion.matchReasons,
        incidents: suggestion.incidentIds
          .map((id) => incidentsById.get(id))
          .filter((incident): incident is (typeof incidents)[number] => incident !== undefined),
        status: suggestion.status,
        createdAt: suggestion.createdAt,
        expiresAt: suggestion.expiresAt,
      })),
      meta: { count: suggestions.length },
    });
  } catch (e) {
    next(e);
  }
});

/**
 * POST /api/v1/problems/suggestions/:id/reject
 * Decline a suggestion: it leaves the queue and its incidents return to the
 * claimable pool on the next scan.
 */
detectionRouter.post('/suggestions/:id/reject', requireAuth, requirePermission('problems:update'), async (req, res, next) => {
  try {
    const id = suggestionIdSchema.parse(req.params.id);
    const actor = toAuthed(req).user!;
    const updated = await prisma.detectionSuggestion.updateMany({
      where: { id, status: 'PENDING' },
      data: { status: 'REJECTED', reviewedById: actor.id, reviewedAt: new Date() },
    });
    // updateMany over update: rejecting an already-answered suggestion is a
    // 409 (someone else got there first), not a Prisma P2025 404.
    if (updated.count === 0) {
      const exists = await prisma.detectionSuggestion.findUnique({ where: { id }, select: { status: true } });
      if (!exists) throw notFound('Suggestion not found');
      throw badRequest(`Suggestion is already ${exists.status.toLowerCase()}`);
    }
    await recordAudit({
      actorId: actor.id,
      action: 'problem.suggestion_rejected',
      targetType: 'DetectionSuggestion',
      targetId: id,
      ip: req.ip,
    });
    res.json({ data: { id, status: 'REJECTED' } });
  } catch (e) {
    next(e);
  }
});

/**
 * GET /api/v1/problems/:id/similar
 * Duplicate prevention: problems that already look like this one.
 */
detectionRouter.get('/:id/similar', requireAuth, requirePermission('problems:read'), async (req, res, next) => {
  try {
    const { params } = similarParamSchema.parse({ params: req.params });
    const query = similarQuerySchema.parse(req.query);
    const similar = await findSimilarToProblem(params.id, query.threshold);
    res.json({ data: similar, meta: { count: similar.length } });
  } catch (e) {
    next(e);
  }
});
