import type { NextFunction, Request, Response } from 'express';

import { unauthorized, forbidden } from './errors.js';
import { verifyAccessToken } from '../modules/auth/tokens.js';
import { prisma } from '../prisma/client.js';
import { hasPermission, type Permission } from './permissions.js';
import type { Role } from '@prisma/client';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: {
        id: string;
        email: string;
        name: string;
        roles: Role[];
        employeeId?: string | null;
      };
    }
  }
}

/** Verifies the JWT and loads the user, enforcing that the account is still active. */
export async function requireAuth(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return next(unauthorized());
  try {
    const payload = verifyAccessToken(header.slice(7));
    const user = await prisma.user.findUnique({
      where: { id: payload.sub },
      include: { roles: true, employee: { select: { id: true } } },
    });
    if (!user || !user.active) {
      return next(unauthorized('Account is disabled or no longer exists'));
    }
    req.user = {
      id: user.id,
      email: user.email,
      name: user.name,
      roles: user.roles.map((r) => r.role),
      employeeId: user.employee?.id ?? null,
    };
    next();
  } catch {
    next(unauthorized());
  }
}

export function requirePermission(...required: Permission[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) return next(unauthorized());
    if (!required.every((p) => hasPermission(req.user!, p))) {
      return next(forbidden(`Missing permission: ${required.join(', ')}`));
    }
    next();
  };
}

export function requireAnyPermission(...alternatives: Permission[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) return next(unauthorized());
    if (!alternatives.some((p) => hasPermission(req.user!, p))) {
      return next(forbidden(`Missing one of: ${alternatives.join(', ')}`));
    }
    next();
  };
}
