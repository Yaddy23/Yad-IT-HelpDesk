import { z } from 'zod';

import { PROBLEM_STATUSES } from './config.js';

const problemPriorityEnum = z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']);
const rcaTypeEnum = z.enum(['FIVE_WHYS', 'FISHBONE', 'NONE']);

/** Params-only validation for routes that need just a problem id. */
export const problemIdParamSchema = z.object({
  params: z.object({ id: z.string().min(1) }),
});

export const createProblemSchema = z.object({
  body: z.object({
    title: z.string().min(3).max(200),
    description: z.string().min(1).max(10000),
    ownerId: z.string().min(1).optional(),
    priority: problemPriorityEnum.default('MEDIUM'),
    affectedServices: z.array(z.string()).default([]),
    affectedAssets: z.array(z.string()).default([]),
    affectedCIs: z.array(z.string()).default([]),
    businessImpact: z.string().max(10000).optional(),
    rcaType: rcaTypeEnum.optional(),
  }),
});

export const updateProblemSchema = z.object({
  params: z.object({ id: z.string().min(1) }),
  body: z.object({
    title: z.string().min(1).max(200).optional(),
    description: z.string().min(1).max(10000).optional(),
    priority: problemPriorityEnum.optional(),
    ownerId: z.string().min(1).optional(),
    affectedServices: z.array(z.string()).optional(),
    affectedAssets: z.array(z.string()).optional(),
    affectedCIs: z.array(z.string()).optional(),
    businessImpact: z.string().max(10000).optional(),
    rcaType: rcaTypeEnum.optional(),
    // Optimistic locking
    version: z.number().int().positive().optional(),
  }),
});

export const listProblemsQuerySchema = z.object({
  query: z.object({
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().positive().max(100).default(20),
    sort: z.enum(['identifiedAt', 'updatedAt', 'priority', 'status']).default('identifiedAt'),
    order: z.enum(['asc', 'desc']).default('desc'),
    search: z.string().max(120).optional(),
    status: z
      .string()
      .optional()
      .transform((v) =>
        v
          ? v.split(',').map((s) => s.trim()).filter((s) => (PROBLEM_STATUSES as readonly string[]).includes(s))
          : undefined,
      ),
    priority: z
      .string()
      .optional()
      .transform((v) =>
        v
          ? v.split(',').map((s) => s.trim()).filter((s) => ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].includes(s))
          : undefined,
      ),
    ownerId: z.string().min(1).optional(),
    affectedService: z.string().max(80).optional(),
    // Date-only ("2026-01-01") or full ISO — the dashboard KPI range picker
    // sends the former; Date.parse handles both.
    identifiedAfter: z
      .string()
      .refine((v) => !Number.isNaN(Date.parse(v)), 'Invalid date')
      .optional(),
    identifiedBefore: z
      .string()
      .refine((v) => !Number.isNaN(Date.parse(v)), 'Invalid date')
      .optional(),
  }),
});

export const transitionStatusSchema = z.object({
  params: z.object({ id: z.string().min(1) }),
  body: z.object({
    status: z.enum(PROBLEM_STATUSES),
    // Extra fields for specific transitions
    verifiedFix: z.boolean().optional(),
    resolutionSummary: z.string().max(10000).optional(),
    exceptionReason: z.string().max(10000).optional(),
  }),
});

export const updateRCASchema = z.object({
  params: z.object({ id: z.string().min(1) }),
  body: z.object({
    rootCause: z.string().optional(),
    resolutionSummary: z.string().optional(),
    rcaNotes: z.string().optional(),
    fiveWhys: z.unknown().optional(),
    fishbone: z.unknown().optional(),
    confirmedRootCause: z.boolean().optional(),
    rcaType: rcaTypeEnum.optional(),
  }),
});

export const linkIncidentsSchema = z.object({
  params: z.object({ id: z.string().min(1) }),
  body: z.object({
    incidentIds: z.array(z.string().min(1)).min(1),
    note: z.string().max(1000).optional(),
  }),
});

export const unlinkIncidentSchema = z.object({
  params: z.object({ id: z.string().min(1), incidentId: z.string().min(1) }),
  body: z.object({}),
});

export const setWorkaroundSchema = z.object({
  params: z.object({ id: z.string().min(1) }),
  body: z.object({
    workaround: z.string().min(1),
  }),
});

export const linkChangeRequestSchema = z.object({
  params: z.object({ id: z.string().min(1) }),
  body: z.object({
    // Opaque external id (same bound as the change-event webhook) — it lands
    // in array-contains queries and notification copy.
    changeId: z.string().min(1).max(120),
  }),
});

export const unlinkChangeRequestSchema = z.object({
  params: z.object({ id: z.string().min(1), changeId: z.string().min(1) }),
  body: z.object({}),
});

/**
 * Inbound change event (spec Section 5.4). There is no change-management
 * module here — an external change system would post to this webhook seam.
 * The consumer validates the event name itself and ignores unknowns, so the
 * schema only pins the transport shape.
 */
export const changeEventSchema = z.object({
  body: z.object({
    event: z.string().min(1),
    // Opaque external id, but bounded: it lands in a Prisma array-contains
    // query and in notification copy.
    changeId: z.string().min(1).max(120),
    status: z.string().max(120).optional(),
    title: z.string().max(500).optional(),
  }),
});

export const getAuditLogSchema = z.object({
  params: z.object({ id: z.string().min(1) }),
  query: z.object({
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().positive().max(100).default(50),
  }),
});