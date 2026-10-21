import { Router } from 'express';

import { requireAuth, requirePermission } from '../../core/auth.js';
import * as controller from './users.controller.js';

export const usersRouter = Router();

usersRouter.use(requireAuth, requirePermission('users:manage'));
usersRouter.get('/', controller.list);
usersRouter.get('/options', controller.options);
usersRouter.get('/:id', controller.get);
usersRouter.post('/', controller.create);
usersRouter.patch('/:id', controller.update);
usersRouter.post('/:id/password', controller.resetPassword);
