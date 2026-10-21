import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';

import { logger } from './logger.js';

export class AppError extends Error {
  constructor(
    public status: number,
    message: string,
    public code = 'APP_ERROR',
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const badRequest = (msg: string, code = 'BAD_REQUEST') => new AppError(400, msg, code);
export const unauthorized = (msg = 'Authentication required', code = 'UNAUTHORIZED') =>
  new AppError(401, msg, code);
export const forbidden = (msg = 'Not permitted', code = 'FORBIDDEN') => new AppError(403, msg, code);
export const notFound = (msg = 'Resource not found', code = 'NOT_FOUND') =>
  new AppError(404, msg, code);
export const conflict = (msg: string, code = 'CONFLICT') => new AppError(409, msg, code);

function isPrismaError(err: unknown): err is { code: string; meta?: { target?: string[] } } {
  return typeof err === 'object' && err !== null && 'code' in err &&
    typeof (err as { code?: unknown }).code === 'string' &&
    (err as { code: string }).code.startsWith('P');
}

/** Express 5 forwards rejected async handlers to this error middleware. */
export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof AppError) {
    return res.status(err.status).json({ error: { code: err.code, message: err.message } });
  }
  if (err instanceof ZodError) {
    return res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Request validation failed',
        details: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      },
    });
  }
  if (isPrismaError(err)) {
    if (err.code === 'P2002') {
      // Unique constraint violation
      const fields = (err.meta?.target ?? []).join(', ');
      return res
        .status(409)
        .json({ error: { code: 'DUPLICATE', message: `Duplicate value for: ${fields || 'unique field'}` } });
    }
    if (err.code === 'P2025') {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Record not found' } });
    }
    if (err.code === 'P2003') {
      return res.status(400).json({
        error: { code: 'FK_CONSTRAINT', message: 'Referenced record does not exist or is still in use' },
      });
    }
    logger.error(`[http] Prisma error ${err.code}`, err);
    return res.status(500).json({ error: { code: 'DB_ERROR', message: 'Database operation failed' } });
  }
  if (typeof err === 'object' && err !== null && 'name' in err) {
    const name = (err as { name?: string }).name;
    if (name === 'JsonWebTokenError') {
      return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Invalid token' } });
    }
    if (name === 'TokenExpiredError') {
      return res.status(401).json({ error: { code: 'TOKEN_EXPIRED', message: 'Session expired' } });
    }
  }

  logger.error('[http] Unhandled error', err);
  return res.status(500).json({ error: { code: 'INTERNAL', message: 'Internal server error' } });
}

export function notFoundHandler(_req: Request, res: Response) {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Endpoint not found' } });
}
