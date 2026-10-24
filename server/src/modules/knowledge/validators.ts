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
  params: z.object({ id: z.string().min(1), revisionNumber: z.number().int().positive() }),
  body: z.object({}),
});export const articleCreateSchema = z.object({
  params: z.object({}),
  body: z.object({
    title: z.string().min(1),
    summary: z.string().optional(),
    body: z.string(),
    category: z.string(),
    tags: z.array(z.string()),
    visibility: z.nativeEnum(KnowledgeVisibility),
  }),
});

export const articleUpdateSchema = z.object({
  params: z.object({ id: z.string().min(1) }),
  body: z.object({
    title: z.string().optional(),
    summary: z.string().optional(),
    body: z.string().optional(),
    category: z.string().optional(),
    tags: z.array(z.string()).optional(),
    visibility: z.nativeEnum(KnowledgeVisibility).optional(),
  }),
});
