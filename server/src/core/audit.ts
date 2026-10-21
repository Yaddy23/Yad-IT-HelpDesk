import { logger } from './logger.js';
import { prisma } from '../prisma/client.js';

export interface AuditEntry {
  actorId?: string | null;
  actorEmail?: string | null;
  action: string; // e.g. 'auth.login', 'user.created', 'settings.updated'
  targetType?: string;
  targetId?: string;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  meta?: Record<string, unknown>;
  ip?: string;
}

/**
 * Append-only audit trail. Security-sensitive operations MUST call this.
 * Audit failures are logged but never crash the business operation.
 */
export async function recordAudit(entry: AuditEntry): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        actorId: entry.actorId ?? undefined,
        actorEmail: entry.actorEmail ?? undefined,
        action: entry.action,
        targetType: entry.targetType,
        targetId: entry.targetId,
        before: entry.before === null ? undefined : (entry.before as never),
        after: entry.after === null ? undefined : (entry.after as never),
        meta: entry.meta as never,
        ip: entry.ip,
      },
    });
  } catch (err) {
    logger.error(`[audit] FAILED to record action "${entry.action}"`, err);
  }
}
