import { PrismaClient } from '@prisma/client';

import { isProd } from '../config/env.js';
import { logger } from '../core/logger.js';

/**
 * Single PrismaClient instance for the whole server. Prisma connects lazily
 * and pools connections; explicit $connect() warms it at boot.
 */
export const prisma = new PrismaClient({
  log: isProd ? ['error'] : ['error', 'warn'],
});

export async function connectDatabase(): Promise<void> {
  try {
    await prisma.$connect();
    logger.info('[db] Connected to Postgres (Supabase) via Prisma');
  } catch (err) {
    logger.error('[db] Failed to connect to Postgres', err);
    throw err;
  }
}

export async function disconnectDatabase(): Promise<void> {
  await prisma.$disconnect();
  logger.info('[db] Disconnected from Postgres');
}
