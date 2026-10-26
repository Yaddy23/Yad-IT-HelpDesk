/**
 * Resolves the Postgres URL the integration suite runs against.
 *
 * The dev machine has no Docker, so there is no in-memory Postgres. Tests run
 * against a dedicated `test` schema on the same Supabase project, whichever
 * schema the configured URL points at.
 */

/**
 * Force the dedicated `test` schema on a connection URL, whatever schema it
 * currently names.
 */
export function resolveTestDatabaseUrl(): string {
  const base = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!base) {
    throw new Error(
      'TEST_DATABASE_URL (or DATABASE_URL) is required for integration tests — point it at your Supabase Postgres',
    );
  }
  return base.includes('schema=')
    ? base.replace(/schema=[^&]*/, 'schema=test')
    : `${base}${base.includes('?') ? '&' : '?'}schema=test`;
}
