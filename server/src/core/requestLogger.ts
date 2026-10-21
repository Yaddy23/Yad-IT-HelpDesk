import type { NextFunction, Request, Response } from 'express';

import { logger } from './logger.js';

/** Request logging that never touches bodies (so secrets can never leak into logs). */
export function requestLogger(req: Request, res: Response, next: NextFunction) {
  const start = Date.now();
  res.on('finish', () => {
    if (req.path === '/api/v1/health') return;
    logger.info(`${req.method} ${req.originalUrl} ${res.statusCode} ${Date.now() - start}ms`);
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
