import type { ProblemStatus } from '@prisma/client';
import { test, expect } from 'vitest';

import { handleChangeEvent } from '../src/modules/problems/changeConsumer.js';
import { prisma } from '../src/prisma/client.js';

// setup.ts truncates every table in beforeEach, so fixtures are built per test.
let sequence = 0;

async function createTestProblem(input: { changeRequestIds?: string[]; status?: ProblemStatus } = {}) {
  sequence += 1;
  const stamp = `${Date.now()}-${sequence}`;
  const owner = await prisma.user.create({
    data: {
      email: `chg-owner-${stamp}@test.local`,
      passwordHash: 'x',
      name: 'Change Owner',
      roles: { create: { role: 'it_technician' } },
    },
  });
  const problem = await prisma.problem.create({
    data: {
      number: `PRB-CHG-${stamp}`,
      title: 'Recurring VPN drops',
      description: 'VPN disconnects every hour',
      ownerId: owner.id,
      affectedServices: ['Network'],
      affectedAssets: [],
      affectedCIs: [],
      businessImpact: '',
      status: input.status ?? 'PENDING_CHANGE',
      changeRequestIds: input.changeRequestIds ?? [],
    },
  });
  return { problem, ownerId: owner.id };
}

function getNotificationsForUser(userId: string) {
  return prisma.notification.findMany({ where: { userId } });
}

test('change.implemented notifies owner and suggests verification', async () => {
  const { problem, ownerId } = await createTestProblem({ changeRequestIds: ['chg-1'] });

  await handleChangeEvent('change.implemented', { changeId: 'chg-1', status: 'IMPLEMENTED' });

  const notifications = await getNotificationsForUser(ownerId);
  expect(notifications).toHaveLength(1);
  expect(notifications[0]).toMatchObject({
    type: 'CHANGE_IMPLEMENTED',
    title: 'Change request implemented',
  });
  expect(notifications[0].body).toContain('verify the fix');
  expect(notifications[0].body).toContain(problem.number);
});

test('change.rolled_back offers to reopen problem', async () => {
  const { ownerId } = await createTestProblem({ status: 'RESOLVED', changeRequestIds: ['chg-1'] });

  await handleChangeEvent('change.rolled_back', { changeId: 'chg-1' });

  const notifications = await getNotificationsForUser(ownerId);
  expect(notifications).toHaveLength(1);
  expect(notifications[0]).toMatchObject({ type: 'CHANGE_ROLLED_BACK' });
  expect(notifications[0].body).toContain('reopen');
});

test('change.approved and change.rejected notify without touching problem status', async () => {
  const { problem, ownerId } = await createTestProblem({ changeRequestIds: ['chg-1'] });

  await handleChangeEvent('change.approved', { changeId: 'chg-1' });
  await handleChangeEvent('change.rejected', { changeId: 'chg-1' });

  const notifications = await getNotificationsForUser(ownerId);
  expect(notifications.map((n) => n.type).sort()).toEqual(['CHANGE_APPROVED', 'CHANGE_REJECTED']);

  // No automatic lifecycle coupling — the spec lists it as a non-goal.
  const after = await prisma.problem.findUniqueOrThrow({ where: { id: problem.id } });
  expect(after.status).toBe('PENDING_CHANGE');
});

test('change.rolled_back does not reopen the problem by itself', async () => {
  const { problem, ownerId } = await createTestProblem({ status: 'RESOLVED', changeRequestIds: ['chg-1'] });

  await handleChangeEvent('change.rolled_back', { changeId: 'chg-1' });

  const after = await prisma.problem.findUniqueOrThrow({ where: { id: problem.id } });
  expect(after.status).toBe('RESOLVED');
  // The move stays available to a human: RESOLVED -> INVESTIGATION is legal.
  expect((await getNotificationsForUser(ownerId))[0].body).toContain('You can reopen the problem');
});

test('every problem linked to the change is notified, and only those', async () => {
  sequence += 1;
  const stamp = `${Date.now()}-${sequence}`;
  const owner = await prisma.user.create({
    data: {
      email: `chg-multi-${stamp}@test.local`,
      passwordHash: 'x',
      name: 'Multi Owner',
      roles: { create: { role: 'it_manager' } },
    },
  });
  const other = await prisma.user.create({
    data: {
      email: `chg-other-${stamp}@test.local`,
      passwordHash: 'x',
      name: 'Other Owner',
      roles: { create: { role: 'it_technician' } },
    },
  });

  const makeProblem = (ownerId: string, changeRequestIds: string[], suffix: string) =>
    prisma.problem.create({
      data: {
        number: `PRB-CHG-${stamp}-${suffix}`,
        title: `Problem ${suffix}`,
        description: 'Desc',
        ownerId,
        affectedServices: [],
        affectedAssets: [],
        affectedCIs: [],
        businessImpact: '',
        changeRequestIds,
      },
    });

  await makeProblem(owner.id, ['chg-1'], 'a');
  await makeProblem(owner.id, ['chg-1'], 'b');
  await makeProblem(other.id, ['chg-2'], 'c');

  const notified = await handleChangeEvent('change.implemented', { changeId: 'chg-1' });

  expect(notified).toBe(2);
  expect(await getNotificationsForUser(owner.id)).toHaveLength(2);
  expect(await getNotificationsForUser(other.id)).toHaveLength(0);
});

test('a replayed change event does not notify twice', async () => {
  const { ownerId } = await createTestProblem({ changeRequestIds: ['chg-1'] });

  await handleChangeEvent('change.implemented', { changeId: 'chg-1' });
  await handleChangeEvent('change.implemented', { changeId: 'chg-1' });

  expect(await getNotificationsForUser(ownerId)).toHaveLength(1);
});

test('an unlinked change notifies nobody', async () => {
  const { ownerId } = await createTestProblem({ changeRequestIds: ['chg-1'] });

  expect(await handleChangeEvent('change.implemented', { changeId: 'chg-9' })).toBe(0);
  expect(await getNotificationsForUser(ownerId)).toHaveLength(0);
});

test('an unknown event or a missing changeId is ignored, not thrown', async () => {
  const { problem, ownerId } = await createTestProblem({ changeRequestIds: ['chg-1'] });

  expect(await handleChangeEvent('change.exploded', { changeId: 'chg-1' })).toBe(0);
  expect(await handleChangeEvent('change.implemented', { changeId: '' })).toBe(0);

  expect(await getNotificationsForUser(ownerId)).toHaveLength(0);
  expect((await prisma.problem.findUniqueOrThrow({ where: { id: problem.id } })).status).toBe('PENDING_CHANGE');
});
