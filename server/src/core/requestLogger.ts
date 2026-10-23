import { randomUUID } from 'node:crypto';

import type { NextFunction, Request, Response } from 'express';

import { logger } from './logger.js';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** Correlation id, set by requestLogger: echoed in 5xx bodies and error logs. */
      id?: string;
    }
  }
}

/** Request logging that never touches bodies (so secrets can never leak into logs). */
export function requestLogger(req: Request, res: Response, next: NextFunction) {
  const start = Date.now();
  // A short id ties a user-visible failure back to this request's log line.
  const id = randomUUID().slice(0, 8);
  req.id = id;
  res.setHeader('X-Request-Id', id);

  res.on('finish', () => {
    if (req.path === '/api/v1/health') return;
    const ms = Date.now() - start;
    // Only failures carry the id — healthy traffic keeps the log terse.
    const suffix = res.statusCode >= 400 ? ` req=${id}` : '';
    logger.info(`${req.method} ${req.originalUrl} ${res.statusCode} ${ms}ms${suffix}`);
  });
  next();
}

/**
 * Basic MongoDB operator-injection guard for body and params. Query strings in
 * Express 5 are validated through zod schemas instead. Input validation is the
 * primary defense; this strips `$`-prefixed and dotted keys as a safety net.
 */
export function sanitizeBody(req: Request, _res: Response, next: NextFunction) {
  const clean = (obj: unknown, depth = 0): void => {
    if (depth > 10 || obj === null || typeof obj !== 'object') return;
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      if (key.startsWith('$') || key.includes('.')) {
        delete (obj as Record<string, unknown>)[key];
      } else {
        clean(value, depth + 1);
      }
    }
  };
  if (req.body && typeof req.body === 'object') clean(req.body);
  if (req.params && typeof req.params === 'object') clean(req.params);
  next();
}
