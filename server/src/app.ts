import path from 'node:path';

import express, { type Express } from 'express';
import helmet from 'helmet';

import { isProd } from './config/env.js';
import { errorHandler, notFoundHandler } from './core/errors.js';
import { apiLimiter } from './core/rateLimit.js';
import { requestLogger, sanitizeBody } from './core/requestLogger.js';
import { authRouter } from './modules/auth/auth.routes.js';
import { usersRouter } from './modules/users/users.routes.js';
import { departmentsRouter, groupsRouter, locationsRouter, orgRouter } from './modules/org/org.routes.js';
import { settingsRouter } from './modules/settings/settings.routes.js';
import { auditRouter } from './modules/audit/audit.routes.js';
import { ticketsRouter } from './modules/tickets/tickets.routes.js';
import { searchRouter } from './modules/search/search.routes.js';
import { notificationsRouter } from './modules/notifications/notifications.routes.js';
import { slaRouter } from './modules/sla/sla.routes.js';
import { assetsRouter, vendorsRouter } from './modules/assets/assets.routes.js';
import { inventoryRouter } from './modules/inventory/inventory.routes.js';
import { licensesRouter } from './modules/licenses/licenses.routes.js';
import { assetAuditsRouter } from './modules/audits/audits.routes.js';
import { catalogRouter } from './modules/serviceMgmt/catalog.routes.js';
import { requestsRouter } from './modules/serviceMgmt/requests.routes.js';
import { approvalsRouter } from './modules/serviceMgmt/approvals.routes.js';
import { knowledgeRouter } from './modules/knowledge/knowledge.routes.js';

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
  app.use('/api/v1/org', orgRouter);
  app.use('/api/v1/departments', departmentsRouter);
  app.use('/api/v1/locations', locationsRouter);
  app.use('/api/v1/groups', groupsRouter);
  app.use('/api/v1/settings', settingsRouter);
  app.use('/api/v1/audit', auditRouter);
  app.use('/api/v1/tickets', ticketsRouter);
  app.use('/api/v1/search', searchRouter);
  app.use('/api/v1/notifications', notificationsRouter);
  app.use('/api/v1/sla-policies', slaRouter);
  app.use('/api/v1/assets', assetsRouter);
  app.use('/api/v1/vendors', vendorsRouter);
  app.use('/api/v1/inventory', inventoryRouter);
  app.use('/api/v1/licenses', licensesRouter);
  app.use('/api/v1/asset-audits', assetAuditsRouter);
  app.use('/api/v1/catalog', catalogRouter);
  app.use('/api/v1/service-requests', requestsRouter);
  app.use('/api/v1/approvals', approvalsRouter);
  app.use('/api/v1/knowledge', knowledgeRouter);

  // SPA fallback for client-side routing — only for non-API GET requests.
  app.get(/^(?!\/api\/).*/, (_req, res) => {
    res.sendFile(path.join(clientDist, 'index.html'));
  });

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
