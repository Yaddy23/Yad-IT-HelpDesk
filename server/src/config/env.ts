import { z } from 'zod';

/**
 * Central environment configuration. Fails fast at boot with a readable error
 * listing exactly which variables are missing or malformed. Secrets are never
 * logged — this module only validates them.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(5000),

  DATABASE_URL: z
    .string()
    .min(1, 'DATABASE_URL is required (Supabase Postgres connection string — see .env.example)'),

  // Optional: without Redis, rate limiting falls back to in-memory and
  // background jobs cannot run (Phase 3 will enforce this harder).
  REDIS_URL: z.string().optional(),

  // Supabase Storage (private bucket) for ticket attachments. Either unset or
  // empty → attachment endpoints respond 503 instead of failing the whole boot.
  SUPABASE_URL: z.preprocess((v) => (v === '' ? undefined : v), z.string().url().optional()),
  SUPABASE_SERVICE_ROLE_KEY: z.preprocess((v) => (v === '' ? undefined : v), z.string().min(1).optional()),
  ATTACHMENTS_BUCKET: z.string().default('ticket-attachments'),
  ATTACHMENTS_MAX_MB: z.coerce.number().int().positive().default(10),

  JWT_SECRET: z.string().min(24, 'JWT_SECRET must be at least 24 chars'),
  JWT_EXPIRES_IN: z.string().default('8h'),
  REFRESH_SECRET: z.string().min(24, 'REFRESH_SECRET must be at least 24 chars'),
  REFRESH_EXPIRES_IN_DAYS: z.coerce.number().int().positive().default(7),

  SETUP_TOKEN: z.string().min(24, 'SETUP_TOKEN must be at least 24 chars (first-admin bootstrap)'),

  WORKER_IN_PROCESS: z
    .enum(['true', 'false'])
    .default('true'),

  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().positive().optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  EMAIL_FROM: z.string().optional(),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues
    .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
    .join('\n');
  console.error(`[config] Invalid environment configuration:\n${issues}`);
  process.exit(1);
}

export const env = parsed.data;
export const isProd = env.NODE_ENV === 'production';
export const isTest = env.NODE_ENV === 'test';
