/**
 * Global test setup — runs ONCE per suite, before any test file.
 *
 * Migrations live here rather than in `setup.ts` because `setupFiles` are
 * executed once per test file: running `prisma migrate deploy` from there
 * re-ran the whole migration set for every spec file, which dominated the
 * suite's runtime.
 */
import 'dotenv/config';

import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { resolveTestDatabaseUrl } from './testDatabaseUrl.js';

export default function globalSetup(): void {
  const testUrl = resolveTestDatabaseUrl();
  process.env.DATABASE_URL = testUrl;
  // prisma migrate deploy reads directUrl from schema.prisma — point it at the
  // test schema too, or migrations land in the dev schema and tests see no tables.
  process.env.DIRECT_URL = testUrl;

  execSync('npx prisma migrate deploy', {
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    stdio: 'inherit',
  });
}
