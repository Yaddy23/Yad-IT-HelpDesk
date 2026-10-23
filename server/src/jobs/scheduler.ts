import type { Job, Queue, Worker } from 'bullmq';

import { isTest } from '../config/env.js';import { logger } from '../core/logger.js';
import { getRedis, redisEnabled } from '../core/redis.js';
import { prisma } from '../prisma/client.js';
import { sendEmail } from '../modules/notifications/email.js';
import { runSlaSweep } from '../sla/sla.service.js';
import { runApprovalSweep } from '../modules/serviceMgmt/approvals.service.js';

/**
 * Job scheduler with two interchangeable backends:
 *  - BullMQ on Redis (production — Render Key Value), retries with backoff.
 *  - In-memory timers (local dev / no REDIS_URL / tests).
 *
 * Jobs are idempotent by contract: the SLA sweep rechecks live state and the
 * DB enforces escalation/notification dedupe, so a wake-up that arrives twice
 * is harmless. Every run is recorded in the JobRun log (success AND failure).
 */

const SLA_QUEUE = 'sla';
const SWEEP_JOB = 'sweep';
const EMAIL_JOB = 'email';
/** Repeatable sweep cadence — the safety net for anything a delayed job misses. */
const SWEEP_INTERVAL_MS = 60_000;

interface EmailJobPayload {
  to: string;
  subject: string;
  body: string;
}

/* ── Job-run log ───────────────────────────────────────────────────────────── */

async function recordJobRun(queue: string, name: string, jobId: string, status: 'completed' | 'failed', attempts: number, error?: string): Promise<void> {
  try {
    await prisma.jobRun.create({ data: { queue, name, jobId, status, attempts, error: error ?? null } });
  } catch (err) {
    logger.error('[jobs] failed to record JobRun', err);
  }
}

/* ── BullMQ backend ────────────────────────────────────────────────────────── */

let queue: Queue | null = null;
let worker: Worker | null = null;

async function startBullMq(): Promise<void> {
  const { Queue, Worker } = await import('bullmq');
  const connection = getRedis()!;
  queue = new Queue(SLA_QUEUE, { connection });
  worker = new Worker(
    SLA_QUEUE,
    async (job: Job) => {
      try {
        if (job.name === SWEEP_JOB) {
          const result = await runSlaSweep();
          await runApprovalSweep();
          await scheduleThresholdWakeUp(result.nextWakeUpMs, `wake:${job.id ?? 'repeat'}`);
        } else if (job.name === EMAIL_JOB) {
          const payload = job.data as EmailJobPayload;
          await sendEmail(payload);
        } else {
          throw new Error(`Unknown job: ${job.name}`);
        }
        await recordJobRun(SLA_QUEUE, job.name, job.id ?? 'repeat', 'completed', job.attemptsMade + 1);
      } catch (err) {
        await recordJobRun(SLA_QUEUE, job.name, job.id ?? 'repeat', 'failed', job.attemptsMade + 1, String(err));
        throw err;
      }
    },
    { connection, concurrency: 1 },
  );
  worker.on('failed', (job, err) => logger.error(`[jobs] ${SLA_QUEUE}/${job?.name} failed`, err));

  // Upsert the repeatable sweep — same scheduler id replaces the old config.
  await queue.upsertJobScheduler(
    `${SWEEP_JOB}:repeat`,
    { every: SWEEP_INTERVAL_MS },
    {
      name: SWEEP_JOB,
      data: {},
      opts: { removeOnComplete: { count: 100 }, removeOnFail: { count: 100 } },
    },
  );
  logger.info('[jobs] BullMQ scheduler started (Redis)');
}

/**
 * Threshold wake-up: if an instance reaches its warning window sooner than the
 * next repeatable sweep, run the sweep early. The sweep rechecks live state,
 * so extra wake-ups (or duplicate wake-ups) are harmless.
 */
async function scheduleThresholdWakeUp(delayMs: number | null, dedupeKey: string): Promise<void> {
  if (delayMs === null || delayMs >= SWEEP_INTERVAL_MS) return;
  if (redisEnabled() && queue) {
    await queue.add(SWEEP_JOB, {}, { delay: delayMs, jobId: `${dedupeKey}:${Math.ceil(Date.now() / SWEEP_INTERVAL_MS)}`, removeOnComplete: true, removeOnFail: true });
    return;
  }
  const timer = setTimeout(() => {
    void (async () => {
      try {
        await runSlaSweep();
        await runApprovalSweep();
        await recordJobRun('memory', SWEEP_JOB, dedupeKey, 'completed', 1);
      } catch (err) {
        await recordJobRun('memory', SWEEP_JOB, dedupeKey, 'failed', 1, String(err));
      }
    })();
  }, Math.max(delayMs, 0));
  timer.unref();
  inMemoryTimers.add(timer);
}

/* ── In-memory backend ─────────────────────────────────────────────────────── */

const inMemoryTimers = new Set<NodeJS.Timeout>();

function startInMemory(): void {
  const timer = setInterval(() => {
    void (async () => {
      try {
        const result = await runSlaSweep();
        await runApprovalSweep();
        await scheduleThresholdWakeUp(result.nextWakeUpMs, `wake:${SWEEP_JOB}:repeat`);
        await recordJobRun('memory', SWEEP_JOB, `${SWEEP_JOB}:repeat`, 'completed', 1);
      } catch (err) {
        await recordJobRun('memory', SWEEP_JOB, `${SWEEP_JOB}:repeat`, 'failed', 1, String(err));
        logger.error('[jobs] in-memory sweep failed', err);
      }
    })();
  }, SWEEP_INTERVAL_MS);
  timer.unref();
  inMemoryTimers.add(timer);
  logger.info('[jobs] in-memory scheduler started (no REDIS_URL)');
}

/* ── Public API ────────────────────────────────────────────────────────────── */

let started = false;

export function startScheduler(): void {
  if (started || isTest) return;
  started = true;
  if (redisEnabled()) {
    void startBullMq().catch((err) => {
      logger.error('[jobs] BullMQ startup failed — falling back to in-memory scheduler', err);
      startInMemory();
    });
  } else {
    startInMemory();
  }
}

export async function stopScheduler(): Promise<void> {
  for (const t of inMemoryTimers) clearInterval(t);
  inMemoryTimers.clear();
  if (worker) await worker.close();
  if (queue) await queue.close();
  worker = null;
  queue = null;
  started = false;
}

/** On-demand sweep — used by tests and admin tooling; never double-schedules. */
export async function runSweepNow(): Promise<{ checked: number; escalated: number; nextWakeUpMs: number | null }> {
  return runSlaSweep();
}

/** Queues an email through the active backend (BullMQ with retries, else direct). */
export async function enqueueEmail(payload: EmailJobPayload): Promise<void> {
  if (redisEnabled() && queue) {
    await queue.add(EMAIL_JOB, payload, { attempts: 5, backoff: { type: 'exponential', delay: 5_000 }, removeOnComplete: { count: 100 }, removeOnFail: { count: 100 } });
    return;
  }
  await sendEmail(payload);
}
