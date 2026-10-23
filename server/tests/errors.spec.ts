import type { NextFunction, Request, Response } from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AppError, errorHandler } from '../src/core/errors.js';
import { logger } from '../src/core/logger.js';

const REQUEST_ID = 'req-test-1234';

interface Captured {
  status: number;
  body?: { error?: { code?: string; message?: string; requestId?: string } };
}

function runHandler(err: unknown, requestId: string | undefined = REQUEST_ID): Captured {
  const captured: Captured = { status: 0 };
  const res = {
    status(code: number) {
      captured.status = code;
      return res;
    },
    json(body: unknown) {
      captured.body = body as Captured['body'];
      return res;
    },
  } as unknown as Response;
  errorHandler(err, { id: requestId } as unknown as Request, res, (() => {}) as NextFunction);
  return captured;
}

afterEach(() => vi.restoreAllMocks());

describe('error handler', () => {
  it('maps Prisma connectivity failures to a retryable 503 logged as transient', () => {
    const spy = vi.spyOn(logger, 'error').mockImplementation(() => {});

    for (const code of ['P1001', 'P1002', 'P1008', 'P1017', 'P2024']) {
      const res = runHandler({ code, message: 'connection closed' });
      expect(res.status, code).toBe(503);
      expect(res.body?.error?.code, code).toBe('DB_UNAVAILABLE');
      expect(res.body?.error?.requestId, code).toBe(REQUEST_ID);
    }

    // The log has to name the code and mark it transient, so a recurrence is
    // identifiable as a connection blip rather than a logic bug.
    const logged = spy.mock.calls.map((c) => String(c[0])).join('\n');
    expect(logged).toContain('P1001');
    expect(logged.toLowerCase()).toContain('transient');
  });

  it('keeps data-level Prisma errors on their existing codes', () => {
    const dup = runHandler({ code: 'P2002', meta: { target: ['email'] } });
    expect(dup.status).toBe(409);
    expect(dup.body?.error?.code).toBe('DUPLICATE');

    expect(runHandler({ code: 'P2003' }).status).toBe(400);
    expect(runHandler({ code: 'P2025' }).status).toBe(404);
  });

  it('reports an unknown Prisma code as a 500 carrying the request id', () => {
    vi.spyOn(logger, 'error').mockImplementation(() => {});
    const res = runHandler({ code: 'P2011' });
    expect(res.status).toBe(500);
    expect(res.body?.error?.code).toBe('DB_ERROR');
    expect(res.body?.error?.requestId).toBe(REQUEST_ID);
  });

  it('tags unhandled 500s with the request id and leaves client errors untagged', () => {
    vi.spyOn(logger, 'error').mockImplementation(() => {});

    const unhandled = runHandler(new Error('boom'));
    expect(unhandled.status).toBe(500);
    expect(unhandled.body?.error?.code).toBe('INTERNAL');
    expect(unhandled.body?.error?.requestId).toBe(REQUEST_ID);

    // A 4xx is self-explanatory to the caller, so it carries no correlation id.
    const clientError = runHandler(new AppError(400, 'nope', 'BAD'));
    expect(clientError.status).toBe(400);
    expect(clientError.body?.error?.requestId).toBeUndefined();
  });
});
