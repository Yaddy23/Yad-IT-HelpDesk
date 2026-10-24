import { PrismaClient } from '@prisma/client';

import { isProd } from '../config/env.js';
import { logger } from '../core/logger.js';

let prismaInstance: PrismaClient | null = null;

function createPrismaClient(): PrismaClient {
  const url = process.env.DATABASE_URL;
  console.log('[prisma] Creating PrismaClient with URL:', url?.substring(0, 50) + '...');
  return new PrismaClient({
    log: isProd ? ['error'] : ['error', 'warn'],
    datasourceUrl: url,
  });
}

export const prisma = new Proxy({} as PrismaClient, {
  get(_target, prop, receiver) {
    if (!prismaInstance) {
      prismaInstance = createPrismaClient();
      console.log('[prisma] PrismaClient created');
    }
    return Reflect.get(prismaInstance, prop, receiver);
  },
});

export function getPrismaClient(): PrismaClient {
  if (!prismaInstance) {
    prismaInstance = createPrismaClient();
  }
  return prismaInstance;
}

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
  if (prismaInstance) {
    await prismaInstance.$disconnect();
    logger.info('[db] Disconnected from Postgres');
  }
}