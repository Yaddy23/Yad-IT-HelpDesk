/**
 * Minimal structured logger. Never pass secrets (passwords, tokens, hashes)
 * to these functions — callers log metadata only.
 */
type Level = 'debug' | 'info' | 'warn' | 'error';

function log(level: Level, msg: string, meta?: unknown) {
  const line = `[${new Date().toISOString()}] [${level}] ${msg}`;
  if (level === 'error') console.error(line, meta ?? '');
  else if (level === 'warn') console.warn(line, meta ?? '');
  else console.log(line, meta ?? '');
}

export const logger = {
  debug: (msg: string, meta?: unknown) => log('debug', msg, meta),
  info: (msg: string, meta?: unknown) => log('info', msg, meta),
  warn: (msg: string, meta?: unknown) => log('warn', msg, meta),
  error: (msg: string, meta?: unknown) => log('error', msg, meta),
};
