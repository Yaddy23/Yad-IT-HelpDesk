import { Redis } from 'ioredis';

import { env } from '../config/env.js';
import { logger } from './logger.js';

/**
 * Shared Redis connection (Render Key Value / any Redis-compatible service).
 * Optional by design: without REDIS_URL the app still runs — rate limiting
 * falls back to in-memory stores and background jobs are unavailable until
 * Phase 3 wires them, at which point REDIS_URL becomes required for workers.
 */
let client: Redis | null = null;

export function redisEnabled(): boolean {
  return Boolean(env.REDIS_URL);
}

export function getRedis(): Redis | null {
  if (!env.REDIS_URL) return null;
  if (!client) {
    client = new Redis(env.REDIS_URL, {
      maxRetriesPerRequest: null,
      enableOfflineQueue: false,
      lazyConnect: false,
    });
    client.on('error', (err: Error) => logger.warn('[redis] connection error', err.message));
    client.on('ready', () => logger.info('[redis] connected'));
  }
  return client;
}

export async function closeRedis(): Promise<void> {
  if (client) {
    await client.quit().catch(() => client?.disconnect());
    client = null;
  }
}
