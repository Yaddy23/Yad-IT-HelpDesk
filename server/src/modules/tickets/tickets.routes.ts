import { Router } from 'express';
import multer from 'multer';

import { env } from '../../config/env.js';
import { requireAuth, requirePermission } from '../../core/auth.js';
import * as controller from './tickets.controller.js';

export const ticketsRouter = Router();

// Multipart uploads are held fully in memory (size-limited) then streamed to Supabase Storage.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: env.ATTACHMENTS_MAX_MB * 1024 * 1024, files: 1 },
});

// Every ticket endpoint requires a session; reads require the read permission.
ticketsRouter.use(requireAuth, requirePermission('tickets:read'));

ticketsRouter.get('/', controller.list);
ticketsRouter.post('/', requirePermission('tickets:create'), controller.create);
ticketsRouter.get('/queues', controller.queues);
ticketsRouter.get('/:id', controller.get);
ticketsRouter.post('/:id/assign', requirePermission('tickets:assign'), controller.assign);
ticketsRouter.post('/:id/transition', controller.transition); // permission checks inside (requester reopen/cancel)
ticketsRouter.post('/:id/priority', requirePermission('tickets:update'), controller.overridePriority);
ticketsRouter.post('/:id/comments', controller.addComment);
ticketsRouter.post('/:id/attachments', upload.single('file'), controller.uploadAttachment);
ticketsRouter.get('/:id/attachments', controller.listAttachments);
ticketsRouter.get('/:id/attachments/:attachmentId/download', controller.downloadAttachment);
