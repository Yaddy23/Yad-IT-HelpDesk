import type { Role } from '@prisma/client';
import { test, expect } from 'vitest';

import type { AuthedUser } from '../src/core/request.js';
import { KnownErrorsService } from '../src/modules/known-errors/knownErrors.service.js';
import { prisma } from '../src/prisma/client.js';

// setup.ts truncates every table in beforeEach, so fixtures are built per test.
const service = new KnownErrorsService();
let sequence = 0;

function stamp(): string {
  sequence += 1;
  return `${Date.now()}-${sequence}`;
}

async function makeActor(role: Role): Promise<{ userId: string; actor: AuthedUser }> {
  const s = stamp();
  const user = await prisma.user.create({
    data: {
      email: `ke-${role}-${s}@test.local`,
      passwordHash: 'x',
      name: `${role} user`,
      roles: { create: { role } },
    },
  });
  return {
    userId: user.id,
    actor: { id: user.id, email: user.email, name: user.name, roles: [role] },
  };
}

async function makeProblem(ownerId: string, affectedServices: string[] = ['Network']) {
  return prisma.problem.create({
    data: {
      number: `PRB-KE-${stamp()}`,
      title: 'Recurring VPN drops',
      description: 'VPN disconnects every hour',
      ownerId,
      affectedServices,
      affectedAssets: [],
      affectedCIs: [],
      businessImpact: '',
    },
  });
}

interface CreateOverrides {
  title?: string;
  rootCause?: string;
  symptoms?: string;
  workaround?: string;
  affectedServices?: string[];
}

async function createKnownError(
  actor: AuthedUser,
  problemId: string,
  overrides: CreateOverrides = {},
) {
  return service.create(actor, {
    problemId,
    title: overrides.title ?? 'Network driver workaround',
    rootCause: overrides.rootCause ?? 'Faulty network driver',
    symptoms: overrides.symptoms ?? 'VPN disconnects every hour',
    workaround: overrides.workaround ?? 'Roll back the network driver',
    affectedServices: overrides.affectedServices,
  });
}

/** Walk a KE to PUBLISHED through the legal path. */
async function publishKnownError(actor: AuthedUser, id: string) {
  await service.transitionStatus(actor, id, 'UNDER_REVIEW');
  return service.transitionStatus(actor, id, 'PUBLISHED');
}

test('create generates a KE number, links the problem, and defaults to DRAFT / IT_ONLY', async () => {
  const { userId, actor } = await makeActor('it_manager');
  const problem = await makeProblem(userId);

  const knownError = await createKnownError(actor, problem.id);

  expect(knownError.number).toMatch(/^KE-\d{4}-\d{6}$/);
  expect(knownError.status).toBe('DRAFT');
  expect(knownError.visibility).toBe('IT_ONLY');
  expect(knownError.problemId).toBe(problem.id);
  // Scope is inherited from the problem rather than left empty.
  expect(knownError.affectedServices).toEqual(['Network']);

  const after = await prisma.problem.findUniqueOrThrow({ where: { id: problem.id } });
  expect(after.knownErrorId).toBe(knownError.id);
});

test('create numbers known errors independently of each other', async () => {
  const { userId, actor } = await makeActor('it_manager');
  const problem = await makeProblem(userId);

  const first = await createKnownError(actor, problem.id);
  const second = await createKnownError(actor, problem.id);

  expect(first.number).not.toBe(second.number);
  expect(first.number.endsWith('000001')).toBe(true);
  expect(second.number.endsWith('000002')).toBe(true);
});

test('a second known error does not displace the problem primary link', async () => {
  const { userId, actor } = await makeActor('it_manager');
  const problem = await makeProblem(userId);

  const first = await createKnownError(actor, problem.id);
  const second = await createKnownError(actor, problem.id);

  const after = await prisma.problem.findUniqueOrThrow({ where: { id: problem.id } });
  expect(after.knownErrorId).toBe(first.id);
  // The second is still linked through KnownError.problemId.
  expect(second.problemId).toBe(problem.id);
});

test('create rejects an unknown problem rather than writing a dangling known error', async () => {
  const { actor } = await makeActor('it_manager');

  await expect(createKnownError(actor, 'problem-that-does-not-exist')).rejects.toThrow(
    'Problem not found',
  );
  expect(await prisma.knownError.count()).toBe(0);
});

test('create requires known_errors:create', async () => {
  const manager = await makeActor('it_manager');
  const problem = await makeProblem(manager.userId);
  const technician = await makeActor('it_technician');

  await expect(createKnownError(technician.actor, problem.id)).rejects.toThrow(
    'Insufficient permissions',
  );
  expect(await prisma.knownError.count()).toBe(0);
});

test('DRAFT -> UNDER_REVIEW requires the approver permission', async () => {
  const { userId, actor } = await makeActor('it_manager');
  const problem = await makeProblem(userId);
  const knownError = await createKnownError(actor, problem.id);
  const technician = await makeActor('it_technician');

  await expect(
    service.transitionStatus(technician.actor, knownError.id, 'UNDER_REVIEW'),
  ).rejects.toThrow('Insufficient permissions');

  const after = await prisma.knownError.findUniqueOrThrow({ where: { id: knownError.id } });
  expect(after.status).toBe('DRAFT');
});

test('DRAFT cannot jump straight to PUBLISHED', async () => {
  const { userId, actor } = await makeActor('it_manager');
  const problem = await makeProblem(userId);
  const knownError = await createKnownError(actor, problem.id);

  await expect(service.transitionStatus(actor, knownError.id, 'PUBLISHED')).rejects.toThrow(
    'Cannot move a DRAFT known error to PUBLISHED',
  );
});

test('PUBLISHED stamps the approver and the review schedule', async () => {
  const { userId, actor } = await makeActor('it_manager');
  const problem = await makeProblem(userId);
  const knownError = await createKnownError(actor, problem.id);

  const published = await publishKnownError(actor, knownError.id);

  expect(published.status).toBe('PUBLISHED');
  expect(published.approvedById).toBe(userId);
  expect(published.approvedAt).toBeInstanceOf(Date);
  expect(published.lastReviewedAt).toBeInstanceOf(Date);
  expect(published.reviewDueAt).toBeInstanceOf(Date);
  // Default review period is KNOWN_ERROR_REVIEW_DAYS = 90.
  const days = (published.reviewDueAt!.getTime() - published.approvedAt!.getTime()) / 86_400_000;
  expect(Math.round(days)).toBe(90);
});

test('RETIRED is terminal', async () => {
  const { userId, actor } = await makeActor('it_manager');
  const problem = await makeProblem(userId);
  const knownError = await createKnownError(actor, problem.id);

  await service.transitionStatus(actor, knownError.id, 'RETIRED');

  await expect(service.transitionStatus(actor, knownError.id, 'DRAFT')).rejects.toThrow(
    'Cannot transition from RETIRED',
  );
});

test('a known error cannot become employee-visible before it is published', async () => {
  const { userId, actor } = await makeActor('it_manager');
  const problem = await makeProblem(userId);
  const knownError = await createKnownError(actor, problem.id);

  await expect(
    service.update(actor, knownError.id, { visibility: 'EMPLOYEE_SELF_SERVICE' }),
  ).rejects.toThrow('must be published before it can be employee-visible');

  const after = await prisma.knownError.findUniqueOrThrow({ where: { id: knownError.id } });
  expect(after.visibility).toBe('IT_ONLY');
});

test('a retired known error is read-only', async () => {
  const { userId, actor } = await makeActor('it_manager');
  const problem = await makeProblem(userId);
  const knownError = await createKnownError(actor, problem.id);
  await service.transitionStatus(actor, knownError.id, 'RETIRED');

  await expect(
    service.update(actor, knownError.id, { workaround: 'Something else entirely' }),
  ).rejects.toThrow('Cannot edit a retired known error');

  const after = await prisma.knownError.findUniqueOrThrow({ where: { id: knownError.id } });
  expect(after.workaround).toBe('Roll back the network driver');
});

test('update requires known_errors:update', async () => {
  const { userId, actor } = await makeActor('it_manager');
  const problem = await makeProblem(userId);
  const knownError = await createKnownError(actor, problem.id);
  const technician = await makeActor('it_technician');

  await expect(
    service.update(technician.actor, knownError.id, { title: 'Renamed' }),
  ).rejects.toThrow('Insufficient permissions');
});

test('publishKB refuses a known error that has not been approved', async () => {
  const { userId, actor } = await makeActor('it_manager');
  const problem = await makeProblem(userId);
  const knownError = await createKnownError(actor, problem.id);

  await expect(service.publishKB(actor, knownError.id)).rejects.toThrow(
    'must be published before it can be added to the knowledge base',
  );
  expect(await prisma.knowledgeArticle.count()).toBe(0);
});

test('publishKB creates a published article, links it, and makes the known error employee-visible', async () => {
  const { userId, actor } = await makeActor('it_manager');
  const problem = await makeProblem(userId);
  const knownError = await createKnownError(actor, problem.id);
  await publishKnownError(actor, knownError.id);

  const published = await service.publishKB(actor, knownError.id);

  expect(published.publishedArticleId).toBeDefined();
  expect(published.visibility).toBe('EMPLOYEE_SELF_SERVICE');

  const article = await prisma.knowledgeArticle.findUniqueOrThrow({
    where: { id: published.publishedArticleId! },
    include: { revisions: true },
  });
  expect(article.status).toBe('published');
  expect(article.visibility).toBe('public');
  expect(article.publishedAt).toBeInstanceOf(Date);
  expect(article.authorId).toBe(userId);
  // Category comes from the known error's scope, not an invented value.
  expect(article.category).toBe('Network');
  expect(article.tags).toContain(knownError.number);
  // The workaround is the reason the article exists, so it must be in the body.
  expect(article.body).toContain('Roll back the network driver');
  expect(article.body).toContain(knownError.number);
  expect(article.revisions).toHaveLength(1);
  expect(article.revisions[0].revisionNumber).toBe(1);
});

test('publishKB maps IT_ONLY onto an internal article', async () => {
  const { userId, actor } = await makeActor('it_manager');
  const problem = await makeProblem(userId);
  const knownError = await createKnownError(actor, problem.id);
  await publishKnownError(actor, knownError.id);

  const published = await service.publishKB(actor, knownError.id, { visibility: 'IT_ONLY' });

  expect(published.visibility).toBe('IT_ONLY');
  const article = await prisma.knowledgeArticle.findUniqueOrThrow({
    where: { id: published.publishedArticleId! },
  });
  expect(article.visibility).toBe('internal');
});

test('publishKB is idempotent — re-publishing updates the same article', async () => {
  const { userId, actor } = await makeActor('it_manager');
  const problem = await makeProblem(userId);
  const knownError = await createKnownError(actor, problem.id);
  await publishKnownError(actor, knownError.id);

  const first = await service.publishKB(actor, knownError.id);
  await service.update(actor, knownError.id, { workaround: 'Disable IPv6 on the tunnel adapter' });
  const second = await service.publishKB(actor, knownError.id);

  expect(second.publishedArticleId).toBe(first.publishedArticleId);
  expect(await prisma.knowledgeArticle.count()).toBe(1);

  const article = await prisma.knowledgeArticle.findUniqueOrThrow({
    where: { id: first.publishedArticleId! },
    include: { revisions: true },
  });
  expect(article.version).toBe(2);
  expect(article.body).toContain('Disable IPv6 on the tunnel adapter');
  expect(article.revisions).toHaveLength(2);
});

test('publishKB requires known_errors:publish', async () => {
  const { userId, actor } = await makeActor('it_manager');
  const problem = await makeProblem(userId);
  const knownError = await createKnownError(actor, problem.id);
  await publishKnownError(actor, knownError.id);
  const technician = await makeActor('it_technician');

  await expect(service.publishKB(technician.actor, knownError.id)).rejects.toThrow(
    'Insufficient permissions',
  );
  expect(await prisma.knowledgeArticle.count()).toBe(0);
});

test('search finds published workarounds and hides unapproved drafts', async () => {
  const { userId, actor } = await makeActor('it_manager');
  const problem = await makeProblem(userId);

  const draft = await createKnownError(actor, problem.id, { title: 'Draft driver workaround' });
  const live = await createKnownError(actor, problem.id, {
    title: 'Published driver workaround',
    workaround: 'Roll back the network driver',
  });
  await publishKnownError(actor, live.id);

  const results = await service.search(actor, { q: 'driver', limit: 20 });

  expect(results.map((r) => r.id)).toEqual([live.id]);
  expect(results.map((r) => r.id)).not.toContain(draft.id);
});

test('search matches on the workaround text, not just the title', async () => {
  const { userId, actor } = await makeActor('it_manager');
  const problem = await makeProblem(userId);
  const live = await createKnownError(actor, problem.id, {
    title: 'Unrelated heading',
    workaround: 'Flush the DNS resolver cache',
  });
  await publishKnownError(actor, live.id);

  const results = await service.search(actor, { q: 'resolver', limit: 20 });
  expect(results.map((r) => r.id)).toEqual([live.id]);
});

test('list filters by status and visibility and hides soft-deleted rows', async () => {
  const { userId, actor } = await makeActor('it_manager');
  const problem = await makeProblem(userId);

  const draft = await createKnownError(actor, problem.id, { title: 'Draft one' });
  const live = await createKnownError(actor, problem.id, { title: 'Live one' });
  await publishKnownError(actor, live.id);
  const deleted = await createKnownError(actor, problem.id, { title: 'Deleted one' });
  await prisma.knownError.update({ where: { id: deleted.id }, data: { deletedAt: new Date() } });

  const drafts = await service.list(actor, {
    page: 1,
    limit: 20,
    sort: 'createdAt',
    order: 'desc',
    status: ['DRAFT'],
  });
  expect(drafts.knownErrors.map((k) => k.id)).toEqual([draft.id]);
  expect(drafts.total).toBe(1);

  const published = await service.list(actor, {
    page: 1,
    limit: 20,
    sort: 'createdAt',
    order: 'desc',
    status: ['PUBLISHED'],
  });
  expect(published.knownErrors.map((k) => k.id)).toEqual([live.id]);

  const all = await service.list(actor, { page: 1, limit: 20, sort: 'createdAt', order: 'desc' });
  expect(all.total).toBe(2);
});

test('get and list require known_errors:read', async () => {
  const { userId, actor } = await makeActor('it_manager');
  const problem = await makeProblem(userId);
  const knownError = await createKnownError(actor, problem.id);
  const employee = await makeActor('employee');

  await expect(service.get(employee.actor, knownError.id)).rejects.toThrow('Insufficient permissions');
  await expect(
    service.list(employee.actor, { page: 1, limit: 20, sort: 'createdAt', order: 'desc' }),
  ).rejects.toThrow('Insufficient permissions');
});

test('get reports a missing or soft-deleted known error as not found', async () => {
  const { userId, actor } = await makeActor('it_manager');
  const problem = await makeProblem(userId);
  const knownError = await createKnownError(actor, problem.id);
  await prisma.knownError.update({ where: { id: knownError.id }, data: { deletedAt: new Date() } });

  await expect(service.get(actor, knownError.id)).rejects.toThrow('Known error not found');
  await expect(service.get(actor, 'no-such-id')).rejects.toThrow('Known error not found');
});
