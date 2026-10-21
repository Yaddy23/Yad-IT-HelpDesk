import type { NextFunction, Request, Response } from 'express';

import { badRequest } from '../../core/errors.js';
import { permissionsFor, ROLES } from '../../core/permissions.js';
import { toAuthed } from '../../core/request.js';
import {
  bootstrapSchema,
  loginSchema,
  logoutSchema,
  refreshSchema,
} from './auth.validators.js';
import * as authService from './auth.service.js';

function shape(result: {
  user: { id: string; email: string; name: string; roles: { role: string }[] };
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
}) {
  return {
    user: {
      id: result.user.id,
      email: result.user.email,
      name: result.user.name,
      roles: result.user.roles.map((r) => r.role),
    },
    accessToken: result.accessToken,
    refreshToken: result.refreshToken,
    refreshTokenExpiresAt: result.expiresAt,
  };
}

export async function bootstrap(req: Request, res: Response, next: NextFunction) {
  try {
    const parsed = bootstrapSchema.parse({ body: req.body });
    const user = await authService.bootstrapFirstAdmin(parsed.body, req.ip);
    res.status(201).json({
      data: { id: user.id, email: user.email, name: user.name, roles: user.roles.map((r) => r.role) },
    });
  } catch (e) {
    next(e);
  }
}

export async function login(req: Request, res: Response, next: NextFunction) {
  try {
    const parsed = loginSchema.parse({ body: req.body });
    const result = await authService.login(parsed.body, req.ip, req.headers['user-agent']);
    res.json({ data: shape(result) });
  } catch (e) {
    next(e);
  }
}

export async function refresh(req: Request, res: Response, next: NextFunction) {
  try {
    const parsed = refreshSchema.parse({ body: req.body });
    const result = await authService.refresh(parsed.body.refreshToken, req.ip);
    res.json({ data: shape(result) });
  } catch (e) {
    next(e);
  }
}

export async function logout(req: Request, res: Response, next: NextFunction) {
  try {
    const parsed = logoutSchema.parse({ body: req.body });
    await authService.logout(parsed.body.refreshToken, req.ip);
    res.status(204).send();
  } catch (e) {
    next(e);
  }
}

export async function me(req: Request, res: Response, next: NextFunction) {
  try {
    const user = toAuthed(req).user;
    if (!user) throw badRequest('Missing user context');
    const employee = user.employeeId
      ? await authService.getEmployeeProfile(user.employeeId)
      : null;
    res.json({
      data: {
        id: user.id,
        email: user.email,
        name: user.name,
        roles: user.roles,
        permissions: permissionsFor(user.roles as never),
        employee,
      },
    });
  } catch (e) {
    next(e);
  }
}

/** Exposes the static role list so the client can render role pickers without hardcoding. */
export function roles(_req: Request, res: Response) {
  res.json({ data: ROLES });
}
