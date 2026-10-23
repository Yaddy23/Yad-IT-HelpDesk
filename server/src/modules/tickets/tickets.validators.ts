import { z } from 'zod';

import { IMPACT_LEVELS, PRIORITIES, URGENCY_LEVELS } from '../settings/priorityMatrix.js';
import { TICKET_STATUSES } from './tickets.statuses.js';

const impactEnum = z.enum(IMPACT_LEVELS);
const urgencyEnum = z.enum(URGENCY_LEVELS);
const priorityEnum = z.enum(PRIORITIES);

export const createTicketSchema = z.object({
  body: z.object({
    title: z.string().min(5).max(200),
    description: z.string().min(10).max(10_000),
    category: z.string().min(2).max(80),
    impact: impactEnum,
    urgency: urgencyEnum,
    /** Agents may file on behalf of someone else; employees always self-request. */
    requesterId: z.string().min(1).optional(),
    groupId: z.string().min(1).optional(),
  }),
});

export const listTicketsSchema = z.object({
  query: z.object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(25),
    queue: z.enum(['unassigned', 'my', 'group', 'mine', 'all']).default('all'),
    status: z
      .string()
      .optional()
      .transform((v) =>
        v
          ? v
              .split(',')
              .map((s) => s.trim())
              .filter((s): s is (typeof TICKET_STATUSES)[number] =>
                (TICKET_STATUSES as readonly string[]).includes(s),
              )
          : undefined,
      ),
    priority: z
      .string()
      .optional()
      .transform((v) =>
        v
          ? v
              .split(',')
              .map((s) => s.trim())
              .filter((s): s is (typeof PRIORITIES)[number] => (PRIORITIES as readonly string[]).includes(s))
          : undefined,
      ),
    category: z.string().max(80).optional(),
    q: z.string().max(120).optional(),
    /** Dashboard deep-link: only tickets with an SLA instance at risk. */
    sla: z.enum(['at_risk']).optional(),
    sort: z.enum(['newest', 'oldest', 'priority']).default('newest'),
  }),
});

export const assignTicketSchema = z.object({
  params: z.object({ id: z.string().min(1) }),
  body: z
    .object({
      assigneeId: z.string().min(1).optional(),
      groupId: z.string().min(1).optional(),
      note: z.string().max(500).optional(),
    })
    .refine((b) => b.assigneeId || b.groupId, { message: 'Provide assigneeId and/or groupId' }),
});

export const transitionTicketSchema = z.object({
  params: z.object({ id: z.string().min(1) }),
  body: z.object({
    status: z.enum(['in_progress', 'pending_employee', 'pending_vendor', 'resolved', 'closed', 'canceled']),
    resolutionNote: z.string().max(10_000).optional(),
    version: z.number().int().positive(),
  }),
});

export const overridePrioritySchema = z.object({
  params: z.object({ id: z.string().min(1) }),
  body: z
    .object({
      impact: impactEnum.optional(),
      urgency: urgencyEnum.optional(),
      priority: priorityEnum.optional(),
      reason: z.string().min(3).max(500),
    })
    .refine((b) => b.impact || b.urgency || b.priority, {
      message: 'Provide impact/urgency to recompute, or an explicit priority',
    }),
});

export const addCommentSchema = z.object({
  params: z.object({ id: z.string().min(1) }),
  body: z.object({
    body: z.string().min(1).max(10_000),
    isInternal: z.boolean().optional().default(false),
  }),
});
