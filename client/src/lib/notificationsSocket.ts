import { io, type Socket } from 'socket.io-client';

import { loadTokens } from './api';

/**
 * Singleton notifications socket. Authenticates with the current access token
 * in the handshake; the server joins us to our personal room. The inbox API
 * remains the source of truth — socket events just invalidate queries live.
 */

let socket: Socket | null = null;

export function getNotificationsSocket(): Socket | null {
  if (socket?.connected) return socket;
  const tokens = loadTokens();
  if (!tokens?.accessToken) return null;

  socket ??= io('/', {
    path: '/socket.io',
    auth: { token: tokens.accessToken },
    reconnectionAttempts: 10,
    reconnectionDelay: 2_000,
  });

  // A refreshed token must be picked up on the next reconnect attempt.
  socket.on('reconnect_attempt', () => {
    const current = loadTokens();
    if (current?.accessToken) socket!.auth = { token: current.accessToken };
  });

  return socket;
}

export function closeNotificationsSocket(): void {
  socket?.close();
  socket = null;
}
