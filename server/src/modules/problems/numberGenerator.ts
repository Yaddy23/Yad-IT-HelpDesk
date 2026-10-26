import type { Prisma } from '@prisma/client';

/**
 * Generate the next problem number in format PRB-YYYY-NNNNNN
 * Uses atomic increment in transaction.
 */
export async function generateProblemNumber(tx: Prisma.TransactionClient): Promise<string> {
  const counter = await tx.problemCounter.upsert({
    where: { key: 'PRB' },
    create: { key: 'PRB', next: 2 },
    update: { next: { increment: 1 } },
  });
  const year = new Date().getFullYear();
  return `PRB-${year}-${String(counter.next - 1).padStart(6, '0')}`;
}

/**
 * Generate the next known error number in format KE-YYYY-NNNNNN
 * Uses atomic increment in transaction.
 */
export async function generateKnownErrorNumber(tx: Prisma.TransactionClient): Promise<string> {
  const counter = await tx.knownErrorCounter.upsert({
    where: { key: 'KE' },
    create: { key: 'KE', next: 2 },
    update: { next: { increment: 1 } },
  });
  const year = new Date().getFullYear();
  return `KE-${year}-${String(counter.next - 1).padStart(6, '0')}`;
}