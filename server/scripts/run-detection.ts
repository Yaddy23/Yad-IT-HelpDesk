/**
 * One-off detection scan for development and tests: runs the same engine the
 * scheduled worker runs, outside BullMQ. The window is the first argument in
 * hours (default: 7 days, the scheduled scan's maximum).
 *
 *   npx tsx scripts/run-detection.ts [windowHours]
 */
import 'dotenv/config';

import { prisma } from '../src/prisma/client.js';
import { runDetection } from '../src/modules/problems/detection/detectionEngine.js';

async function main(): Promise<void> {
  const hours = Number(process.argv[2] ?? 24 * 7);
  if (!Number.isFinite(hours) || hours <= 0) {
    console.error('[run-detection] window must be a positive number of hours');
    process.exitCode = 1;
    return;
  }
  const created = await runDetection(new Date(Date.now() - hours * 3_600_000));
  console.log(`[run-detection] window: last ${hours}h — ${created.length} suggestion(s) created`);
  for (const suggestion of created) {
    console.log(`[run-detection]   ${suggestion.problemId ?? 'new'} score=${suggestion.score} incidents=${suggestion.incidentIds.length}`);
  }
}

main()
  .catch((err) => {
    console.error('[run-detection] failed:', err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
