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
});