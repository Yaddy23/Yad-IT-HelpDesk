import { Router } from 'express';
import { z } from 'zod';

import { requireAuth } from '../../core/auth.js';
import { toAuthed } from '../../core/request.js';
import {
  getPreferences,
  listNotifications,
  markAllRead,
  markRead,
  unreadCount,
  updatePreferences,
} from './notifications.service.js';

export const notificationsRouter = Router();
notificationsRouter.use(requireAuth);

const listSchema = z.object({
  query: z.object({
    unread: z
      .enum(['true', 'false'])
      .optional()
      .transform((v) => v === 'true'),
    limit: z.coerce.number().int().min(1).max(100).default(25),
  }),
});

notificationsRouter.get('/', async (req, res, next) => {
  try {
    const parsed = listSchema.parse({ query: req.query });
    const userId = toAuthed(req).user!.id;
    const [items, unread] = await Promise.all([
      listNotifications(userId, parsed.query),
      unreadCount(userId),
    ]);
    res.json({ data: { items, unread } });
  } catch (e) {
    next(e);
  }
});

notificationsRouter.get('/unread-count', async (req, res, next) => {
  try {
    const count = await unreadCount(toAuthed(req).user!.id);
    res.json({ data: { count } });
  } catch (e) {
    next(e);
  }
});

const readSchema = z.object({
  params: z.object({ id: z.string().min(1) }),
});

const prefsSchema = z.object({
  body: z
    .object({
      inApp: z.boolean(),
      email: z.boolean(),
      slaWarnings: z.boolean(),
      slaBreaches: z.boolean(),
      ticketUpdate: z.boolean(),
    })
    .partial(),
});

notificationsRouter.get('/preferences', async (req, res, next) => {
  try {
    const prefs = await getPreferences(toAuthed(req).user!.id);
    res.json({ data: prefs });
  } catch (e) {
    next(e);
  }
});

notificationsRouter.put('/preferences', async (req, res, next) => {
  try {
    const parsed = prefsSchema.parse({ body: req.body });
    const prefs = await updatePreferences(toAuthed(req).user!.id, parsed.body);
    res.json({ data: prefs });
  } catch (e) {
    next(e);
  }
});

notificationsRouter.post('/:id/read', async (req, res, next) => {
  try {
    const parsed = readSchema.parse({ params: req.params });
    await markRead(toAuthed(req).user!.id, parsed.params.id);
    res.json({ data: { ok: true } });
  } catch (e) {
    next(e);
  }
});

notificationsRouter.post('/read-all', async (req, res, next) => {
  try {
    const updated = await markAllRead(toAuthed(req).user!.id);
    res.json({ data: { updated } });
  } catch (e) {
    next(e);
  }
});
