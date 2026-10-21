import crypto from 'node:crypto';

import type { User } from '@prisma/client';

import { env } from '../../config/env.js';
import { recordAudit } from '../../core/audit.js';
import { verifyDummyPassword, hashPassword, verifyPassword } from '../../core/password.js';
import { forbidden, unauthorized } from '../../core/errors.js';
import { prisma } from '../../prisma/client.js';
import { signAccessToken } from './tokens.js';

export interface AuthResult {
  user: User & { roles: { role: 'super_admin' | 'it_admin' | 'it_manager' | 'it_technician' | 'employee' | 'approver' }[] };
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
}

const REFRESH_TTL_DAYS = Number(process.env.REFRESH_EXPIRES_IN_DAYS ?? 7);

function newRefreshToken(): { token: string; hash: string; expiresAt: Date } {
  const token = crypto.randomBytes(48).toString('base64url');
  const hash = crypto.createHash('sha256').update(token).digest('hex');
  return { token, hash, expiresAt: new Date(Date.now() + REFRESH_TTL_DAYS * 24 * 60 * 60 * 1000) };
}

export function hashRefreshToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/** Constant-time SETUP_TOKEN comparison (defends against timing oracles). */
function setupTokenMatches(provided: string): boolean {
  const a = crypto.createHash('sha256').update(provided).digest();
  const b = crypto.createHash('sha256').update(env.SETUP_TOKEN).digest();
  return a.equals(b);
}

function roleNames(user: { roles: { role: string }[] }): Role[] {
  return user.roles.map((r) => r.role) as Role[];
}

/**
 * Creates the FIRST super admin. Permanently locks once any user exists.
 * Requires the SETUP_TOKEN from the environment.
 */
export async function bootstrapFirstAdmin(
  input: { setupToken: string; email: string; password: string; name: string },
  ip?: string,
): Promise<User & { roles: { role: Role }[] }> {
  const userCount = await prisma.user.count();
  if (userCount > 0) {
    throw forbidden('Setup already completed. Ask an administrator for access.', 'ALREADY_INITIALIZED');
  }
  if (!setupTokenMatches(input.setupToken)) {
    throw unauthorized('Invalid setup token', 'INVALID_SETUP_TOKEN');
  }

  const email = input.email.toLowerCase();
  const user = await prisma.$transaction(async (tx) => {
    const employeeCount = await tx.employee.count();
    const created = await tx.user.create({
      data: {
        email,
        passwordHash: await hashPassword(input.password),
        name: input.name,
        roles: { create: [{ role: 'super_admin' }] },
        employee: {
          create: {
            employeeId: `EMP-${String(employeeCount + 1).padStart(6, '0')}`,
            name: input.name,
            email,
          },
        },
      },
      include: { roles: true, employee: true },
    });
    return created;
  });

  await recordAudit({
    actorId: user.id,
    actorEmail: user.email,
    action: 'auth.bootstrap',
    targetType: 'user',
    targetId: user.id,
    meta: { roles: roleNames(user) },
    ip,
  });
  return user;
}

export async function login(
  input: { email: string; password: string },
  ip?: string,
  userAgent?: string,
): Promise<AuthResult> {
  const user = await prisma.user.findUnique({
    where: { email: input.email.toLowerCase() },
    include: { roles: true },
  });
  // Uniform error + dummy compare so response timing never reveals whether the account exists.
  const ok = user
    ? await verifyPassword(input.password, user.passwordHash)
    : await verifyDummyPassword(input.password);
  if (!user || !ok) throw unauthorized('Invalid email or password', 'INVALID_CREDENTIALS');
  if (!user.active) throw forbidden('Account is disabled', 'ACCOUNT_DISABLED');

  const { token: refreshToken, hash, expiresAt } = newRefreshToken();
  await prisma.session.create({
    data: { userId: user.id, refreshTokenHash: hash, expiresAt, ip, userAgent },
  });
  const accessToken = signAccessToken({ id: user.id, email: user.email, roles: roleNames(user) });

  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });

  await recordAudit({
    actorId: user.id,
    actorEmail: user.email,
    action: 'auth.login',
    targetType: 'user',
    targetId: user.id,
    ip,
  });
  return { user: user as AuthResult['user'], accessToken, refreshToken, expiresAt };
}

/** Validates + rotates the refresh token (reuse of a rotated token revokes the family). */
export async function refresh(refreshToken: string, ip?: string): Promise<AuthResult> {
  const hash = hashRefreshToken(refreshToken);
  const session = await prisma.session.findUnique({ where: { refreshTokenHash: hash } });
  if (!session) throw unauthorized('Invalid refresh token', 'INVALID_REFRESH');

  if (session.revokedAt) {
    // Token reuse after rotation — possible theft; kill the whole session family.
    await prisma.session.updateMany({
      where: { userId: session.userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    await recordAudit({
      actorId: session.userId,
      action: 'auth.refresh_reuse_detected',
      targetType: 'session',
      targetId: session.id,
      ip,
    });
    throw unauthorized('Session revoked', 'SESSION_REVOKED');
  }
  if (session.expiresAt < new Date()) throw unauthorized('Session expired', 'SESSION_EXPIRED');

  const user = await prisma.user.findUnique({ where: { id: session.userId }, include: { roles: true } });
  if (!user || !user.active) throw unauthorized('Account is disabled', 'ACCOUNT_DISABLED');

  const rotated = newRefreshToken();
  await prisma.$transaction([
    prisma.session.update({ where: { id: session.id }, data: { revokedAt: new Date() } }),
    prisma.session.create({
      data: { userId: user.id, refreshTokenHash: rotated.hash, expiresAt: rotated.expiresAt, ip },
    }),
  ]);
  return {
    user: user as AuthResult['user'],
    accessToken: signAccessToken({ id: user.id, email: user.email, roles: roleNames(user) }),
    refreshToken: rotated.token,
    expiresAt: rotated.expiresAt,
  };
}

export async function logout(refreshToken: string, ip?: string): Promise<void> {
  const hash = hashRefreshToken(refreshToken);
  const session = await prisma.session.findUnique({ where: { refreshTokenHash: hash } });
  if (session && !session.revokedAt) {
    await prisma.session.update({ where: { id: session.id }, data: { revokedAt: new Date() } });
    await recordAudit({
      actorId: session.userId,
      action: 'auth.logout',
      targetType: 'session',
      targetId: session.id,
      ip,
    });
  }
}

export type Role = 'super_admin' | 'it_admin' | 'it_manager' | 'it_technician' | 'employee' | 'approver';

/** Employee profile for /auth/me (org data lives on the employee record). */
export async function getEmployeeProfile(employeeId: string) {
  return prisma.employee.findUnique({
    where: { id: employeeId },
    select: {
      employeeId: true,
      name: true,
      email: true,
      jobTitle: true,
      employmentStatus: true,
      department: { select: { id: true, name: true } },
      location: { select: { id: true, name: true } },
      manager: { select: { id: true, employeeId: true, name: true } },
    },
  });
}
