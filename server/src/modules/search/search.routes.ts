import { Router } from 'express';
import { z } from 'zod';

import { requireAuth, requirePermission } from '../../core/auth.js';
import { toAuthed } from '../../core/request.js';
import { globalSearch } from './search.service.js';

export const searchRouter = Router();

const searchSchema = z.object({
  query: z.object({
    q: z.string().trim().min(2, 'Query must be at least 2 characters').max(100),
    limit: z.coerce.number().int().min(1).max(20).default(10),
  }),
});

// Reading search results implies reading tickets within one's scope.
searchRouter.use(requireAuth, requirePermission('tickets:read'));

searchRouter.get('/', async (req, res, next) => {
  try {
    const parsed = searchSchema.parse({ query: req.query });
    const results = await globalSearch(toAuthed(req).user!, parsed.query.q, parsed.query.limit);    res.json({ data: results });
  } catch (e) {
    next(e);
  }
});
