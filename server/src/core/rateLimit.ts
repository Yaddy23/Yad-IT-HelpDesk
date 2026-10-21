import rateLimit from 'express-rate-limit';
import { RedisStore } from 'rate-limit-redis';

import { env, isTest } from '../config/env.js';
import { getRedis, redisEnabled } from './redis.js';
import { logger } from './logger.js';

function store() {
  if (redisEnabled()) {
    const redis = getRedis()!;
    // Key prefix isolates dev/test/prod sharing one Key Value instance.
    return new RedisStore({
      sendCommand: ((...args: string[]) => redis.call(args[0], ...args.slice(1))) as never,
      prefix: `itsm:${env.NODE_ENV}:rl:`,
    });
  }
  return undefined; // express-rate-limit defaults to an in-memory store
}

/** General API limiter. */
export const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 600,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  ...(store() ? { store: store() } : {}),
  skip: () => isTest,
});

/** Strict limiter for credential endpoints (brute-force protection). */
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  ...(store() ? { store: store() } : {}),
  skip: () => isTest,
});

if (!redisEnabled() && !isTest) {
  logger.warn('[rateLimit] REDIS_URL not set — using in-memory limiter (resets on restart)');
}
