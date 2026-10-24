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

/**
 * Prisma connectivity and pool-exhaustion codes. These are transient — the
 * database was briefly unreachable, not the data wrong — so they get their own
 * status and a log line that names the code. Without this they were
 * indistinguishable from a genuine 500 in both the logs and the response.
 */
const TRANSIENT_PRISMA_CODES = new Set(['P1001', 'P1002', 'P1008', 'P1017', 'P2024']);

/** Express 5 forwards rejected async handlers to this error middleware. */
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  const requestId = req.id;
  const tag = requestId ? ` req=${requestId}` : '';
  /** Server faults carry the request id, so a user report maps to a log line. */
  const serverError = (status: number, code: string, message: string) =>
    res.status(status).json({ error: { code, message, ...(requestId ? { requestId } : {}) } });

  // Handle STALE_VERSION optimistic concurrency error before AppError check
  if (typeof err === 'object' && err !== null && 'code' in err) {
    const code = (err as { code?: unknown }).code;
    if (code === 'STALE_VERSION') {
      return res.status(409).json({ error: { code: 'STALE_VERSION', message: 'Article was modified by another user. Please refresh and try again.' } });
    }
  }

  if (err instanceof AppError) {
    if (err.status >= 500) return serverError(err.status, err.code, err.message);
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
    if (TRANSIENT_PRISMA_CODES.has(err.code)) {
      logger.error(`[http] Prisma connection error ${err.code} (transient — database unreachable or pool exhausted)${tag}`, err);
      return serverError(503, 'DB_UNAVAILABLE', 'The database is temporarily unavailable — please retry.');
    }
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
    logger.error(`[http] Prisma error ${err.code}${tag}`, err);
    return serverError(500, 'DB_ERROR', 'Database operation failed');
  }
  // express.json() parse failures (malformed JSON) surface as SyntaxError.
  if (err instanceof SyntaxError && 'status' in err && (err as { status?: number }).status === 400) {
    return res.status(400).json({ error: { code: 'MALFORMED_JSON', message: 'Request body is not valid JSON' } });
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

  logger.error(`[http] Unhandled error${tag}`, err);
  return serverError(500, 'INTERNAL', 'Internal server error');
}

export function notFoundHandler(_req: Request, res: Response) {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Endpoint not found' } });
}
