import { Prisma } from '@prisma/client';

import { logger } from '../../core/logger.js';
import { emitToUser } from '../../core/socket.js';
import { prisma } from '../../prisma/client.js';

/**
 * In-app notification inbox. Delivery-time dedupe: a `dedupeKey` is unique in
 * the DB, so a retried job or racing sweep can never create a duplicate —
 * the insert is simply swallowed. Successful inserts fan out to the user's
 * live socket room and (opt-in) email.
 */

export interface NotificationPayload {
  userId: string;
  type: string;
  title: string;
  body: string;
  ticketId?: string | null;
  dedupeKey?: string | null;
}

export interface NotificationDTO {
  id: string;
  userId: string;
  type: string;
  title: string;
  body: string;
  ticketId: string | null;
  readAt: Date | null;
  createdAt: Date;
}

/** Side effects for a freshly persisted notification (never throws). */
async function deliver(row: NotificationDTO): Promise<void> {
  emitToUser(row.userId, 'notification', row);
  try {
    const prefs = await prisma.notificationPreference.findUnique({ where: { userId: row.userId } });
    if (!prefs?.email) return;
    if (row.type === 'sla.breach' && !prefs.slaBreaches) return;
    if (row.type === 'sla.warning' && !prefs.slaWarnings) return;
    if (!row.type.startsWith('sla.') && !prefs.ticketUpdate) return;
    const user = await prisma.user.findUnique({ where: { id: row.userId }, select: { email: true } });
    if (!user) return;
    // Dynamic import: the scheduler imports the SLA service, which imports
    // this module — resolving lazily keeps the cycle harmless.
    const { enqueueEmail } = await import('../../jobs/scheduler.js');
    await enqueueEmail({ to: user.email, subject: row.title, body: row.body });
  } catch (err) {
    logger.error('[notifications] delivery side-effect failed', err);
  }
}

export async function createNotification(payload: NotificationPayload): Promise<void> {
  let row: NotificationDTO;
  try {
    row = await prisma.notification.create({
      data: {
        userId: payload.userId,
        type: payload.type,
        title: payload.title,
        body: payload.body,
        ticketId: payload.ticketId ?? undefined,
        dedupeKey: payload.dedupeKey ?? undefined,
      },
      select: { id: true, userId: true, type: true, title: true, body: true, ticketId: true, readAt: true, createdAt: true },
    });
  } catch (err) {
    // Unique dedupeKey → this logical event already delivered; not an error.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') return;
    throw err;
  }
  await deliver(row);
}

/** One notification per user holding the role, deduped per logical event. */
export async function notifyRole(
  role: 'it_manager' | 'it_admin' | 'super_admin',
  payload: Omit<NotificationPayload, 'userId' | 'dedupeKey'> & { dedupeKey?: string },
): Promise<void> {
  const users = await prisma.userRole.findMany({
    where: { role },
    select: { userId: true },
  });
  await Promise.all(
    users.map((u) =>
      createNotification({
        ...payload,
        userId: u.userId,
        dedupeKey: payload.dedupeKey ? `${payload.dedupeKey}:${u.userId}` : undefined,
      }),
    ),
  );
}

export async function listNotifications(userId: string, opts: { unreadOnly?: boolean; limit?: number } = {}) {
  const limit = Math.min(Math.max(opts.limit ?? 25, 1), 100);
  const rows = await prisma.notification.findMany({
    where: { userId, ...(opts.unreadOnly ? { readAt: null } : {}) },
    orderBy: { createdAt: 'desc' },
    take: limit,
    select: { id: true, type: true, title: true, body: true, ticketId: true, readAt: true, createdAt: true },
  });
  return rows;
}

export async function unreadCount(userId: string): Promise<number> {
  return prisma.notification.count({ where: { userId, readAt: null } });
}

export async function markRead(userId: string, id: string): Promise<void> {
  // scoped by userId — a user can only mark their own notifications
  await prisma.notification.updateMany({ where: { id, userId }, data: { readAt: new Date() } });
}

export async function markAllRead(userId: string): Promise<number> {
  const res = await prisma.notification.updateMany({ where: { userId, readAt: null }, data: { readAt: new Date() } });
  return res.count;
}

/* ── Preferences ───────────────────────────────────────────────────────────── */

export async function getPreferences(userId: string) {
  const existing = await prisma.notificationPreference.findUnique({ where: { userId } });
  if (existing) return existing;
  return prisma.notificationPreference.create({ data: { userId } });
}

export async function updatePreferences(
  userId: string,
  patch: Partial<{ inApp: boolean; email: boolean; slaWarnings: boolean; slaBreaches: boolean; ticketUpdate: boolean }>,
) {
  await getPreferences(userId); // ensure the row exists
  return prisma.notificationPreference.update({ where: { userId }, data: patch });
}
