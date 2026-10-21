import { Router } from 'express';

import { authLimiter } from '../../core/rateLimit.js';
import { requireAuth } from '../../core/auth.js';
import * as authController from './auth.controller.js';

export const authRouter = Router();

authRouter.get('/roles', authController.roles);
authRouter.post('/bootstrap', authLimiter, authController.bootstrap);
authRouter.post('/login', authLimiter, authController.login);
authRouter.post('/refresh', authLimiter, authController.refresh);
authRouter.post('/logout', authController.logout);
authRouter.get('/me', requireAuth, authController.me);
