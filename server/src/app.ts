import path from 'node:path';

import express, { type Express } from 'express';
import helmet from 'helmet';

import { isProd } from './config/env.js';
import { errorHandler, notFoundHandler } from './core/errors.js';
import { apiLimiter } from './core/rateLimit.js';
import { requestLogger, sanitizeBody } from './core/requestLogger.js';
import { authRouter } from './modules/auth/auth.routes.js';
import { usersRouter } from './modules/users/users.routes.js';
import { departmentsRouter, groupsRouter, locationsRouter } from './modules/org/org.routes.js';
import { settingsRouter } from './modules/settings/settings.routes.js';
import { auditRouter } from './modules/audit/audit.routes.js';
import { ticketsRouter } from './modules/tickets/tickets.routes.js';
import { searchRouter } from './modules/search/search.routes.js';
export function createApp(): Express {
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', 1); // Render runs behind one proxy hop
  app.use(helmet({ contentSecurityPolicy: isProd ? undefined : false }));
  app.use(express.json({ limit: '1mb' }));
  app.use(requestLogger);
  app.use(sanitizeBody);

  // Static SPA (production): the built client is served from client/dist.
  const clientDist = path.resolve(process.cwd(), '../client/dist');
  app.use(express.static(clientDist, { index: false }));

  app.use('/api/v1/health', (_req, res) => {
    res.json({ status: 'ok', service: 'itsm-api', version: 'v1', time: new Date().toISOString() });
  });

  app.use('/api/v1', apiLimiter);
  app.use('/api/v1/auth', authRouter);
  app.use('/api/v1/users', usersRouter);
  app.use('/api/v1/departments', departmentsRouter);
  app.use('/api/v1/locations', locationsRouter);
  app.use('/api/v1/groups', groupsRouter);
  app.use('/api/v1/settings', settingsRouter);
  app.use('/api/v1/audit', auditRouter);
  app.use('/api/v1/tickets', ticketsRouter);
  app.use('/api/v1/search', searchRouter);

  // SPA fallback for client-side routing — only for non-API GET requests.
  app.get(/^(?!\/api\/).*/, (_req, res) => {
    res.sendFile(path.join(clientDist, 'index.html'));
  });

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
