/**
 * Change integration (spec Section 5.4): status awareness without coupling.
 *
 * There is no change-management module and no event bus in this codebase —
 * `Problem.changeRequestIds` holds opaque external change ids — and the spec
 * says that is the intent ("no tight coupling", and its test plan calls for
 * "mock events"). So this module is the seam: whatever owns changes calls
 * `handleChangeEvent` directly, and a test can call it with a mock payload.
 *
 * Nothing here transitions a problem. The spec offers a reopen on rollback
 * rather than performing one, and lists automatic lifecycle coupling with
 * Change Management as an explicit non-goal — a human makes the move.
 */

import { logger } from '../../core/logger.js';
import { prisma } from '../../prisma/client.js';
import { createNotification } from '../notifications/notifications.service.js';

/** The change events a problem cares about (spec Section 5.4). */
export const CHANGE_EVENTS = [
  'change.approved',
  'change.implemented',
  'change.rejected',
  'change.rolled_back',
] as const;

export type ChangeEvent = (typeof CHANGE_EVENTS)[number];

export interface ChangeEventPayload {
  /** The external change request id, as stored in `Problem.changeRequestIds`. */
  changeId: string;
  status?: string;
  title?: string;
}

interface Copy {
  /** Notification `type` — a free String column, not an enum. */
  type: string;
  title: string;
  body: (problemNumber: string, changeId: string) => string;
}

const COPY: Record<ChangeEvent, Copy> = {
  'change.approved': {
    type: 'CHANGE_APPROVED',
    title: 'Change request approved',
    body: (problem, change) =>
      `Change ${change} linked to problem ${problem} was approved. The permanent fix can now be implemented.`,
  },
  'change.implemented': {
    type: 'CHANGE_IMPLEMENTED',
    title: 'Change request implemented',
    body: (problem, change) =>
      `Change ${change} linked to problem ${problem} has been implemented. Please verify the fix stops the recurring incidents before resolving the problem.`,
  },
  'change.rejected': {
    type: 'CHANGE_REJECTED',
    title: 'Change request rejected',
    body: (problem, change) =>
      `Change ${change} linked to problem ${problem} was rejected. The problem stays open — revisit the root cause or raise a new change.`,
  },
  'change.rolled_back': {
    type: 'CHANGE_ROLLED_BACK',
    title: 'Change request rolled back',
    body: (problem, change) =>
      `Change ${change} linked to problem ${problem} was rolled back. You can reopen the problem for investigation if the incidents have returned.`,
  },
};

/**
 * React to one change event: notify the owner of every problem linked to that
 * change. Returns how many problems were notified.
 *
 * Idempotent by `dedupeKey` — a replayed event (a retried job, an at-least-once
 * bus) re-notifies nobody, because `Notification.dedupeKey` is unique and the
 * insert is swallowed on conflict.
 *
 * Never throws for an unknown event or an unlinked change: a change event is
 * not this module's to validate, and a problem service must not fail the change
 * that published it.
 */
export async function handleChangeEvent(event: string, payload: ChangeEventPayload): Promise<number> {
  const copy = COPY[event as ChangeEvent];
  if (!copy) {
    logger.warn(`[problems] ignoring unknown change event "${event}"`);
    return 0;
  }
  if (!payload?.changeId) {
    logger.warn(`[problems] change event "${event}" arrived without a changeId`);
    return 0;
  }

  const problems = await prisma.problem.findMany({
    where: { deletedAt: null, changeRequestIds: { has: payload.changeId } },
    select: { id: true, number: true, ownerId: true },
  });

  for (const problem of problems) {
    await createNotification({
      userId: problem.ownerId,
      type: copy.type,
      title: copy.title,
      body: copy.body(problem.number, payload.changeId),
      dedupeKey: `problem-change:${event}:${payload.changeId}:${problem.id}`,
    });
  }

  if (problems.length > 0) {
    logger.info(`[problems] ${event} for change ${payload.changeId} notified ${problems.length} problem owner(s)`);
  }
  return problems.length;
}
