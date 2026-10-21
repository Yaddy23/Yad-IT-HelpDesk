import { Router } from 'express';
import { z } from 'zod';

import { recordAudit } from '../../core/audit.js';
import { requireAuth, requirePermission } from '../../core/auth.js';
import { prisma } from '../../prisma/client.js';
import { toAuthed } from '../../core/request.js';
import { DEFAULT_PRIORITY_MATRIX } from './priorityMatrix.js';

export const settingsRouter = Router();
settingsRouter.use(requireAuth);

const matrixSchema = z
  .object({
    high: z.object({ high: z.string(), medium: z.string(), low: z.string() }).partial(),
    medium: z.object({ high: z.string(), medium: z.string(), low: z.string() }).partial(),
    low: z.object({ high: z.string(), medium: z.string(), low: z.string() }).partial(),
  })
  .partial();

const updateSchema = z.object({
  body: z
    .object({
      priorityMatrix: matrixSchema,
      slaPauseStates: z.array(z.string().max(40)).max(20),
      reopenWindowDays: z.number().int().min(0).max(90),
      autoCloseResolvedDays: z.number().int().min(0).max(90),
      maxAutomationLoopDepth: z.number().int().min(1).max(20),
    })
    .partial(),
});

/** Singleton accessor — creates the row with defaults on first use. */
export async function getSystemSettings() {
  const existing = await prisma.systemSettings.findUnique({ where: { key: 'global' } });
  if (existing) return existing;
  return prisma.systemSettings.create({ data: { key: 'global', priorityMatrix: DEFAULT_PRIORITY_MATRIX as never } });
}

settingsRouter.get('/', requirePermission('settings:manage'), async (_req, res, next) => {
  try {
    const settings = await getSystemSettings();
    res.json({ data: { ...settings, defaultPriorityMatrix: DEFAULT_PRIORITY_MATRIX } });
  } catch (e) {
    next(e);
  }
});

settingsRouter.put('/', requirePermission('settings:manage'), async (req, res, next) => {
  try {
    const { body } = updateSchema.parse(req);
    const settings = await getSystemSettings();

    // Deep-merge the partial matrix over the current one.
    const mergedMatrix = {
      ...(DEFAULT_PRIORITY_MATRIX as object),
      ...(settings.priorityMatrix as object),
      ...(body.priorityMatrix ?? {}),
    };
    const updated = await prisma.systemSettings.update({
      where: { key: 'global' },
      data: {
        priorityMatrix: mergedMatrix as never,
        ...(body.slaPauseStates !== undefined ? { slaPauseStates: body.slaPauseStates } : {}),
        ...(body.reopenWindowDays !== undefined ? { reopenWindowDays: body.reopenWindowDays } : {}),
        ...(body.autoCloseResolvedDays !== undefined ? { autoCloseResolvedDays: body.autoCloseResolvedDays } : {}),
        ...(body.maxAutomationLoopDepth !== undefined ? { maxAutomationLoopDepth: body.maxAutomationLoopDepth } : {}),
        modifiedById: toAuthed(req).user?.id,
      },
    });

    await recordAudit({
      actorId: toAuthed(req).user?.id,
      actorEmail: toAuthed(req).user?.email,
      action: 'settings.updated',
      targetType: 'system_settings',
      targetId: 'global',
      before: { priorityMatrix: settings.priorityMatrix, reopenWindowDays: settings.reopenWindowDays },
      after: body as Record<string, unknown>,
      ip: req.ip,
    });
    res.json({ data: updated });
  } catch (e) {
    next(e);
  }
});
