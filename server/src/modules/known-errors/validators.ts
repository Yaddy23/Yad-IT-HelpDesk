import { z } from 'zod';

import { KNOWN_ERROR_STATUSES, KNOWN_ERROR_VISIBILITIES } from '../problems/config.js';

const knownErrorStatusEnum = z.enum(KNOWN_ERROR_STATUSES);
const knownErrorVisibilityEnum = z.enum(KNOWN_ERROR_VISIBILITIES);

/** Params-only validation for routes that need just a known error id. */
export const knownErrorIdParamSchema = z.object({
  params: z.object({ id: z.string().min(1) }),
});

const commaList = (allowed: readonly string[]) =>
  z
    .string()
    .optional()
    .transform((v) =>
      v
        ? v
            .split(',')
            .map((s) => s.trim())
            .filter((s) => allowed.includes(s))
        : undefined,
    );

export const listKnownErrorsQuerySchema = z.object({
  query: z.object({
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().positive().max(100).default(20),
    sort: z.enum(['createdAt', 'updatedAt', 'status', 'reviewDueAt']).default('createdAt'),
    order: z.enum(['asc', 'desc']).default('desc'),
    search: z.string().max(120).optional(),
    status: commaList(KNOWN_ERROR_STATUSES),
    visibility: commaList(KNOWN_ERROR_VISIBILITIES),
    problemId: z.string().min(1).optional(),
    ownerId: z.string().min(1).optional(),
  }),
});

export const searchKnownErrorsQuerySchema = z.object({
  query: z.object({
    q: z.string().max(120).optional(),
    visibility: knownErrorVisibilityEnum.optional(),
    limit: z.coerce.number().int().positive().max(100).default(20),
  }),
});

export const createKnownErrorSchema = z.object({
  body: z.object({
    problemId: z.string().min(1),
    title: z.string().min(1).max(200),
    rootCause: z.string().min(1).max(10000),
    symptoms: z.string().min(1).max(10000),
    workaround: z.string().min(1).max(10000),
    resolutionNotes: z.string().max(10000).optional(),
    affectedServices: z.array(z.string()).optional(),
    affectedAssets: z.array(z.string()).optional(),
    affectedCIs: z.array(z.string()).optional(),
    visibility: knownErrorVisibilityEnum.optional(),
    ownerId: z.string().min(1).optional(),
  }),
});

export const updateKnownErrorSchema = z.object({
  params: z.object({ id: z.string().min(1) }),
  body: z.object({
    title: z.string().min(1).max(200).optional(),
    rootCause: z.string().min(1).max(10000).optional(),
    symptoms: z.string().min(1).max(10000).optional(),
    workaround: z.string().min(1).max(10000).optional(),
    resolutionNotes: z.string().max(10000).optional(),
    affectedServices: z.array(z.string()).optional(),
    affectedAssets: z.array(z.string()).optional(),
    affectedCIs: z.array(z.string()).optional(),
    visibility: knownErrorVisibilityEnum.optional(),
    ownerId: z.string().min(1).optional(),
  }),
});

export const transitionKnownErrorSchema = z.object({
  params: z.object({ id: z.string().min(1) }),
  body: z.object({
    status: knownErrorStatusEnum,
    reviewNotes: z.string().max(2000).optional(),
  }),
});

export const publishKnownErrorSchema = z.object({
  params: z.object({ id: z.string().min(1) }),
  body: z
    .object({
      visibility: knownErrorVisibilityEnum.optional(),
    })
    .default({}),
});
