import type { ProblemStatus } from '@prisma/client';
import { test, expect } from 'vitest';

import { createProblemFromIncidents, runDetection, scanWindow } from '../src/modules/problems/detection/detectionEngine.js';
import {
  findSimilarProblems,
  scoreIncidentAgainstProblem,
  symptomSimilarity,
  timePatternBoost,
  tokenize,
} from '../src/modules/problems/detection/scoring.js';
import { prisma } from '../src/prisma/client.js';

/* ── Pure scoring ──────────────────────────────────────────────────────────── */

test('exact match on service + asset scores 100', () => {
  const incident = { service: 'Network', category: 'Connectivity', assetId: 'asset-1', symptoms: 'disconnect' };
  const problem = { affectedServices: ['Network'], affectedAssets: ['asset-1'] };
  expect(scoreIncidentAgainstProblem(incident, problem)).toBe(100);
});

test('fuzzy symptom similarity adds partial score', () => {
  const incident = { symptoms: 'network disconnect intermittent' };
  const problem = { affectedServices: ['Network'] };
  const score = scoreIncidentAgainstProblem(incident, problem);
  expect(score).toBeGreaterThan(50);
  expect(score).toBeLessThan(100);
});

test('a problem that declares nothing scores nothing', () => {
  // An empty declaration must not collect points for criteria it never stated.
  expect(scoreIncidentAgainstProblem({ service: 'Network', symptoms: 'network down' }, {})).toBe(0);
});

test('mismatched service and symptoms score 0', () => {
  const incident = { service: 'Printing', symptoms: 'printer offline paper jam' };
  const problem = { affectedServices: ['Network'], title: 'Network outage', description: 'Switch failure' };
  expect(scoreIncidentAgainstProblem(incident, problem)).toBe(0);
});

test('time pattern: 3+ same category in 24h boosts score', () => {
  const incidents = Array(3).fill({ category: 'Connectivity', createdAt: new Date() });
  expect(timePatternBoost(incidents, 'Connectivity')).toBeGreaterThan(0);
});

test('time pattern: two incidents is not a pattern, and an old one does not count', () => {
  const two = Array(2).fill({ category: 'Connectivity', createdAt: new Date() });
  expect(timePatternBoost(two, 'Connectivity')).toBe(0);

  const stale = Array(3).fill({ category: 'Connectivity', createdAt: new Date(Date.now() - 48 * 3_600_000) });
  expect(timePatternBoost(stale, 'Connectivity')).toBe(0);

  const other = Array(3).fill({ category: 'Printing', createdAt: new Date() });
  expect(timePatternBoost(other, 'Connectivity')).toBe(0);
});

test('timePatternBoost caps so a huge cluster cannot dominate the score', () => {
  const many = Array(50).fill({ category: 'Connectivity', createdAt: new Date() });
  expect(timePatternBoost(many, 'Connectivity')).toBeLessThanOrEqual(20);
});

test('symptomSimilarity drops stopwords and short tokens', () => {
  // "the", "and", "is" are stopwords; "a"/"of" are below the length floor.
  expect(tokenize('The network is a bit of a problem')).toEqual(['network', 'bit']);
  expect(symptomSimilarity('network down', 'the network is down')).toBe(1);
  expect(symptomSimilarity('', 'network down')).toBe(0);
  expect(symptomSimilarity('network down', '')).toBe(0);
});

test('findSimilarProblems filters below threshold and sorts best first', () => {
  const incident = { service: 'Network', symptoms: 'network disconnect intermittent' };
  const problems = [
    { id: 'weak', affectedServices: ['Network'], title: 'Unrelated', description: 'Something else entirely here' },
    { id: 'strong', affectedServices: ['Network'], title: 'Network disconnect', description: 'Intermittent network disconnect' },
  ];
  const found = findSimilarProblems(incident, problems, 50);
  expect(found.map((entry) => entry.problem.id)).toEqual(['strong', 'weak']);
  expect(found.every((entry) => entry.score >= 50)).toBe(true);

  // A threshold above every score yields nothing rather than the best of a bad lot.
  expect(findSimilarProblems(incident, problems, 100).filter((entry) => entry.score === 100)).toHaveLength(0);
});

/* ── Engine (real DB) ──────────────────────────────────────────────────────── */

// setup.ts truncates every table in beforeEach, so fixtures are built per test.
let sequence = 0;

async function seedBase() {
  sequence += 1;
  const stamp = `${Date.now()}-${sequence}`;
  const owner = await prisma.user.create({
    data: {
      email: `det-owner-${stamp}@test.local`,
      passwordHash: 'x',
      name: 'Detection Owner',
      roles: { create: { role: 'it_admin' } },
    },
  });
  const requester = await prisma.employee.create({
    data: { employeeId: `EMP-DET-${stamp}`, name: 'Detection Requester', email: `det-req-${stamp}@test.local` },
  });
  return { stamp, ownerId: owner.id, requesterId: requester.id };
}

type Base = Awaited<ReturnType<typeof seedBase>>;

async function makeTicket(
  base: Base,
  input: { title: string; description: string; category: string },
) {
  sequence += 1;
  return prisma.ticket.create({
    data: {
      number: `INC-DET-${base.stamp}-${sequence}`,
      title: input.title,
      description: input.description,
      category: input.category,
      impact: 'medium',
      urgency: 'high',
      priority: 'high',
      requesterId: base.requesterId,
    },
  });
}

async function makeProblem(
  base: Base,
  input: { title: string; description: string; affectedServices: string[]; status?: ProblemStatus },
) {
  sequence += 1;
  return prisma.problem.create({
    data: {
      number: `PRB-DET-${base.stamp}-${sequence}`,
      title: input.title,
      description: input.description,
      ownerId: base.ownerId,
      affectedServices: input.affectedServices,
      affectedAssets: [],
      affectedCIs: [],
      businessImpact: '',
      status: input.status ?? 'INVESTIGATION',
    },
  });
}

/**
 * The problem text deliberately repeats the incident text: the symptom term is
 * an overlap coefficient, so a real recurrence (same wording, more detail)
 * scores 60 (service) + 20 (symptoms) = 80 and clears the 75 default.
 */
async function seedMatchingPair() {
  const base = await seedBase();
  const problem = await makeProblem(base, {
    title: 'Network disconnection',
    description: 'Intermittent connectivity affecting floor 3',
    affectedServices: ['Network'],
  });
  const incident = await makeTicket(base, {
    title: 'Network disconnection',
    description: 'Intermittent connectivity',
    category: 'Network',
  });
  return { base, problem, incident };
}

const WINDOW_START = () => new Date(Date.now() - 24 * 3_600_000);

test('scanWindow ranks a matching incident and persists nothing', async () => {
  const { problem, incident } = await seedMatchingPair();

  const results = await scanWindow(WINDOW_START());
  expect(results).toHaveLength(1);
  expect(results[0].incident.id).toBe(incident.id);
  expect(results[0].matches).toHaveLength(1);
  expect(results[0].matches[0].problemId).toBe(problem.id);
  expect(results[0].matches[0].score).toBeGreaterThanOrEqual(75);

  // A GET must not write.
  expect(await prisma.detectionSuggestion.count()).toBe(0);
});

test('scanWindow honours an explicit threshold', async () => {
  await seedMatchingPair();

  // The incident is always reported — an incident with no match is the cluster
  // candidate `runDetection` turns into a "start a problem" suggestion — so the
  // threshold filters the MATCHES, not the incident list.
  const strict = await scanWindow(WINDOW_START(), 90);
  expect(strict).toHaveLength(1);
  expect(strict[0].matches).toHaveLength(0);

  const loose = await scanWindow(WINDOW_START(), 50);
  expect(loose).toHaveLength(1);
  expect(loose[0].matches).toHaveLength(1);
});

test('scanWindow ignores closed problems and terminal tickets', async () => {
  const base = await seedBase();
  await makeProblem(base, {
    title: 'Network disconnection',
    description: 'Intermittent connectivity affecting floor 3',
    affectedServices: ['Network'],
    status: 'CLOSED',
  });
  const incident = await makeTicket(base, {
    title: 'Network disconnection',
    description: 'Intermittent connectivity',
    category: 'Network',
  });
  expect(await scanWindow(WINDOW_START())).toHaveLength(0);

  // Same problem, now open, but the incident is already resolved.
  await prisma.problem.updateMany({ data: { status: 'INVESTIGATION' } });
  await prisma.ticket.update({ where: { id: incident.id }, data: { status: 'resolved' } });
  expect(await scanWindow(WINDOW_START())).toHaveLength(0);

  // Every terminal ticket status, not just the one we happened to try.
  for (const status of ['closed', 'canceled'] as const) {
    await prisma.ticket.update({ where: { id: incident.id }, data: { status } });
    expect(await scanWindow(WINDOW_START())).toHaveLength(0);
  }
});

test('scanWindow ignores incidents already linked to a problem', async () => {
  const { base, problem, incident } = await seedMatchingPair();
  expect(await scanWindow(WINDOW_START())).toHaveLength(1);

  await prisma.problemIncident.create({
    data: { problemId: problem.id, incidentId: incident.id, linkedById: base.ownerId },
  });
  expect(await scanWindow(WINDOW_START())).toHaveLength(0);
});

test('scanWindow ignores incidents older than the window', async () => {
  const { incident } = await seedMatchingPair();
  await prisma.ticket.update({
    where: { id: incident.id },
    data: { createdAt: new Date(Date.now() - 72 * 3_600_000) },
  });
  expect(await scanWindow(WINDOW_START())).toHaveLength(0);
});

test('runDetection persists one suggestion per problem and is idempotent', async () => {
  const { problem, incident } = await seedMatchingPair();

  const created = await runDetection(WINDOW_START());
  expect(created).toHaveLength(1);
  expect(created[0].problemId).toBe(problem.id);
  expect(created[0].incidentIds).toEqual([incident.id]);
  expect(created[0].status).toBe('PENDING');
  expect(created[0].matchReasons).toContain('same_service');
  expect(created[0].expiresAt.getTime()).toBeGreaterThan(Date.now());

  // Second run: the incident is claimed by a live suggestion, so nothing new.
  expect(await runDetection(WINDOW_START())).toHaveLength(0);
  expect(await prisma.detectionSuggestion.count()).toBe(1);
});

test('runDetection proposes a new problem for an unmatched same-category cluster', async () => {
  const base = await seedBase();
  await makeProblem(base, {
    title: 'Network disconnection',
    description: 'Intermittent connectivity affecting floor 3',
    affectedServices: ['Network'],
  });
  for (let i = 0; i < 3; i += 1) {
    await makeTicket(base, { title: 'Printer offline', description: 'Paper jam on floor 2', category: 'Printing' });
  }

  const created = await runDetection(WINDOW_START());
  expect(created).toHaveLength(1);
  expect(created[0].problemId).toBeNull();
  expect(created[0].incidentIds).toHaveLength(3);
  expect(created[0].matchReasons).toEqual(['time_pattern']);
});

test('createProblemFromIncidents links every incident and numbers the problem', async () => {
  const base = await seedBase();
  const first = await makeTicket(base, { title: 'VPN drops', description: 'VPN disconnects hourly', category: 'Network' });
  const second = await makeTicket(base, { title: 'VPN drops again', description: 'Same VPN disconnects', category: 'Network' });

  const problem = await createProblemFromIncidents([first.id, second.id], base.ownerId);
  expect(problem.number).toMatch(/^PRB-\d{4}-\d{6}$/);
  expect(problem.title).toBe('VPN drops'); // earliest report names it
  expect(problem.affectedServices).toEqual(['Network']);
  expect(problem.detectionSource).toBe('MANUAL');
  expect(problem.status).toBe('IDENTIFIED');

  const links = await prisma.problemIncident.findMany({ where: { problemId: problem.id } });
  expect(links.map((link) => link.incidentId).sort()).toEqual([first.id, second.id].sort());
  expect(links.every((link) => link.linkedById === base.ownerId)).toBe(true);
});

test('createProblemFromIncidents accepts a single incident and rejects duplicates in the list', async () => {
  const base = await seedBase();
  const ticket = await makeTicket(base, { title: 'Solo', description: 'Only one', category: 'Network' });

  const problem = await createProblemFromIncidents([ticket.id, ticket.id], base.ownerId);
  expect(await prisma.problemIncident.count({ where: { problemId: problem.id } })).toBe(1);
});

test('createProblemFromIncidents rejects an incident already linked to another problem', async () => {
  const base = await seedBase();
  const ticket = await makeTicket(base, { title: 'Already filed', description: 'Filed twice', category: 'Network' });
  const existing = await makeProblem(base, {
    title: 'Existing problem',
    description: 'Already owns this incident',
    affectedServices: ['Network'],
  });
  await prisma.problemIncident.create({
    data: { problemId: existing.id, incidentId: ticket.id, linkedById: base.ownerId },
  });

  await expect(createProblemFromIncidents([ticket.id], base.ownerId)).rejects.toThrow(/already linked/i);
});

test('createProblemFromIncidents rejects an empty list and unknown incidents', async () => {
  const base = await seedBase();
  await expect(createProblemFromIncidents([], base.ownerId)).rejects.toThrow(/at least one incident/i);
  await expect(createProblemFromIncidents(['does-not-exist'], base.ownerId)).rejects.toThrow(/not found/i);
});

test('createProblemFromIncidents answers any live suggestion covering those incidents', async () => {
  const { base, incident } = await seedMatchingPair();
  await runDetection(WINDOW_START());
  expect(await prisma.detectionSuggestion.count({ where: { status: 'PENDING' } })).toBe(1);

  await createProblemFromIncidents([incident.id], base.ownerId);

  const suggestions = await prisma.detectionSuggestion.findMany();
  expect(suggestions).toHaveLength(1);
  expect(suggestions[0].status).toBe('ACCEPTED');
  expect(suggestions[0].reviewedById).toBe(base.ownerId);
  expect(suggestions[0].reviewedAt).toBeInstanceOf(Date);
});
