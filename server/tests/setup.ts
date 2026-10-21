/**
 * Integration-test setup.
 *
 * The dev machine has no Docker, so there is no in-memory Postgres. Tests run
 * against a dedicated `test` schema on the same Supabase project:
 *  - TEST_DATABASE_URL (or DATABASE_URL) with ?schema=test
 *  - migrations applied once per suite run via `prisma migrate deploy`
 *  - tables truncated between tests (fast, keeps FK constraints intact)
 */
import 'dotenv/config';

import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { beforeEach, afterAll } from 'vitest';

process.env.NODE_ENV = 'test';
// Forced (not ??=): dotenv has already loaded the dev .env by this point, so
// `??=` would keep the dev SETUP_TOKEN while tests send the test token → 401s.
process.env.JWT_SECRET = 'test-jwt-secret-0123456789abcdef0123456789abcdef';
process.env.REFRESH_SECRET = 'test-refresh-secret-0123456789abcdef0123456789';
process.env.SETUP_TOKEN = 'test-setup-token-0123456789abcdef0123456789abcdef';
process.env.WORKER_IN_PROCESS = 'false';

const base = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
if (!base) {
  throw new Error(
    'TEST_DATABASE_URL (or DATABASE_URL) is required for integration tests — point it at your Supabase Postgres',
  );
}
// Force the dedicated test schema regardless of what the URL points at.
const testUrl = base.includes('schema=')
  ? base.replace(/schema=[^&]*/, 'schema=test')
  : `${base}${base.includes('?') ? '&' : '?'}schema=test`;
process.env.DATABASE_URL = testUrl;
// prisma migrate deploy reads directUrl from schema.prisma — point it at the
// test schema too, or migrations land in the dev schema and tests see no tables.
process.env.DIRECT_URL = testUrl;

const { prisma } = await import('../src/prisma/client.js');

// The test schema may not exist yet on a fresh project — create it before
// migrate deploy, which fails with "schema does not exist" otherwise.
await prisma.$executeRawUnsafe('CREATE SCHEMA IF NOT EXISTS test');

// Apply migrations to the test schema once (before the first test file's imports).
execSync('npx prisma migrate deploy', {
  cwd: fileURLToPath(new URL('..', import.meta.url)),
  stdio: 'inherit',
});

beforeEach(async () => {
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'test' AND tablename NOT LIKE '_prisma%'
  `;
  if (tables.length > 0) {
    const list = tables.map((t) => `"test"."${t.tablename}"`).join(', ');
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
  }
});

afterAll(async () => {
  await prisma.$disconnect();
});
