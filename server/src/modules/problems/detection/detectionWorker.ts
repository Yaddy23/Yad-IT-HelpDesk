/**
 * Recurring-incident detection on a schedule.
 *
 * Mirrors the scheduler's two-backend contract (`jobs/scheduler.ts`): a BullMQ
 * worker with a repeatable job when Redis is configured, an unref'd interval
 * otherwise. It owns its own queue so a detection failure cannot take the SLA
 * sweep down with it, and it never throws on a missing Redis — detection is a
 * convenience, not a guarantee, and must degrade quietly.
 */

import type { Job, Queue, Worker } from 'bullmq';

import { isTest } from '../../../config/env.js';
import { logger } from '../../../core/logger.js';
import { getRedis, redisEnabled } from '../../../core/redis.js';
import { prisma } from '../../../prisma/client.js';
import { problemConfig } from '../config.js';
import { DETECTION_CRITERIA } from './criteria.js';
import { runDetection } from './detectionEngine.js';

export const PROBLEM_DETECTION_QUEUE = 'problem-detection';
export const PROBLEM_DETECTION_JOB = 'detect';

let queue: Queue | null = null;
let worker: Worker | null = null;
let timer: NodeJS.Timeout | null = null;

/** Job-run log, same shape the scheduler writes so one query sees every job. */
async function recordJobRun(jobId: string, status: 'completed' | 'failed', attempts: number, error?: string): Promise<void> {
  try {
    await prisma.jobRun.create({
      data: { queue: PROBLEM_DETECTION_QUEUE, name: PROBLEM_DETECTION_JOB, jobId, status, attempts, error: error ?? null },
    });
  } catch (err) {
    logger.error('[problems] failed to record detection JobRun', err);
  }
}

/** One scan over the detection window. Returns how many suggestions it made. */
async function runDetectionJob(jobId: string, attempts: number): Promise<number> {
  try {
    const windowStart = new Date(Date.now() - DETECTION_CRITERIA.windowHours * 3_600_000);
    const suggestions = await runDetection(windowStart);
    await recordJobRun(jobId, 'completed', attempts);
    return suggestions.length;
  } catch (err) {
    await recordJobRun(jobId, 'failed', attempts, String(err));
    throw err;
  }
}

/**
 * Start the scheduled scan. Safe to call once at boot; a second call while
 * running is a no-op because the handles are already set.
 */
export async function startProblemDetection(): Promise<void> {
  if (isTest) return;
  if (queue || worker || timer) return;

  if (!(await problemConfig.detectionEnabled())) {
    logger.info('[problems] detection disabled by PROBLEM_DETECTION_ENABLED');
    return;
  }
  const intervalMs = Math.max(1, await problemConfig.detectionIntervalMin()) * 60_000;

  if (redisEnabled()) {
    try {
      const { Queue, Worker } = await import('bullmq');
      const connection = getRedis()!;
      queue = new Queue(PROBLEM_DETECTION_QUEUE, { connection });
      worker = new Worker(
        PROBLEM_DETECTION_QUEUE,
        async (job: Job) => runDetectionJob(job.id ?? 'repeat', job.attemptsMade + 1),
        { connection, concurrency: 1 },
      );
      worker.on('failed', (job, err) => logger.error(`[problems] ${PROBLEM_DETECTION_QUEUE}/${job?.name} failed`, err));

      // Same scheduler id replaces the old cadence, so a config change takes
      // effect on the next boot instead of stacking a second timer.
      await queue.upsertJobScheduler(
        `${PROBLEM_DETECTION_JOB}:repeat`,
        { every: intervalMs },
        { name: PROBLEM_DETECTION_JOB, data: {}, opts: { removeOnComplete: { count: 100 }, removeOnFail: { count: 100 } } },
      );
      logger.info(`[problems] detection worker started (Redis, every ${intervalMs / 60_000}m)`);
      return;
    } catch (err) {
      logger.error('[problems] detection BullMQ startup failed', err);
      await stopProblemDetection();
      if (!(await problemConfig.redisFallback())) {
        logger.warn('[problems] PROBLEM_REDIS_FALLBACK is off — detection stays stopped');
        return;
      }
    }
  }

  timer = setInterval(() => {
    void runDetectionJob(`${PROBLEM_DETECTION_JOB}:repeat`, 1).catch((err) => {
      logger.error('[problems] in-memory detection failed', err);
    });
  }, intervalMs);
  timer.unref();
  logger.info(`[problems] detection timer started (no Redis, every ${intervalMs / 60_000}m)`);
}

/** Stop the scan and release the Redis connections. Safe to call when stopped. */
export async function stopProblemDetection(): Promise<void> {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  if (worker) {
    await worker.close();
    worker = null;
  }
  if (queue) {
    await queue.close();
    queue = null;
  }
}
