import { test, expect, beforeEach, vi } from 'vitest';
import { ProblemsService } from '../src/modules/problems/problems.service.js';
import { prisma } from '../src/prisma/client.js';
import type { AuthedUser } from '../src/core/request.js';

// setup.ts truncates every table in beforeEach, so fixtures are re-created
// per test (not in beforeAll) or the FK targets would be gone by test time.
async function seedFixtures() {
  const stamp = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const owner = await prisma.user.create({
    data: {
      email: `prb-owner-${stamp}@test.local`,
      passwordHash: 'x',
      name: 'Problem Owner',
      roles: { create: { role: 'it_technician' } },
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
  return { ownerId: owner.id, ownerEmail: owner.email, ownerName: owner.name, incidentId: ticket.id, stamp };
}

function makeUser(fixture: { ownerId: string; ownerEmail: string; ownerName: string }): AuthedUser {
  return { id: fixture.ownerId, email: fixture.ownerEmail, name: fixture.ownerName, roles: ['it_technician'] };
}

test('createProblem generates PRB number and sets identifiedAt', async () => {
  const service = new ProblemsService();
  const fixture = await seedFixtures();
  const user = makeUser(fixture);
  const problem = await service.create(user, {
    title: 'Test problem',
    description: 'Desc',
    ownerId: fixture.ownerId,
    priority: 'HIGH',
  });
  expect(problem.number).toMatch(/^PRB-\d{4}-\d{6}$/);
  expect(problem.status).toBe('IDENTIFIED');
  expect(problem.identifiedAt).toBeInstanceOf(Date);
});

test('transitionStatus validates ROOT_CAUSE_KNOWN requires confirmedRootCause', async () => {
  const service = new ProblemsService();
  const fixture = await seedFixtures();
  const user = makeUser(fixture);
  const problem = await service.create(user, { title: 'T', description: 'D', ownerId: fixture.ownerId });
  await expect(service.transitionStatus(user, problem.id, 'ROOT_CAUSE_KNOWN'))
    .rejects.toThrow('Root cause must be documented and confirmed');
});

test('transitionStatus allows ROOT_CAUSE_KNOWN with rootCause + confirmedRootCause', async () => {
  const service = new ProblemsService();
  const fixture = await seedFixtures();
  const user = makeUser(fixture);
  const problem = await service.create(user, { title: 'T', description: 'D', ownerId: fixture.ownerId });
  await service.updateRCA(user, problem.id, { rootCause: 'Cause', confirmedRootCause: true });
  const updated = await service.transitionStatus(user, problem.id, 'ROOT_CAUSE_KNOWN');
  expect(updated.status).toBe('ROOT_CAUSE_KNOWN');
  expect(updated.rootCauseIdentifiedAt).toBeInstanceOf(Date);
});

test('linkIncidents creates ProblemIncident records with audit', async () => {
  const service = new ProblemsService();
  const fixture = await seedFixtures();
  const user = makeUser(fixture);
  const problem = await service.create(user, { title: 'T', description: 'D', ownerId: fixture.ownerId });
  await service.linkIncidents(user, problem.id, [fixture.incidentId], 'Related by symptom');
  const detail = await service.get(user, problem.id);
  expect(detail.incidents).toHaveLength(1);
});

test('transitionStatus validates WORKAROUND_DOCUMENTED requires workaround', async () => {
  const service = new ProblemsService();
  const fixture = await seedFixtures();
  const user = makeUser(fixture);
  const problem = await service.create(user, { title: 'T', description: 'D', ownerId: fixture.ownerId });
  await service.transitionStatus(user, problem.id, 'INVESTIGATION');
  await expect(service.transitionStatus(user, problem.id, 'WORKAROUND_DOCUMENTED'))
    .rejects.toThrow('Workaround must be documented');
});

test('transitionStatus validates PENDING_CHANGE requires changeRequestIds', async () => {
  const service = new ProblemsService();
  const fixture = await seedFixtures();
  const user = makeUser(fixture);
  const problem = await service.create(user, { title: 'T', description: 'D', ownerId: fixture.ownerId });
  await service.transitionStatus(user, problem.id, 'INVESTIGATION');
  await expect(service.transitionStatus(user, problem.id, 'PENDING_CHANGE'))
    .rejects.toThrow('At least one change request must be linked');
});

test('transitionStatus validates RESOLVED requires resolutionSummary and verifiedFix or exception', async () => {
  const service = new ProblemsService();
  const fixture = await seedFixtures();
  const user = makeUser(fixture);
  const problem = await service.create(user, { title: 'T', description: 'D', ownerId: fixture.ownerId });
  await service.transitionStatus(user, problem.id, 'INVESTIGATION');
  await expect(service.transitionStatus(user, problem.id, 'RESOLVED'))
    .rejects.toThrow('Resolution summary and verified fix or exception reason required');
});

test('transitionStatus allows RESOLVED with resolutionSummary and verifiedFix', async () => {
  const service = new ProblemsService();
  const fixture = await seedFixtures();
  const user = makeUser(fixture);
  const problem = await service.create(user, { title: 'T', description: 'D', ownerId: fixture.ownerId });
  await service.transitionStatus(user, problem.id, 'INVESTIGATION');
  await service.updateRCA(user, problem.id, { rootCause: 'Cause', confirmedRootCause: true });
  await service.transitionStatus(user, problem.id, 'ROOT_CAUSE_KNOWN');
  await service.setWorkaround(user, problem.id, 'Workaround text');
  await service.transitionStatus(user, problem.id, 'WORKAROUND_DOCUMENTED');
  await service.linkChangeRequest(user, problem.id, 'change-1');
  await service.transitionStatus(user, problem.id, 'PENDING_CHANGE');
  const updated = await service.transitionStatus(user, problem.id, 'RESOLVED', { verifiedFix: true, resolutionSummary: 'Fixed' });
  expect(updated.status).toBe('RESOLVED');
  expect(updated.resolvedAt).toBeInstanceOf(Date);
});

test('transitionStatus CLOSED is terminal', async () => {
  const service = new ProblemsService();
  const fixture = await seedFixtures();
  const user = makeUser(fixture);
  const problem = await service.create(user, { title: 'T', description: 'D', ownerId: fixture.ownerId });
  await service.transitionStatus(user, problem.id, 'INVESTIGATION');
  await service.updateRCA(user, problem.id, { rootCause: 'Cause', confirmedRootCause: true });
  await service.transitionStatus(user, problem.id, 'ROOT_CAUSE_KNOWN');
  await service.setWorkaround(user, problem.id, 'Workaround');
  await service.transitionStatus(user, problem.id, 'WORKAROUND_DOCUMENTED');
  await service.linkChangeRequest(user, problem.id, 'change-1');
  await service.transitionStatus(user, problem.id, 'PENDING_CHANGE');
  await service.transitionStatus(user, problem.id, 'RESOLVED', { verifiedFix: true, resolutionSummary: 'Fixed' });
  await service.transitionStatus(user, problem.id, 'CLOSED');
  await expect(service.transitionStatus(user, problem.id, 'INVESTIGATION'))
    .rejects.toThrow('Cannot transition from CLOSED');
});

test('transitionStatus allows RESOLVED to INVESTIGATION reopen', async () => {
  const service = new ProblemsService();
  const fixture = await seedFixtures();
  const user = makeUser(fixture);
  const problem = await service.create(user, { title: 'T', description: 'D', ownerId: fixture.ownerId });
  await service.transitionStatus(user, problem.id, 'INVESTIGATION');
  await service.updateRCA(user, problem.id, { rootCause: 'Cause', confirmedRootCause: true });
  await service.transitionStatus(user, problem.id, 'ROOT_CAUSE_KNOWN');
  await service.setWorkaround(user, problem.id, 'Workaround');
  await service.transitionStatus(user, problem.id, 'WORKAROUND_DOCUMENTED');
  await service.linkChangeRequest(user, problem.id, 'change-1');
  await service.transitionStatus(user, problem.id, 'PENDING_CHANGE');
  await service.transitionStatus(user, problem.id, 'RESOLVED', { verifiedFix: true, resolutionSummary: 'Fixed' });
  const reopened = await service.transitionStatus(user, problem.id, 'INVESTIGATION');
  expect(reopened.status).toBe('INVESTIGATION');
});

test('getAuditLog returns audit entries for status transitions', async () => {
  const service = new ProblemsService();
  const fixture = await seedFixtures();
  const user = makeUser(fixture);
  const problem = await service.create(user, { title: 'T', description: 'D', ownerId: fixture.ownerId });
  await service.transitionStatus(user, problem.id, 'INVESTIGATION');
  const audit = await service.getAuditLog(user, problem.id, { page: 1, limit: 10 });
  expect(audit.data.length).toBeGreaterThanOrEqual(1);
  expect(audit.data[0].action).toBe('STATUS_CHANGED');
  expect(audit.meta.total).toBe(audit.data.length);
});