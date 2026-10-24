import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    setupFiles: ['./tests/setup.ts'],
    testTimeout: 30_000,
    hookTimeout: 120_000,
    pool: 'threads',
    maxWorkers: 1,
    maxConcurrency: 1,
    sequence: {
      hooks: 'list',
      concurrent: false,
    },
  },
});
