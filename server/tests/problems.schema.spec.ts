import { test, expect } from 'vitest';
import { PrismaClient } from '@prisma/client';

// Direct PrismaClient (not the app singleton) — the suite's setup.ts has
// already pointed DATABASE_URL at the test schema and applied migrations.
const prisma = new PrismaClient();

// setup.ts truncates every table in beforeEach, so fixtures are re-created
// per test (not in beforeAll) or the FK targets would be gone by test time.
async function seedFixtures() {
  const stamp = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const owner = await prisma.user.create({
    data: {
      email: `prb-owner-${stamp}@test.local`,
      passwordHash: 'x',
      name: 'Problem Owner',
    },
  });
  const requester = await prisma.employee.create({
    data: {
      employeeId: `EMP-PRB-${stamp}`,
      name: 'Test Requester',
      email: `prb-req-${stamp}@test.local`,
    },
  });
  const ticket = await prisma.ticket.create({
    data: {
      number: `INC-PRB-${stamp}`,
      title: 'Network disconnection',
      description: 'User reports intermittent connectivity',
      category: 'Network',
      impact: 'medium',
      urgency: 'high',
      priority: 'high',
      requesterId: requester.id,
    },
  });
  return { ownerId: owner.id, linkedById: owner.id, incidentId: ticket.id, stamp };
}

test('Problem model creates with all fields', async () => {
  const { ownerId, stamp } = await seedFixtures();
  const problem = await prisma.problem.create({
    data: {
      number: `PRB-${stamp}`,
      title: 'Network disconnections',
      description: 'Multiple users report intermittent connectivity',
      ownerId,
      businessImpact: 'Productivity loss for 15 employees',
      status: 'IDENTIFIED',
      priority: 'HIGH',
    },
  });
  expect(problem.id).toBeDefined();
  expect(problem.status).toBe('IDENTIFIED');
  expect(problem.priority).toBe('HIGH');
});

test('ProblemIncident links problem to incident', async () => {
  const { ownerId, linkedById, incidentId, stamp } = await seedFixtures();
  const problem = await prisma.problem.create({
    data: {
      number: `PRB-LINK-${stamp}`,
      title: 'Link test problem',
      description: 'Problem for incident linking',
      ownerId,
      businessImpact: 'Test',
    },
  });
  const link = await prisma.problemIncident.create({
    data: {
      problemId: problem.id,
      incidentId,
      linkedById,
      note: 'Related by symptom',
    },
  });
  expect(link.id).toBeDefined();

  const found = await prisma.problemIncident.findUnique({
    where: { problemId_incidentId: { problemId: problem.id, incidentId } },
  });
  expect(found).not.toBeNull();
  // The (problemId, incidentId) pair is unique — a duplicate insert must fail.
  await expect(
    prisma.problemIncident.create({
      data: { problemId: problem.id, incidentId, linkedById },
    }),
  ).rejects.toThrow();
});

test('KnownError model creates with lifecycle fields', async () => {
  const { ownerId, incidentId, stamp } = await seedFixtures();
  const problem = await prisma.problem.create({
    data: {
      number: `PRB-KE-${stamp}`,
      title: 'KE source problem',
      description: 'Problem that spawns a known error',
      ownerId,
      businessImpact: 'Test',
    },
  });
  const ke = await prisma.knownError.create({
    data: {
      number: `KE-${stamp}`,
      title: 'Network driver issue',
      problemId: problem.id,
      rootCause: 'Faulty NIC driver v2.1',
      symptoms: 'Intermittent disconnects under load',
      workaround: 'Rollback to driver v1.8',
      ownerId,
      status: 'DRAFT',
      visibility: 'IT_ONLY',
    },
  });
  expect(ke.id).toBeDefined();
  expect(ke.status).toBe('DRAFT');
  expect(ke.visibility).toBe('IT_ONLY');

  // DetectionSuggestion round-trip (transient detection record).
  const suggestion = await prisma.detectionSuggestion.create({
    data: {
      incidentIds: [incidentId],
      problemId: problem.id,
      score: 88,
      matchReasons: ['same_service', 'symptom_similarity'],
      expiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1000),
    },
  });
  expect(suggestion.status).toBe('PENDING');
  expect(suggestion.score).toBe(88);
});
