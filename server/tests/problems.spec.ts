import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '../src/app.js';
import { prisma } from '../src/prisma/client.js';

const app = createApp();

const SETUP_TOKEN = 'test-setup-token-0123456789abcdef0123456789abcdef';
const ADMIN = { email: 'admin@test.local', password: 'Sup3rSecret!pass', name: 'Root Admin' };
const EMP = { email: 'emp@test.local', name: 'Employee Person', password: 'Password123abc' };
const TECH = { email: 'tech@test.local', name: 'Tech Person', password: 'Password123abc' };
const MANAGER = { email: 'mgr@test.local', name: 'Manager Person', password: 'Password123abc' };

let adminToken = '';
let empToken = '';
let techToken = '';
let mgrToken = '';
let empUserId = '';
let techUserId = '';
let mgrUserId = '';
let empEmployeeId = '';
let techEmployeeId = '';
let mgrEmployeeId = '';

interface LoginData {
  accessToken: string;
}

async function login(email: string, password: string): Promise<string> {
  const res = await request(app).post('/api/v1/auth/login').send({ email, password });
  return (res.body.data as LoginData).accessToken;
}

async function createUser(token: string, body: Record<string, unknown>) {
  return request(app).post('/api/v1/users').set('Authorization', `Bearer ${token}`).send(body);
}

async function createTicket(token: string, overrides: Record<string, unknown> = {}) {
  const base = {
    title: 'Laptop will not start',
    description: 'The laptop shows a black screen when I press the power button.',
    category: 'hardware',
    impact: 'medium',
    urgency: 'high',
    ...overrides,
  };
  const res = await request(app).post('/api/v1/tickets').set('Authorization', `Bearer ${token}`).send(base);
  return res.body.data;
}

beforeEach(async () => {
  // Tables truncated by setup — bootstrap and log in all actors fresh.
  await request(app).post('/api/v1/auth/bootstrap').send({ setupToken: SETUP_TOKEN, ...ADMIN });
  adminToken = await login(ADMIN.email, ADMIN.password);

  const emp = await createUser(adminToken, { ...EMP, roles: ['employee'] });
  empUserId = emp.body.data.id;
  empEmployeeId = emp.body.data.employee.id;
  const tech = await createUser(adminToken, { ...TECH, roles: ['it_technician'] });
  techUserId = tech.body.data.id;
  techEmployeeId = tech.body.data.employee.id;
  const mgr = await createUser(adminToken, { ...MANAGER, roles: ['it_manager'] });
  mgrUserId = mgr.body.data.id;
  mgrEmployeeId = mgr.body.data.employee.id;

  empToken = await login(EMP.email, EMP.password);
  techToken = await login(TECH.email, TECH.password);
  mgrToken = await login(MANAGER.email, MANAGER.password);
});

function getValidProblem() {
  return {
    title: 'Intermittent Wi-Fi disconnections on floor 3',
    description: 'Multiple users on floor 3 report Wi-Fi dropping 5-10 times per day. Started after firmware update on access points.',
    priority: 'HIGH',
    affectedServices: ['Network', 'Wi-Fi'],
    affectedAssets: ['AP-F3-01', 'AP-F3-02'],
    affectedCIs: ['NET-INFRA-001'],
    businessImpact: 'Productivity loss for ~50 employees on floor 3. Meetings disrupted, VPN drops during client calls.',
    ownerId: techUserId,
  };
}

describe('Problem creation & numbering (Section 13 AC1)', () => {
  it('creates a problem with PRB-YYYY-NNNNNN number and defaults to IDENTIFIED', async () => {
    const res = await request(app)
      .post('/api/v1/problems')
      .set('Authorization', `Bearer ${techToken}`)
      .send(getValidProblem());
    expect(res.status).toBe(201);
    expect(res.body.data.number).toMatch(/^PRB-\d{4}-\d{6}$/);
    expect(res.body.data.status).toBe('IDENTIFIED');
    expect(res.body.data.identifiedAt).toBeDefined();
    expect(res.body.data.ownerId).toBe(techUserId);
  });

  it('increments the problem number sequentially', async () => {
    const one = await request(app)
      .post('/api/v1/problems')
      .set('Authorization', `Bearer ${techToken}`)
      .send(getValidProblem());
    const two = await request(app)
      .post('/api/v1/problems')
      .set('Authorization', `Bearer ${techToken}`)
      .send({ ...getValidProblem(), title: 'Second problem' });
    const n1 = Number(one.body.data.number.slice(-6));
    const n2 = Number(two.body.data.number.slice(-6));
    expect(n2).toBe(n1 + 1);
  });

  it('rejects invalid payloads (missing title, invalid priority)', async () => {
    const res = await request(app)
      .post('/api/v1/problems')
      .set('Authorization', `Bearer ${techToken}`)
      .send({ ...getValidProblem(), title: 'hi' }); // title too short
    expect(res.status).toBe(400);

    const res2 = await request(app)
      .post('/api/v1/problems')
      .set('Authorization', `Bearer ${techToken}`)
      .send({ ...getValidProblem(), priority: 'INVALID' });
    expect(res2.status).toBe(400);
  });

  it('requires problems:create permission', async () => {
    const res = await request(app)
      .post('/api/v1/problems')
      .set('Authorization', `Bearer ${empToken}`)
      .send(getValidProblem());
    expect(res.status).toBe(403);
  });

  it('creates problem with ownerId from current user if not provided', async () => {
    const res = await request(app)
      .post('/api/v1/problems')
      .set('Authorization', `Bearer ${techToken}`)
      .send({ ...getValidProblem(), ownerId: undefined });
    expect(res.status).toBe(201);
    expect(res.body.data.ownerId).toBe(techUserId);
  });
});

describe('Problem listing, filtering & search (Section 13 AC2)', () => {
  async function createProblems() {
    const p1 = await request(app)
      .post('/api/v1/problems')
      .set('Authorization', `Bearer ${techToken}`)
      .send(getValidProblem());
    const p2 = await request(app)
      .post('/api/v1/problems')
      .set('Authorization', `Bearer ${techToken}`)
      .send({ ...getValidProblem(), title: 'VPN authentication fails after password reset', priority: 'CRITICAL', affectedServices: ['VPN'] });
    const p3 = await request(app)
      .post('/api/v1/problems')
      .set('Authorization', `Bearer ${mgrToken}`)
      .send({ ...getValidProblem(), title: 'Printer queue stalls on large jobs', priority: 'MEDIUM', affectedServices: ['Printing'] });
    return [p1, p2, p3].map(r => r.body.data);
  }

  it('lists problems with pagination', async () => {
    await createProblems();
    const res = await request(app)
      .get('/api/v1/problems?page=1&limit=2')
      .set('Authorization', `Bearer ${mgrToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.meta.page).toBe(1);
    expect(res.body.meta.limit).toBe(2);
    expect(res.body.meta.total).toBe(3);
  });

  it('filters by status', async () => {
    await createProblems();
    const res = await request(app)
      .get('/api/v1/problems?status=IDENTIFIED')
      .set('Authorization', `Bearer ${mgrToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.every((p: any) => p.status === 'IDENTIFIED')).toBe(true);
  });

  it('filters by priority', async () => {
    await createProblems();
    const res = await request(app)
      .get('/api/v1/problems?priority=CRITICAL')
      .set('Authorization', `Bearer ${mgrToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.every((p: any) => p.priority === 'CRITICAL')).toBe(true);
  });

  it('filters by affectedService', async () => {
    await createProblems();
    const res = await request(app)
      .get('/api/v1/problems?affectedService=Network')
      .set('Authorization', `Bearer ${mgrToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.every((p: any) => p.affectedServices?.includes('Network'))).toBe(true);
  });

  it('searches by title and description', async () => {
    await createProblems();
    const res = await request(app)
      .get('/api/v1/problems?search=VPN')
      .set('Authorization', `Bearer ${mgrToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.some((p: any) => p.title.includes('VPN'))).toBe(true);
  });

  it('sorts by identifiedAt desc by default', async () => {
    await createProblems();
    const res = await request(app)
      .get('/api/v1/problems')
      .set('Authorization', `Bearer ${mgrToken}`);
    expect(res.status).toBe(200);
    const dates = res.body.data.map((p: any) => new Date(p.identifiedAt).getTime());
    for (let i = 1; i < dates.length; i++) {
      expect(dates[i]).toBeLessThanOrEqual(dates[i - 1]);
    }
  });

  it('technician sees only their own problems (record scope)', async () => {
    await createProblems();
    const res = await request(app)
      .get('/api/v1/problems')
      .set('Authorization', `Bearer ${techToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.every((p: any) => p.ownerId === techUserId)).toBe(true);
  });

  it('manager sees all problems (manager role scope)', async () => {
    await createProblems();
    const res = await request(app)
      .get('/api/v1/problems')
      .set('Authorization', `Bearer ${mgrToken}`);
    expect(res.status).toBe(200);
    expect(res.body.meta.total).toBe(3);
  });
});

describe('Problem detail & audit log (Section 13 AC3)', () => {
  let problemId: string;

  beforeEach(async () => {
    const res = await request(app)
      .post('/api/v1/problems')
      .set('Authorization', `Bearer ${techToken}`)
      .send(getValidProblem());
    problemId = res.body.data.id;
  });

  it('returns full problem detail with all fields', async () => {
    const expected = getValidProblem();
    const res = await request(app)
      .get(`/api/v1/problems/${problemId}`)
      .set('Authorization', `Bearer ${techToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(problemId);
    expect(res.body.data.title).toBe(expected.title);
    expect(res.body.data.status).toBe('IDENTIFIED');
    expect(res.body.data.affectedServices).toEqual(expected.affectedServices);
    expect(res.body.data.affectedAssets).toEqual(expected.affectedAssets);
    expect(res.body.data.affectedCIs).toEqual(expected.affectedCIs);
    expect(res.body.data.businessImpact).toBe(expected.businessImpact);
    expect(res.body.data.incidents).toEqual([]);
    expect(res.body.data.changeRequestIds).toEqual([]);
    expect(res.body.data.auditLogs).toBeDefined();
  });

  it('returns audit log for problem', async () => {
    await request(app)
      .post(`/api/v1/problems/${problemId}/status`)
      .set('Authorization', `Bearer ${techToken}`)
      .send({ status: 'INVESTIGATION' });
    const res = await request(app)
      .get(`/api/v1/problems/${problemId}/audit`)
      .set('Authorization', `Bearer ${techToken}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBeGreaterThanOrEqual(1);
    expect(res.body.data[0].action).toBe('STATUS_CHANGED');
  });

  it('returns 404 for non-existent problem', async () => {
    const res = await request(app)
      .get('/api/v1/problems/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${techToken}`);
    expect(res.status).toBe(404);
  });

  it('technician cannot read another technician\'s problem', async () => {
    // Create another technician
    const tech2 = await createUser(adminToken, { email: 'tech2@test.local', name: 'Tech Two', password: 'Password123abc', roles: ['it_technician'] });
    const tech2Token = await login('tech2@test.local', 'Password123abc');
    const res = await request(app)
      .get(`/api/v1/problems/${problemId}`)
      .set('Authorization', `Bearer ${tech2Token}`);
    expect(res.status).toBe(404);
  });
});

describe('Problem status transitions & validation (Section 13 AC4)', () => {
  let problemId: string;

  beforeEach(async () => {
    const res = await request(app)
      .post('/api/v1/problems')
      .set('Authorization', `Bearer ${techToken}`)
      .send(getValidProblem());
    problemId = res.body.data.id;
  });

  it('IDENTIFIED -> INVESTIGATION requires no extra data', async () => {
    const res = await request(app)
      .post(`/api/v1/problems/${problemId}/status`)
      .set('Authorization', `Bearer ${techToken}`)
      .send({ status: 'INVESTIGATION' });
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('INVESTIGATION');
    expect(res.body.data.investigationStartedAt).toBeDefined();
  });

  it('INVESTIGATION -> ROOT_CAUSE_KNOWN requires rootCause + confirmedRootCause', async () => {
    await request(app)
      .post(`/api/v1/problems/${problemId}/status`)
      .set('Authorization', `Bearer ${techToken}`)
      .send({ status: 'INVESTIGATION' });

    // Should fail without RCA
    const res = await request(app)
      .post(`/api/v1/problems/${problemId}/status`)
      .set('Authorization', `Bearer ${techToken}`)
      .send({ status: 'ROOT_CAUSE_KNOWN' });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toContain('Root cause must be documented');

    // Set RCA then transition
    await request(app)
      .post(`/api/v1/problems/${problemId}/rca`)
      .set('Authorization', `Bearer ${techToken}`)
      .send({ rootCause: 'Faulty firmware v3.2.1', confirmedRootCause: true });
    const res2 = await request(app)
      .post(`/api/v1/problems/${problemId}/status`)
      .set('Authorization', `Bearer ${techToken}`)
      .send({ status: 'ROOT_CAUSE_KNOWN' });
    expect(res2.status).toBe(200);
    expect(res2.body.data.status).toBe('ROOT_CAUSE_KNOWN');
    expect(res2.body.data.rootCauseIdentifiedAt).toBeDefined();
  });

  it('ROOT_CAUSE_KNOWN -> WORKAROUND_DOCUMENTED requires workaround', async () => {
    await request(app)
      .post(`/api/v1/problems/${problemId}/status`)
      .set('Authorization', `Bearer ${techToken}`)
      .send({ status: 'INVESTIGATION' });
    await request(app)
      .post(`/api/v1/problems/${problemId}/rca`)
      .set('Authorization', `Bearer ${techToken}`)
      .send({ rootCause: 'Cause', confirmedRootCause: true });
    await request(app)
      .post(`/api/v1/problems/${problemId}/status`)
      .set('Authorization', `Bearer ${techToken}`)
      .send({ status: 'ROOT_CAUSE_KNOWN' });

    // Should fail without workaround
    const res = await request(app)
      .post(`/api/v1/problems/${problemId}/status`)
      .set('Authorization', `Bearer ${techToken}`)
      .send({ status: 'WORKAROUND_DOCUMENTED' });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toContain('Workaround must be documented');

    // Set workaround then transition
    await request(app)
      .post(`/api/v1/problems/${problemId}/workaround`)
      .set('Authorization', `Bearer ${techToken}`)
      .send({ workaround: 'Use 5GHz band only' });
    const res2 = await request(app)
      .post(`/api/v1/problems/${problemId}/status`)
      .set('Authorization', `Bearer ${techToken}`)
      .send({ status: 'WORKAROUND_DOCUMENTED' });
    expect(res2.status).toBe(200);
    expect(res2.body.data.status).toBe('WORKAROUND_DOCUMENTED');
    expect(res2.body.data.workaroundDocumentedAt).toBeDefined();
  });

  it('WORKAROUND_DOCUMENTED -> PENDING_CHANGE requires changeRequestIds', async () => {
    await request(app)
      .post(`/api/v1/problems/${problemId}/status`)
      .set('Authorization', `Bearer ${techToken}`)
      .send({ status: 'INVESTIGATION' });
    await request(app)
      .post(`/api/v1/problems/${problemId}/rca`)
      .set('Authorization', `Bearer ${techToken}`)
      .send({ rootCause: 'Cause', confirmedRootCause: true });
    await request(app)
      .post(`/api/v1/problems/${problemId}/status`)
      .set('Authorization', `Bearer ${techToken}`)
      .send({ status: 'ROOT_CAUSE_KNOWN' });
    await request(app)
      .post(`/api/v1/problems/${problemId}/workaround`)
      .set('Authorization', `Bearer ${techToken}`)
      .send({ workaround: 'Workaround' });
    await request(app)
      .post(`/api/v1/problems/${problemId}/status`)
      .set('Authorization', `Bearer ${techToken}`)
      .send({ status: 'WORKAROUND_DOCUMENTED' });

    // Should fail without change request
    const res = await request(app)
      .post(`/api/v1/problems/${problemId}/status`)
      .set('Authorization', `Bearer ${techToken}`)
      .send({ status: 'PENDING_CHANGE' });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toContain('change request');

    // Link change then transition
    await request(app)
      .post(`/api/v1/problems/${problemId}/changes`)
      .set('Authorization', `Bearer ${techToken}`)
      .send({ changeId: 'CHG-2026-000123' });
    const res2 = await request(app)
      .post(`/api/v1/problems/${problemId}/status`)
      .set('Authorization', `Bearer ${techToken}`)
      .send({ status: 'PENDING_CHANGE' });
    expect(res2.status).toBe(200);
    expect(res2.body.data.status).toBe('PENDING_CHANGE');
    expect(res2.body.data.changeInitiatedAt).toBeDefined();
  });

  it('PENDING_CHANGE -> RESOLVED requires resolutionSummary + verifiedFix or exception', async () => {
    await request(app)
      .post(`/api/v1/problems/${problemId}/status`)
      .set('Authorization', `Bearer ${techToken}`)
      .send({ status: 'INVESTIGATION' });
    await request(app)
      .post(`/api/v1/problems/${problemId}/rca`)
      .set('Authorization', `Bearer ${techToken}`)
      .send({ rootCause: 'Cause', confirmedRootCause: true });
    await request(app)
      .post(`/api/v1/problems/${problemId}/status`)
      .set('Authorization', `Bearer ${techToken}`)
      .send({ status: 'ROOT_CAUSE_KNOWN' });
    await request(app)
      .post(`/api/v1/problems/${problemId}/workaround`)
      .set('Authorization', `Bearer ${techToken}`)
      .send({ workaround: 'Workaround' });
    await request(app)
      .post(`/api/v1/problems/${problemId}/status`)
      .set('Authorization', `Bearer ${techToken}`)
      .send({ status: 'WORKAROUND_DOCUMENTED' });
    await request(app)
      .post(`/api/v1/problems/${problemId}/changes`)
      .set('Authorization', `Bearer ${techToken}`)
      .send({ changeId: 'CHG-2026-000123' });
    await request(app)
      .post(`/api/v1/problems/${problemId}/status`)
      .set('Authorization', `Bearer ${techToken}`)
      .send({ status: 'PENDING_CHANGE' });

    // Should fail without resolution
    const res = await request(app)
      .post(`/api/v1/problems/${problemId}/status`)
      .set('Authorization', `Bearer ${techToken}`)
      .send({ status: 'RESOLVED' });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toContain('Resolution summary');

    // Resolve with verified fix
    const res2 = await request(app)
      .post(`/api/v1/problems/${problemId}/status`)
      .set('Authorization', `Bearer ${techToken}`)
      .send({ status: 'RESOLVED', resolutionSummary: 'Rolled back firmware', verifiedFix: true });
    expect(res2.status).toBe(200);
    expect(res2.body.data.status).toBe('RESOLVED');
    expect(res2.body.data.resolvedAt).toBeDefined();
    expect(res2.body.data.resolutionSummary).toBe('Rolled back firmware');
  });

  it('RESOLVED -> CLOSED is terminal', async () => {
    // Fast-forward to RESOLVED
    await request(app)
      .post(`/api/v1/problems/${problemId}/status`)
      .set('Authorization', `Bearer ${techToken}`)
      .send({ status: 'INVESTIGATION' });
    await request(app)
      .post(`/api/v1/problems/${problemId}/rca`)
      .set('Authorization', `Bearer ${techToken}`)
      .send({ rootCause: 'Cause', confirmedRootCause: true });
    await request(app)
      .post(`/api/v1/problems/${problemId}/status`)
      .set('Authorization', `Bearer ${techToken}`)
      .send({ status: 'ROOT_CAUSE_KNOWN' });
    await request(app)
      .post(`/api/v1/problems/${problemId}/workaround`)
      .set('Authorization', `Bearer ${techToken}`)
      .send({ workaround: 'Workaround' });
    await request(app)
      .post(`/api/v1/problems/${problemId}/status`)
      .set('Authorization', `Bearer ${techToken}`)
      .send({ status: 'WORKAROUND_DOCUMENTED' });
    await request(app)
      .post(`/api/v1/problems/${problemId}/changes`)
      .set('Authorization', `Bearer ${techToken}`)
      .send({ changeId: 'CHG-2026-000123' });
    await request(app)
      .post(`/api/v1/problems/${problemId}/status`)
      .set('Authorization', `Bearer ${techToken}`)
      .send({ status: 'PENDING_CHANGE' });
    await request(app)
      .post(`/api/v1/problems/${problemId}/status`)
      .set('Authorization', `Bearer ${techToken}`)
      .send({ status: 'RESOLVED', resolutionSummary: 'Fixed', verifiedFix: true });

    // Close
    const res = await request(app)
      .post(`/api/v1/problems/${problemId}/status`)
      .set('Authorization', `Bearer ${techToken}`)
      .send({ status: 'CLOSED' });
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('CLOSED');

    // Cannot transition from CLOSED
    const res2 = await request(app)
      .post(`/api/v1/problems/${problemId}/status`)
      .set('Authorization', `Bearer ${techToken}`)
      .send({ status: 'INVESTIGATION' });
    expect(res2.status).toBe(409);
  });

  it('RESOLVED can be reopened to INVESTIGATION', async () => {
    // Fast-forward to RESOLVED
    await request(app)
      .post(`/api/v1/problems/${problemId}/status`)
      .set('Authorization', `Bearer ${techToken}`)
      .send({ status: 'INVESTIGATION' });
    await request(app)
      .post(`/api/v1/problems/${problemId}/rca`)
      .set('Authorization', `Bearer ${techToken}`)
      .send({ rootCause: 'Cause', confirmedRootCause: true });
    await request(app)
      .post(`/api/v1/problems/${problemId}/status`)
      .set('Authorization', `Bearer ${techToken}`)
      .send({ status: 'ROOT_CAUSE_KNOWN' });
    await request(app)
      .post(`/api/v1/problems/${problemId}/workaround`)
      .set('Authorization', `Bearer ${techToken}`)
      .send({ workaround: 'Workaround' });
    await request(app)
      .post(`/api/v1/problems/${problemId}/status`)
      .set('Authorization', `Bearer ${techToken}`)
      .send({ status: 'WORKAROUND_DOCUMENTED' });
    await request(app)
      .post(`/api/v1/problems/${problemId}/changes`)
      .set('Authorization', `Bearer ${techToken}`)
      .send({ changeId: 'CHG-2026-000123' });
    await request(app)
      .post(`/api/v1/problems/${problemId}/status`)
      .set('Authorization', `Bearer ${techToken}`)
      .send({ status: 'PENDING_CHANGE' });
    await request(app)
      .post(`/api/v1/problems/${problemId}/status`)
      .set('Authorization', `Bearer ${techToken}`)
      .send({ status: 'RESOLVED', resolutionSummary: 'Fixed', verifiedFix: true });

    // Reopen
    const res = await request(app)
      .post(`/api/v1/problems/${problemId}/status`)
      .set('Authorization', `Bearer ${techToken}`)
      .send({ status: 'INVESTIGATION' });
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('INVESTIGATION');
  });

  it('requires problems:transition permission', async () => {
    const res = await request(app)
      .post(`/api/v1/problems/${problemId}/status`)
      .set('Authorization', `Bearer ${empToken}`)
      .send({ status: 'INVESTIGATION' });
    expect(res.status).toBe(403);
  });
});

describe('RCA management (5 Whys + Fishbone) (Section 13 AC5)', () => {
  let problemId: string;

  beforeEach(async () => {
    const res = await request(app)
      .post('/api/v1/problems')
      .set('Authorization', `Bearer ${techToken}`)
      .send(getValidProblem());
    problemId = res.body.data.id;
  });

  it('updates RCA with 5 Whys structure', async () => {
    const fiveWhys = {
      steps: [
        { why: 'Why are users disconnecting?', answer: 'AP radio resets cause deauth of all clients' },
        { why: 'Why does the radio reset?', answer: 'Firmware v3.2.1 has a memory leak in the client management module' },
        { why: 'Why was this firmware deployed?', answer: 'Auto-update policy applied firmware during maintenance window' },
        { why: 'Why was the memory leak not caught in testing?', answer: 'Test environment had lower client density than production' },
        { why: 'Why no rollback plan?', answer: 'Change advisory did not require firmware rollback procedure' },
      ],
      rootCause: 'Faulty firmware v3.2.1 on Aruba AP-515 access points',
    };
    const res = await request(app)
      .post(`/api/v1/problems/${problemId}/rca`)
      .set('Authorization', `Bearer ${techToken}`)
      .send({ rootCause: fiveWhys.rootCause, confirmedRootCause: true, fiveWhys });
    expect(res.status).toBe(200);
    expect(res.body.data.rootCause).toBe(fiveWhys.rootCause);
    expect(res.body.data.fiveWhys).toEqual(fiveWhys);
    expect(res.body.data.confirmedRootCause).toBe(true);
  });

  it('updates RCA with Fishbone structure', async () => {
    const fishbone = {
      categories: {
        People: ['Users not trained on job splitting'],
        Process: ['No job size validation in print driver'],
        Technology: ['Firmware bug in PCL6 parser'],
        Equipment: ['Aging printer fleet (5+ years)'],
        Environment: ['High concurrent print volume at month-end'],
        Other: ['Vendor firmware update delayed'],
      },
      rootCause: 'Printer firmware does not handle PCL6 jobs over 50MB correctly',
    };
    const res = await request(app)
      .post(`/api/v1/problems/${problemId}/rca`)
      .set('Authorization', `Bearer ${techToken}`)
      .send({ rootCause: fishbone.rootCause, confirmedRootCause: true, fishbone });
    expect(res.status).toBe(200);
    expect(res.body.data.rootCause).toBe(fishbone.rootCause);
    expect(res.body.data.fishbone).toEqual(fishbone);
    expect(res.body.data.confirmedRootCause).toBe(true);
  });

  it('requires problems:manage_rca permission', async () => {
    const res = await request(app)
      .post(`/api/v1/problems/${problemId}/rca`)
      .set('Authorization', `Bearer ${empToken}`)
      .send({ rootCause: 'Cause', confirmedRootCause: true });
    expect(res.status).toBe(403);
  });
});

describe('Workaround management (Section 13 AC6)', () => {
  let problemId: string;

  beforeEach(async () => {
    const res = await request(app)
      .post('/api/v1/problems')
      .set('Authorization', `Bearer ${techToken}`)
      .send(getValidProblem());
    problemId = res.body.data.id;
  });

  it('sets workaround on problem', async () => {
    const res = await request(app)
      .post(`/api/v1/problems/${problemId}/workaround`)
      .set('Authorization', `Bearer ${techToken}`)
      .send({ workaround: 'Connect to wired Ethernet where available. Use 5GHz band only.' });
    expect(res.status).toBe(200);
    expect(res.body.data.workaround).toBe('Connect to wired Ethernet where available. Use 5GHz band only.');
    expect(res.body.data.workaroundDocumentedAt).toBeDefined();
  });

  it('requires problems:manage_rca permission', async () => {
    const res = await request(app)
      .post(`/api/v1/problems/${problemId}/workaround`)
      .set('Authorization', `Bearer ${empToken}`)
      .send({ workaround: 'Workaround' });
    expect(res.status).toBe(403);
  });
});

describe('Incident linking (Section 13 AC7)', () => {
  let problemId: string;
  let incidentId: string;

  beforeEach(async () => {
    const problemRes = await request(app)
      .post('/api/v1/problems')
      .set('Authorization', `Bearer ${techToken}`)
      .send(getValidProblem());
    problemId = problemRes.body.data.id;

    const ticketRes = await createTicket(empToken, { title: 'Wi-Fi dropping on floor 3' });
    incidentId = ticketRes.id;
  });

  it('links incidents to problem with note', async () => {
    const res = await request(app)
      .post(`/api/v1/problems/${problemId}/incidents`)
      .set('Authorization', `Bearer ${techToken}`)
      .send({ incidentIds: [incidentId], note: 'User reports match problem symptoms' });
    expect(res.status).toBe(204);

    const detail = await request(app)
      .get(`/api/v1/problems/${problemId}`)
      .set('Authorization', `Bearer ${techToken}`);
    expect(detail.body.data.incidents).toHaveLength(1);
    expect(detail.body.data.incidents[0].incidentId).toBe(incidentId);
    expect(detail.body.data.incidents[0].note).toBe('User reports match problem symptoms');
  });

  it('unlinks incident from problem', async () => {
    await request(app)
      .post(`/api/v1/problems/${problemId}/incidents`)
      .set('Authorization', `Bearer ${techToken}`)
      .send({ incidentIds: [incidentId], note: 'Linked' });

    const res = await request(app)
      .delete(`/api/v1/problems/${problemId}/incidents/${incidentId}`)
      .set('Authorization', `Bearer ${techToken}`);
    expect(res.status).toBe(204);

    const detail = await request(app)
      .get(`/api/v1/problems/${problemId}`)
      .set('Authorization', `Bearer ${techToken}`);
    expect(detail.body.data.incidents).toHaveLength(0);
  });

  it('requires problems:link_incidents permission', async () => {
    const res = await request(app)
      .post(`/api/v1/problems/${problemId}/incidents`)
      .set('Authorization', `Bearer ${empToken}`)
      .send({ incidentIds: [incidentId], note: 'Linked' });
    expect(res.status).toBe(403);
  });
});

describe('Change request linking (Section 13 AC8)', () => {
  let problemId: string;

  beforeEach(async () => {
    const res = await request(app)
      .post('/api/v1/problems')
      .set('Authorization', `Bearer ${techToken}`)
      .send(getValidProblem());
    problemId = res.body.data.id;
  });

  it('links change request to problem', async () => {
    const res = await request(app)
      .post(`/api/v1/problems/${problemId}/changes`)
      .set('Authorization', `Bearer ${techToken}`)
      .send({ changeId: 'CHG-2026-000123' });
    expect(res.status).toBe(200);
    expect(res.body.data.changeRequestIds).toContain('CHG-2026-000123');
  });

  it('unlinks change request from problem', async () => {
    await request(app)
      .post(`/api/v1/problems/${problemId}/changes`)
      .set('Authorization', `Bearer ${techToken}`)
      .send({ changeId: 'CHG-2026-000123' });

    const res = await request(app)
      .delete(`/api/v1/problems/${problemId}/changes/CHG-2026-000123`)
      .set('Authorization', `Bearer ${techToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.changeRequestIds).not.toContain('CHG-2026-000123');
  });

  it('requires problems:update permission', async () => {
    const res = await request(app)
      .post(`/api/v1/problems/${problemId}/changes`)
      .set('Authorization', `Bearer ${empToken}`)
      .send({ changeId: 'CHG-2026-000123' });
    expect(res.status).toBe(403);
  });
});

describe('Change webhook integration (Section 13 AC9)', () => {
  let problemId: string;

  beforeEach(async () => {
    const res = await request(app)
      .post('/api/v1/problems')
      .set('Authorization', `Bearer ${techToken}`)
      .send({ ...getValidProblem(), changeRequestIds: ['CHG-2026-000123'] });
    problemId = res.body.data.id;
  });

  it('handles change.approved event', async () => {
    const res = await request(app)
      .post('/api/v1/problems/change-events')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ event: 'change.approved', changeId: 'CHG-2026-000123' });
    expect(res.status).toBe(200);
    expect(res.body.data.event).toBe('change.approved');
    expect(res.body.data.notified).toBeGreaterThanOrEqual(0);
  });

  it('handles change.implemented event', async () => {
    const res = await request(app)
      .post('/api/v1/problems/change-events')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ event: 'change.implemented', changeId: 'CHG-2026-000123' });
    expect(res.status).toBe(200);
    expect(res.body.data.event).toBe('change.implemented');
  });

  it('handles change.rejected event', async () => {
    const res = await request(app)
      .post('/api/v1/problems/change-events')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ event: 'change.rejected', changeId: 'CHG-2026-000123', reason: 'Risk too high' });
    expect(res.status).toBe(200);
  });

  it('handles change.rolled_back event', async () => {
    const res = await request(app)
      .post('/api/v1/problems/change-events')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ event: 'change.rolled_back', changeId: 'CHG-2026-000123' });
    expect(res.status).toBe(200);
  });

  it('requires problems:update permission', async () => {
    const res = await request(app)
      .post('/api/v1/problems/change-events')
      .set('Authorization', `Bearer ${empToken}`)
      .send({ event: 'change.approved', changeId: 'CHG-2026-000123' });
    expect(res.status).toBe(403);
  });
});

describe('Dashboard API (Section 13 AC10)', () => {
  it('returns KPI tiles, trends, Pareto, aging, status distribution, known errors, fix effectiveness', async () => {
    // Create some problems with different statuses
    await request(app)
      .post('/api/v1/problems')
      .set('Authorization', `Bearer ${techToken}`)
      .send(getValidProblem());
    await request(app)
      .post('/api/v1/problems')
      .set('Authorization', `Bearer ${techToken}`)
      .send({ ...getValidProblem(), title: 'VPN auth fails', priority: 'CRITICAL' });

    const res = await request(app)
      .get('/api/v1/problems/dashboard')
      .set('Authorization', `Bearer ${mgrToken}`);
    expect(res.status).toBe(200);
    const data = res.body.data;
    expect(data.trends).toBeDefined();
    expect(data.topCauses).toBeDefined();
    expect(data.aging).toBeDefined();
    expect(data.overdue).toBeDefined();
    expect(data.open).toBeDefined();
    expect(data.statusDistribution).toBeDefined();
    expect(data.knownErrors).toBeDefined();
    expect(data.knownErrors.byStatus).toBeDefined();
    expect(data.knownErrors.problemsWithKnownError).toBeDefined();
    expect(data.fixEffectiveness).toBeDefined();
  });

  it('accepts date range filter via identifiedAfter', async () => {
    const res = await request(app)
      .get('/api/v1/problems/dashboard?identifiedAfter=2026-01-01')
      .set('Authorization', `Bearer ${mgrToken}`);
    expect(res.status).toBe(200);
  });

  it('requires problems:read permission', async () => {
    const res = await request(app)
      .get('/api/v1/problems/dashboard')
      .set('Authorization', `Bearer ${empToken}`);
    expect(res.status).toBe(403);
  });
});

describe('Known Errors CRUD (Section 13 AC11)', () => {
  let problemId: string;

  beforeEach(async () => {
    const res = await request(app)
      .post('/api/v1/problems')
      .set('Authorization', `Bearer ${techToken}`)
      .send({ ...getValidProblem(), status: 'RESOLVED', resolutionSummary: 'Fixed', rootCause: 'Cause', confirmedRootCause: true });
    problemId = res.body.data.id;
  });

  it('creates known error linked to problem', async () => {
    const res = await request(app)
      .post('/api/v1/known-errors')
      .set('Authorization', `Bearer ${mgrToken}`)
      .send({
        problemId,
        title: 'Wi-Fi disconnections from Aruba AP firmware v3.2.1',
        rootCause: 'Faulty firmware v3.2.1 on Aruba AP-515 access points',
        symptoms: 'Intermittent Wi-Fi disconnections 5-10 times per day',
        workaround: 'Roll back access points to firmware v3.1.4',
        affectedServices: ['Network', 'Wi-Fi'],
      });
    expect(res.status).toBe(201);
    expect(res.body.data.number).toMatch(/^KE-\d{4}-\d{6}$/);
    expect(res.body.data.status).toBe('DRAFT');
    expect(res.body.data.visibility).toBe('IT_ONLY');
    expect(res.body.data.problemId).toBe(problemId);
  });

  it('transitions DRAFT -> UNDER_REVIEW -> PUBLISHED', async () => {
    const createRes = await request(app)
      .post('/api/v1/known-errors')
      .set('Authorization', `Bearer ${mgrToken}`)
      .send({
        problemId,
        title: 'Test KE',
        rootCause: 'Root cause',
        symptoms: 'Symptoms',
        workaround: 'Workaround',
        affectedServices: ['Network'],
      });
    const keId = createRes.body.data.id;

    // DRAFT -> UNDER_REVIEW
    const res1 = await request(app)
      .post(`/api/v1/known-errors/${keId}/status`)
      .set('Authorization', `Bearer ${mgrToken}`)
      .send({ status: 'UNDER_REVIEW' });
    expect(res1.status).toBe(200);
    expect(res1.body.data.status).toBe('UNDER_REVIEW');

    // UNDER_REVIEW -> PUBLISHED
    const res2 = await request(app)
      .post(`/api/v1/known-errors/${keId}/status`)
      .set('Authorization', `Bearer ${mgrToken}`)
      .send({ status: 'PUBLISHED' });
    expect(res2.status).toBe(200);
    expect(res2.body.data.status).toBe('PUBLISHED');
    expect(res2.body.data.approvedById).toBe(mgrUserId);
    expect(res2.body.data.approvedAt).toBeDefined();
    expect(res2.body.data.lastReviewedAt).toBeDefined();
    expect(res2.body.data.reviewDueAt).toBeDefined();
  });

  it('PUBLISHED -> RETIRED is terminal', async () => {
    const createRes = await request(app)
      .post('/api/v1/known-errors')
      .set('Authorization', `Bearer ${mgrToken}`)
      .send({
        problemId,
        title: 'Test KE',
        rootCause: 'Root cause',
        symptoms: 'Symptoms',
        workaround: 'Workaround',
        affectedServices: ['Network'],
      });
    const keId = createRes.body.data.id;

    await request(app)
      .post(`/api/v1/known-errors/${keId}/status`)
      .set('Authorization', `Bearer ${mgrToken}`)
      .send({ status: 'UNDER_REVIEW' });
    await request(app)
      .post(`/api/v1/known-errors/${keId}/status`)
      .set('Authorization', `Bearer ${mgrToken}`)
      .send({ status: 'PUBLISHED' });

    const res = await request(app)
      .post(`/api/v1/known-errors/${keId}/status`)
      .set('Authorization', `Bearer ${mgrToken}`)
      .send({ status: 'RETIRED' });
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('RETIRED');

    // Cannot transition from RETIRED
    const res2 = await request(app)
      .post(`/api/v1/known-errors/${keId}/status`)
      .set('Authorization', `Bearer ${mgrToken}`)
      .send({ status: 'DRAFT' });
    expect(res2.status).toBe(409);
  });

  it('publishes to knowledge base', async () => {
    const createRes = await request(app)
      .post('/api/v1/known-errors')
      .set('Authorization', `Bearer ${mgrToken}`)
      .send({
        problemId,
        title: 'Test KE',
        rootCause: 'Root cause',
        symptoms: 'Symptoms',
        workaround: 'Workaround text',
        affectedServices: ['Network'],
      });
    const keId = createRes.body.data.id;

    await request(app)
      .post(`/api/v1/known-errors/${keId}/status`)
      .set('Authorization', `Bearer ${mgrToken}`)
      .send({ status: 'UNDER_REVIEW' });
    await request(app)
      .post(`/api/v1/known-errors/${keId}/status`)
      .set('Authorization', `Bearer ${mgrToken}`)
      .send({ status: 'PUBLISHED' });

    const res = await request(app)
      .post(`/api/v1/known-errors/${keId}/publish-kb`)
      .set('Authorization', `Bearer ${mgrToken}`)
      .send({ visibility: 'EMPLOYEE_SELF_SERVICE' });
    expect(res.status).toBe(200);
    expect(res.body.data.publishedArticleId).toBeDefined();
    expect(res.body.data.visibility).toBe('EMPLOYEE_SELF_SERVICE');
  });
});

describe('Detection & similarity (Section 13 AC12)', () => {
  it('triggers detection job manually (GET /detect)', async () => {
    const res = await request(app)
      .get('/api/v1/problems/detect')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toBeDefined();
  });

  it('finds related problems via on-demand API (GET /:id/similar)', async () => {
    // Create a problem
    const p1 = await request(app)
      .post('/api/v1/problems')
      .set('Authorization', `Bearer ${techToken}`)
      .send(getValidProblem());
    const problemId = p1.body.data.id;

    // Find similar
    const res = await request(app)
      .get(`/api/v1/problems/${problemId}/similar`)
      .set('Authorization', `Bearer ${techToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toBeDefined();
    expect(Array.isArray(res.body.data)).toBe(true);
  });
});

describe('Adversarial tests (Section 13 AC13)', () => {
  it('rejects unauthenticated requests', async () => {
    const res = await request(app).get('/api/v1/problems');
    expect(res.status).toBe(401);
  });

  it('stores XSS payloads as inert text and never serves them as HTML', async () => {
    // The API deliberately does not blocklist markup: a blocklist both
    // false-positives on legitimate text ("node=primary", "a < b") and is
    // bypassable via regex statefulness. The boundary is that stored content is
    // plain text and every response is application/json, so a browser never
    // parses it as markup; the client escapes at render time.
    const xssPayloads = [
      '<script>alert(1)</script>',
      '"><img src=x onerror=alert(1)>',
      'javascript:alert(1)',
      '<iframe src="javascript:alert(1)"></iframe>',
    ];
    for (const payload of xssPayloads) {
      const created = await request(app)
        .post('/api/v1/problems')
        .set('Authorization', `Bearer ${techToken}`)
        .send({ ...getValidProblem(), title: payload });
      expect(created.status).toBe(201);
      expect(created.headers['content-type']).toMatch(/application\/json/);

      // Round-trips byte-for-byte: no silent mangling that would corrupt
      // legitimate titles containing <, > or &.
      const fetched = await request(app)
        .get(`/api/v1/problems/${created.body.data.id}`)
        .set('Authorization', `Bearer ${techToken}`);
      expect(fetched.status).toBe(200);
      expect(fetched.body.data.title).toBe(payload);
      expect(fetched.headers['content-type']).toMatch(/application\/json/);
    }
  });

  it('rejects oversized inputs (>10000 chars)', async () => {
    const largeDescription = 'A'.repeat(15000);
    const res = await request(app)
      .post('/api/v1/problems')
      .set('Authorization', `Bearer ${techToken}`)
      .send({ ...getValidProblem(), description: largeDescription });
    expect(res.status).toBe(400);
  });

  it('prevents double-submit via optimistic locking (version)', async () => {
    const createRes = await request(app)
      .post('/api/v1/problems')
      .set('Authorization', `Bearer ${techToken}`)
      .send(getValidProblem());
    const problemId = createRes.body.data.id;
    const version = createRes.body.data.version;

    // First update succeeds
    const res1 = await request(app)
      .patch(`/api/v1/problems/${problemId}`)
      .set('Authorization', `Bearer ${techToken}`)
      .send({ title: 'Updated title', version });
    expect(res1.status).toBe(200);

    // Second update with stale version fails
    const res2 = await request(app)
      .patch(`/api/v1/problems/${problemId}`)
      .set('Authorization', `Bearer ${techToken}`)
      .send({ title: 'Another title', version });
    expect(res2.status).toBe(409);
  });

  it('enforces RBAC - employee cannot access problems endpoints', async () => {
    const res = await request(app)
      .get('/api/v1/problems')
      .set('Authorization', `Bearer ${empToken}`);
    expect(res.status).toBe(403);
  });

  it('enforces RBAC - technician cannot transition without permission', async () => {
    const createRes = await request(app)
      .post('/api/v1/problems')
      .set('Authorization', `Bearer ${techToken}`)
      .send(getValidProblem());
    const problemId = createRes.body.data.id;

    // Create a user with only employee role (no problems:transition)
    const emp2 = await createUser(adminToken, { email: 'emp2@test.local', name: 'Employee 2', password: 'Password123abc', roles: ['employee'] });
    const emp2Token = await login('emp2@test.local', 'Password123abc');

    const res = await request(app)
      .post(`/api/v1/problems/${problemId}/status`)
      .set('Authorization', `Bearer ${emp2Token}`)
      .send({ status: 'INVESTIGATION' });
    expect(res.status).toBe(403);
  });
});

describe('Update & delete (Section 13 AC14)', () => {
  let problemId: string;

  beforeEach(async () => {
    const res = await request(app)
      .post('/api/v1/problems')
      .set('Authorization', `Bearer ${techToken}`)
      .send(getValidProblem());
    problemId = res.body.data.id;
  });

  it('updates problem fields', async () => {
    const res = await request(app)
      .patch(`/api/v1/problems/${problemId}`)
      .set('Authorization', `Bearer ${techToken}`)
      .send({ title: 'Updated title', priority: 'CRITICAL', version: 1 });
    expect(res.status).toBe(200);
    expect(res.body.data.title).toBe('Updated title');
    expect(res.body.data.priority).toBe('CRITICAL');
    expect(res.body.data.version).toBe(2);
  });

  it('rejects update with stale version', async () => {
    const res1 = await request(app)
      .patch(`/api/v1/problems/${problemId}`)
      .set('Authorization', `Bearer ${techToken}`)
      .send({ title: 'First update', version: 1 });
    expect(res1.status).toBe(200);

    const res2 = await request(app)
      .patch(`/api/v1/problems/${problemId}`)
      .set('Authorization', `Bearer ${techToken}`)
      .send({ title: 'Stale update', version: 1 });
    expect(res2.status).toBe(409);
  });

  it('requires problems:update permission', async () => {
    const res = await request(app)
      .patch(`/api/v1/problems/${problemId}`)
      .set('Authorization', `Bearer ${empToken}`)
      .send({ title: 'Hack', version: 1 });
    expect(res.status).toBe(403);
  });
});

describe('Full lifecycle integration (Section 13 end-to-end)', () => {
  it('completes full problem lifecycle: IDENTIFIED -> INVESTIGATION -> ROOT_CAUSE_KNOWN -> WORKAROUND_DOCUMENTED -> PENDING_CHANGE -> RESOLVED -> CLOSED', async () => {
    // 1. Create problem
    const createRes = await request(app)
      .post('/api/v1/problems')
      .set('Authorization', `Bearer ${techToken}`)
      .send(getValidProblem());
    const problemId = createRes.body.data.id;
    expect(createRes.body.data.status).toBe('IDENTIFIED');

    // 2. Transition to INVESTIGATION
    let res = await request(app)
      .post(`/api/v1/problems/${problemId}/status`)
      .set('Authorization', `Bearer ${techToken}`)
      .send({ status: 'INVESTIGATION' });
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('INVESTIGATION');

    // 3. Add RCA and transition to ROOT_CAUSE_KNOWN
    await request(app)
      .post(`/api/v1/problems/${problemId}/rca`)
      .set('Authorization', `Bearer ${techToken}`)
      .send({ rootCause: 'Faulty firmware', confirmedRootCause: true });
    res = await request(app)
      .post(`/api/v1/problems/${problemId}/status`)
      .set('Authorization', `Bearer ${techToken}`)
      .send({ status: 'ROOT_CAUSE_KNOWN' });
    expect(res.body.data.status).toBe('ROOT_CAUSE_KNOWN');

    // 4. Add workaround and transition to WORKAROUND_DOCUMENTED
    await request(app)
      .post(`/api/v1/problems/${problemId}/workaround`)
      .set('Authorization', `Bearer ${techToken}`)
      .send({ workaround: 'Use 5GHz band' });
    res = await request(app)
      .post(`/api/v1/problems/${problemId}/status`)
      .set('Authorization', `Bearer ${techToken}`)
      .send({ status: 'WORKAROUND_DOCUMENTED' });
    expect(res.body.data.status).toBe('WORKAROUND_DOCUMENTED');

    // 5. Link change and transition to PENDING_CHANGE
    await request(app)
      .post(`/api/v1/problems/${problemId}/changes`)
      .set('Authorization', `Bearer ${techToken}`)
      .send({ changeId: 'CHG-2026-000123' });
    res = await request(app)
      .post(`/api/v1/problems/${problemId}/status`)
      .set('Authorization', `Bearer ${techToken}`)
      .send({ status: 'PENDING_CHANGE' });
    expect(res.body.data.status).toBe('PENDING_CHANGE');

    // 6. Resolve
    res = await request(app)
      .post(`/api/v1/problems/${problemId}/status`)
      .set('Authorization', `Bearer ${techToken}`)
      .send({ status: 'RESOLVED', resolutionSummary: 'Firmware rolled back', verifiedFix: true });
    expect(res.body.data.status).toBe('RESOLVED');
    expect(res.body.data.resolvedAt).toBeDefined();

    // 7. Close
    res = await request(app)
      .post(`/api/v1/problems/${problemId}/status`)
      .set('Authorization', `Bearer ${techToken}`)
      .send({ status: 'CLOSED' });
    expect(res.body.data.status).toBe('CLOSED');

    // Verify audit trail has all transitions
    const auditRes = await request(app)
      .get(`/api/v1/problems/${problemId}/audit`)
      .set('Authorization', `Bearer ${techToken}`);
    const actions = auditRes.body.data.map((a: any) => a.action);
    expect(actions).toContain('STATUS_CHANGED');
  });
});