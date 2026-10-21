import 'dotenv/config';

import { env } from './config/env.js';
import { createApp } from './app.js';
import { connectDatabase, disconnectDatabase } from './prisma/client.js';
import { closeRedis } from './core/redis.js';
import { logger } from './core/logger.js';

async function main() {
  await connectDatabase();

  const app = createApp();
  const server = app.listen(env.PORT, () => {
    logger.info(`[server] ITSM API (${env.NODE_ENV}) listening on http://localhost:${env.PORT}`);
  });

  const shutdown = async (signal: string) => {
    logger.info(`[server] ${signal} received — shutting down`);
    server.close(async () => {
      await disconnectDatabase();
      await closeRedis();
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((err) => {
  logger.error('[server] Fatal startup error', err);
  process.exit(1);
});
