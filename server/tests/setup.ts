/**
 * Integration-test setup.
 *
 * The dev machine has no Docker, so there is no in-memory Postgres. Tests run
 * against a dedicated `test` schema on the same Supabase project:
 *  - TEST_DATABASE_URL (or DATABASE_URL) with ?schema=test
 *  - migrations applied once per suite run (see `globalSetup.ts`)
 *  - tables truncated between tests (fast, keeps FK constraints intact)
 */
import 'dotenv/config';

import { beforeEach, afterAll } from 'vitest';

import { resolveTestDatabaseUrl } from './testDatabaseUrl.js';

process.env.NODE_ENV = 'test';
// Forced (not ??=): dotenv has already loaded the dev .env by this point, so
// `??=` would keep the dev SETUP_TOKEN while tests send the test token → 401s.
process.env.JWT_SECRET = 'test-jwt-secret-0123456789abcdef0123456789abcdef';
process.env.REFRESH_SECRET = 'test-refresh-secret-0123456789abcdef0123456789';
process.env.SETUP_TOKEN = 'test-setup-token-0123456789abcdef0123456789abcdef';
process.env.WORKER_IN_PROCESS = 'false';

// Force the dedicated test schema regardless of what the URL points at.
const testUrl = resolveTestDatabaseUrl();
process.env.DATABASE_URL = testUrl;
// prisma migrate deploy reads directUrl from schema.prisma — point it at the
// test schema too, or migrations land in the dev schema and tests see no tables.
process.env.DIRECT_URL = testUrl;

const { prisma } = await import('../src/prisma/client.js');

beforeEach(async () => {
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'test' AND tablename NOT LIKE '_prisma%'
    ORDER BY tablename
  `;
  if (tables.length === 0) return;

  const list = tables.map((t) => `"test"."${t.tablename}"`).join(', ');
  // TRUNCATE takes an ACCESS EXCLUSIVE lock on every listed table. Concurrent
  // workers truncating the same tables in different orders deadlock, so the
  // retry below is the safety net for that race rather than the primary path.
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
      return;
    } catch (err: any) {
      // A deadlock surfaces as P2010 (failed raw query) with the Postgres
      // SQLSTATE in meta.code — not as err.code directly.
      const sqlState = err.meta?.code ?? err.code;
      if (sqlState === '40P01' && attempt < 5) {
        await new Promise((r) => setTimeout(r, 100 * attempt));
        continue;
      }
      throw err;
    }
  }
});

afterAll(async () => {
  await prisma.$disconnect();
});
