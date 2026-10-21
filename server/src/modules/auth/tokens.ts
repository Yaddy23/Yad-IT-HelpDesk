import jwt from 'jsonwebtoken';

import { env } from '../../config/env.js';
import type { Role } from '@prisma/client';

export interface AccessTokenPayload {
  sub: string; // user id
  email: string;
  roles: Role[];
}

export function signAccessToken(user: { id: string; email: string; roles: Role[] }): string {
  const payload: AccessTokenPayload = { sub: user.id, email: user.email, roles: user.roles };
  return jwt.sign(payload, env.JWT_SECRET, {
    expiresIn: env.JWT_EXPIRES_IN as jwt.SignOptions['expiresIn'],
  });
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  return jwt.verify(token, env.JWT_SECRET) as AccessTokenPayload;
}
