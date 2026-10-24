import { z } from 'zod';

/**
 * Knowledge base validators.
 * Article body is z.string().min(20).max(50000)
 * Title z.string().min(5).max(200)
 * Summary .max(500).optional()
 * Tags z.array(z.string().min(1).max(40)).max(10)
 */

export const articleCreateSchema = z.object({
  body: z.object({
    title: z.string().min(5).max(200),
    summary: z.string().max(500).optional(),
    body: z.string().min(20).max(50000),
    category: z.string().min(1).max(80),
    tags: z.array(z.string().min(1).max(40)).max(10).default([]),
    visibility: z.enum(['public', 'internal', 'restricted']).default('internal'),
    allowedRoles: z.array(z.enum(['super_admin', 'it_admin', 'it_manager', 'it_technician', 'employee', 'approver'])).optional(),
    // status is deliberately omitted — a new article is always created as a draft
  }),
});

export const articleUpdateSchema = z.object({
  params: z.object({ id: z.string().min(1) }),
  body: articleCreateSchema.shape.body.partial(),
});

export const articleTransitionSchema = z.object({
  params: z.object({ id: z.string().min(1) }),
  body: z.object({
    status: z.enum(['in_review', 'published', 'archived']),
    version: z.number().int().positive(),
    changeNote: z.string().max(1000).optional(),
  }),
});

export const articleRestoreSchema = z.object({
  params: z.object({ id: z.string().min(1) }),
  body: z.object({
    version: z.number().int().positive(),
    revisionNumber: z.number().int().positive(),
    changeNote: z.string().max(1000).optional(),
  }),
});

export const listArticlesQuerySchema = z.object({
  q: z.string().optional(),
  category: z.string().optional(),
  status: z.enum(['draft', 'in_review', 'published', 'archived']).optional(),
  visibility: z.enum(['public', 'internal', 'restricted']).optional(),
  tag: z.string().optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

export const suggestArticlesQuerySchema = z.object({
  q: z.string().min(1),
  category: z.string().optional(),
  limit: z.coerce.number().int().positive().max(20).default(5),
});