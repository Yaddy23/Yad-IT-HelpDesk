import { Router } from 'express';
import { z } from 'zod';

import { requireAuth, requirePermission } from '../../core/auth.js';
import { prisma } from '../../prisma/client.js';

export const auditRouter = Router();
auditRouter.use(requireAuth, requirePermission('audit:read'));

auditRouter.get('/', async (req, res, next) => {
  try {
    const query = z
      .object({
        page: z.coerce.number().int().min(1).default(1),
        limit: z.coerce.number().int().min(1).max(200).default(50),
        action: z.string().max(80).optional(),
        actorId: z.string().max(60).optional(),
        targetType: z.string().max(60).optional(),
      })
      .parse(req.query);
    const where = {
      ...(query.action ? { action: { contains: query.action, mode: 'insensitive' as const } } : {}),
      ...(query.targetType ? { targetType: query.targetType } : {}),
      ...(query.actorId ? { actorId: query.actorId } : {}),
    };

    const [total, entries] = await Promise.all([
      prisma.auditLog.count({ where }),
      prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
        include: { actor: { select: { id: true, name: true, email: true } } },
      }),
    ]);
    res.json({ data: entries, page: query.page, pages: Math.ceil(total / query.limit) || 1, total });
  } catch (e) {
    next(e);
  }
});
