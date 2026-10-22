import type { Server as HttpServer } from 'node:http';

import { Server } from 'socket.io';

import { logger } from './logger.js';
import { verifyAccessToken } from '../modules/auth/tokens.js';

/**
 * Socket.IO live delivery. Clients authenticate with their JWT access token in
 * the handshake (`auth.token`); every socket joins exactly one personal room
 * (`user:{id}`). Emission is fire-and-forget from service code — a missed
 * socket is harmless because the inbox API is the source of truth.
 */

let io: Server | null = null;

export function initSocketServer(httpServer: HttpServer): Server {
  io = new Server(httpServer, {
    path: '/socket.io',
    cors: { origin: true, credentials: true },
  });

  io.use((socket, next) => {
    try {
      const token = socket.handshake.auth?.token;
      if (typeof token !== 'string' || token.length === 0) return next(new Error('unauthorized'));
      const payload = verifyAccessToken(token);
      socket.data.userId = payload.sub;
      next();
    } catch {
      next(new Error('unauthorized'));
    }
  });

  io.on('connection', (socket) => {
    socket.join(`user:${socket.data.userId as string}`);
  });

  logger.info('[socket] live delivery ready');
  return io;
}

export function emitToUser(userId: string, event: string, payload: unknown): void {
  io?.to(`user:${userId}`).emit(event, payload);
}

export async function closeSocketServer(): Promise<void> {
  if (!io) return;
  await io.close();
  io = null;
}
