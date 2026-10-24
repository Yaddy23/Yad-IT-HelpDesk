import { z } from 'zod';

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
  q: z.string().optional(),
  category: z.string().optional(),
  limit: z.coerce.number().int().positive().max(50).default(10),
});

export const articleCreateSchema = z.object({
  title: z.string().min(1),
  summary: z.string().optional().nullable(),
  body: z.string(),
  category: z.string(),
  tags: z.array(z.string()),
  visibility: z.enum(['public', 'internal', 'restricted']),
});

export const articleUpdateSchema = z.object({
  params: z.object({ id: z.string().min(1) }),
  body: z.object({
    title: z.string().optional(),
    summary: z.string().optional().nullable(),
    body: z.string().optional(),
    category: z.string().optional(),
    tags: z.array(z.string()).optional(),
    visibility: z.enum(['public', 'internal', 'restricted']).optional(),
    version: z.number().int().positive(),
  }),
});

export const articleSubmitSchema = z.object({
  params: z.object({ id: z.string().min(1) }),
  body: z.object({}),
});

export const articlePublishSchema = z.object({
  params: z.object({ id: z.string().min(1) }),
  body: z.object({}),
});

export const articleRejectSchema = z.object({
  params: z.object({ id: z.string().min(1) }),
  body: z.object({
    note: z.string().min(5).max(1000),
  }),
});

export const articleArchiveSchema = z.object({
  params: z.object({ id: z.string().min(1) }),
  body: z.object({}),
});

export const articleRestoreArticleSchema = z.object({
  params: z.object({ id: z.string().min(1) }),
  body: z.object({}),
});

export const revisionRestoreSchema = z.object({
  params: z.object({ id: z.string().min(1), revisionNumber: z.coerce.number().int().positive() }),
  body: z.object({}),
});
