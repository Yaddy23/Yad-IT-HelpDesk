import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '../src/app.js';
import { prisma } from '../src/prisma/client.js';
import { runSlaSweep } from '../src/sla/sla.service.js';

const app = createApp();

const SETUP_TOKEN = 'test-setup-token-0123456789abcdef0123456789abcdef';
const ADMIN = { email: 'admin@test.local', password: 'Sup3rSecret!pass', name: 'Root Admin' };
const EMP = { email: 'emp@test.local', name: 'Employee Person', password: 'Password123abc' };
const TECH = { email: 'tech@test.local', name: 'Tech Person', password: 'Password123abc' };
const MGR = { email: 'mgr@test.local', name: 'Manager Person', password: 'Password123abc' };

let adminToken = '';
let empToken = '';
let techToken = '';
let techEmployeeId = '';

async function login(email: string, password: string): Promise<string> {
  const res = await request(app).post('/api/v1/auth/login').send({ email, password });
  return res.body.data.accessToken;
}

beforeEach(async () => {
  await request(app).post('/api/v1/auth/bootstrap').send({ setupToken: SETUP_TOKEN, ...ADMIN });
  adminToken = await login(ADMIN.email, ADMIN.password);

  const mkUser = (body: Record<string, unknown>, roles: string[]) =>
    request(app).post('/api/v1/users').set('Authorization', `Bearer ${adminToken}`).send({ ...body, roles });
  await mkUser(EMP, ['employee']);
  const tech = await mkUser(TECH, ['it_technician']);
  techEmployeeId = tech.body.data.employee.id;
  await mkUser(MGR, ['it_manager']);

  empToken = await login(EMP.email, EMP.password);
  techToken = await login(TECH.email, TECH.password);
});

/** Standard policy: respond within 10 min (warn 50%), resolve within 60 min. */
async function seedPolicy() {
  return prisma.slaPolicy.create({
    data: {
      name: 'Standard SLA',
      responseTargetMins: 10,
      resolveTargetMins: 60,
      warnPercent: 50,
      appliesTo: {},
    },
  });
}

async function createTicketAsEmp() {
  const res = await request(app)
    .post('/api/v1/tickets')
    .set('Authorization', `Bearer ${empToken}`)
    .send({
      title: 'Laptop will not start at all',
      description: 'The laptop shows a black screen when I press the power button.',
      category: 'hardware',
      impact: 'medium',
      urgency: 'high',
    });
  expect(res.status).toBe(201);
  return res.body.data as { id: string; number: string };
}

/** Backdates every instance's clock so thresholds are already passed. */
async function backdateInstances(ticketId: string, minutesAgo: number) {
  await prisma.slaInstance.updateMany({
    where: { ticketId },
    data: { startAt: new Date(Date.now() - minutesAgo * 60000) },
  });
}

/** Transitions with the current version (optimistic concurrency) filled in. */
async function transitionAs(token: string, ticketId: string, body: Record<string, unknown>) {
  const detail = await request(app).get(`/api/v1/tickets/${ticketId}`).set('Authorization', `Bearer ${token}`);
  const version = detail.body.data.version as number;
  const res = await request(app)
    .post(`/api/v1/tickets/${ticketId}/transition`)
    .set('Authorization', `Bearer ${token}`)
    .send({ ...body, version });
  expect([200, 201]).toContain(res.status);
  return res;
}

describe('SLA instance lifecycle', () => {
  it('instantiates response + resolution instances from matching policies on create', async () => {
    await seedPolicy();
    const ticket = await createTicketAsEmp();

    const instances = await prisma.slaInstance.findMany({ where: { ticketId: ticket.id } });
    expect(instances.map((i) => i.type).sort()).toEqual(['resolution', 'response']);
    expect(instances.every((i) => i.state === 'within')).toBe(true);
  });

  it('fires the warning escalation once, never twice (sweep rerun is idempotent)', async () => {
    await seedPolicy();
    const ticket = await createTicketAsEmp();
    // 10-min response target, warn at 50% → backdate 6 minutes.
    await backdateInstances(ticket.id, 6);

    const first = await runSlaSweep();
    expect(first.escalated).toBeGreaterThanOrEqual(1);

    const responseInstance = await prisma.slaInstance.findFirstOrThrow({
      where: { ticketId: ticket.id, type: 'response' },
    });
    expect(responseInstance.state).toBe('approaching');
    const escalations = await prisma.slaEscalation.findMany({ where: { instanceId: responseInstance.id } });
    expect(escalations.map((e) => e.thresholdKey)).toEqual(['approaching']);

    // Rerun — no new escalations (unique constraint) even though the state persists.
    await runSlaSweep();
    await runSlaSweep();
    const escalationsAfter = await prisma.slaEscalation.findMany({ where: { instanceId: responseInstance.id } });
    expect(escalationsAfter).toHaveLength(1);
  });

  it('breaches past the target, notifies assignee + managers once, and audits', async () => {
    await seedPolicy();
    const ticket = await createTicketAsEmp();
    // Assignment itself completes the response SLA (met — instant); the
    // resolution instance keeps running and is the one that breaches.
    await request(app)
      .post(`/api/v1/tickets/${ticket.id}/assign`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ assigneeId: techEmployeeId });
    await backdateInstances(ticket.id, 70); // resolution target: 60 min

    await runSlaSweep();
    await runSlaSweep(); // idempotency check

    const resolution = await prisma.slaInstance.findFirstOrThrow({
      where: { ticketId: ticket.id, type: 'resolution' },
    });
    expect(resolution.state).toBe('breached');
    expect(resolution.completedAt).toBeNull(); // still running until resolved

    const escalations = await prisma.slaEscalation.findMany({ where: { instanceId: resolution.id } });
    expect(escalations.map((e) => e.thresholdKey).sort()).toEqual(['breached']);

    // Assignee (tech user) got exactly one breach notification…
    const techUser = await prisma.user.findUniqueOrThrow({ where: { email: TECH.email } });
    const techNotifs = await prisma.notification.findMany({ where: { userId: techUser.id, type: 'sla.breach' } });
    expect(techNotifs).toHaveLength(1);

    // …and each it_manager got exactly one (dedupeKey unique per user).
    const mgrUser = await prisma.user.findUniqueOrThrow({ where: { email: MGR.email } });
    const mgrNotifs = await prisma.notification.findMany({ where: { userId: mgrUser.id, type: 'sla.breach' } });
    expect(mgrNotifs).toHaveLength(1);

    const audits = await prisma.auditLog.findMany({ where: { action: 'sla.breached', targetId: ticket.id } });
    expect(audits).toHaveLength(1);
  });

  it('pauses on configured pause states and resumes with the pause converted', async () => {
    await seedPolicy();
    const ticket = await createTicketAsEmp(); // also ensures the settings row exists
    // The test schema's settings row starts with no pause states — configure them.
    await prisma.systemSettings.updateMany({
      where: { key: 'global' },
      data: { slaPauseStates: ['pending_employee', 'pending_vendor'] },
    });
    await transitionAs(adminToken, ticket.id, { status: 'pending_employee' });

    // Hook pauses immediately; sweep confirms state.
    await runSlaSweep();
    let instances = await prisma.slaInstance.findMany({ where: { ticketId: ticket.id } });
    expect(instances.every((i) => i.state === 'paused' && i.pausedAt !== null)).toBe(true);

    // Backdate the pause 30 minutes — a long pause must not burn the target.
    await prisma.slaInstance.updateMany({
      where: { ticketId: ticket.id },
      data: { pausedAt: new Date(Date.now() - 30 * 60000) },
    });

    await transitionAs(adminToken, ticket.id, { status: 'in_progress' });

    instances = await prisma.slaInstance.findMany({ where: { ticketId: ticket.id } });
    expect(instances.every((i) => i.pausedAt === null)).toBe(true);
    // The ~30 real minutes of pause were converted to business ms and deducted.
    for (const inst of instances) {
      expect(inst.pausedMs).toBeGreaterThan(29 * 60000);
    }

    // Despite the 30-minute wall-clock gap, nothing approached breach (10-min target).
    const after = await runSlaSweep();
    const responseInstance = await prisma.slaInstance.findFirstOrThrow({
      where: { ticketId: ticket.id, type: 'response' },
    });
    expect(responseInstance.state).toBe('within');
    expect(after.escalated).toBe(0);
  });

  it('completes resolution instances met/missed on resolve and met when fast', async () => {
    await seedPolicy();
    const ticket = await createTicketAsEmp();
    await transitionAs(adminToken, ticket.id, { status: 'in_progress' });

    // Resolution target 60 min, well inside → met.
    await transitionAs(adminToken, ticket.id, { status: 'resolved', resolutionNote: 'Replaced the battery cable.' });

    const resolution = await prisma.slaInstance.findFirstOrThrow({
      where: { ticketId: ticket.id, type: 'resolution' },
    });
    expect(resolution.state).toBe('met');
    expect(resolution.completedAt).not.toBeNull();
  });

  it('marks resolution missed when the clock already passed the target', async () => {
    await seedPolicy();
    const ticket = await createTicketAsEmp();
    await transitionAs(adminToken, ticket.id, { status: 'in_progress' });
    await backdateInstances(ticket.id, 90);

    await transitionAs(adminToken, ticket.id, { status: 'resolved', resolutionNote: 'Replaced the battery cable.' });

    const resolution = await prisma.slaInstance.findFirstOrThrow({
      where: { ticketId: ticket.id, type: 'resolution' },
    });
    expect(resolution.state).toBe('missed');
  });

  it('re-arms resolution instances on reopen (fresh clock, escalations cleared)', async () => {
    await seedPolicy();
    const ticket = await createTicketAsEmp();
    await transitionAs(adminToken, ticket.id, { status: 'in_progress' });
    await backdateInstances(ticket.id, 90);
    await transitionAs(adminToken, ticket.id, { status: 'resolved', resolutionNote: 'Replaced the battery cable.' });

    const before = await prisma.slaInstance.findFirstOrThrow({ where: { ticketId: ticket.id, type: 'resolution' } });
    expect(before.state).toBe('missed');

    // Reopen within the window (requester).
    await transitionAs(empToken, ticket.id, { status: 'in_progress' });

    const after = await prisma.slaInstance.findFirstOrThrow({ where: { ticketId: ticket.id, type: 'resolution' } });
    expect(after.state).toBe('within');
    expect(after.completedAt).toBeNull();
    expect(after.startAt.getTime()).toBeGreaterThan(before.startAt.getTime());
    expect(await prisma.slaEscalation.count({ where: { instanceId: after.id } })).toBe(0);
  });

  it('canceled tickets terminate their SLA without met/missed judgment', async () => {
    await seedPolicy();
    const ticket = await createTicketAsEmp();
    await transitionAs(empToken, ticket.id, { status: 'canceled' });

    const instances = await prisma.slaInstance.findMany({ where: { ticketId: ticket.id } });
    expect(instances).toHaveLength(0); // non-terminal instances removed
  });
});

describe('Ticket detail SLA chips', () => {
  it('exposes live sla indicators on the ticket detail payload', async () => {
    await seedPolicy();
    const ticket = await createTicketAsEmp();

    const res = await request(app).get(`/api/v1/tickets/${ticket.id}`).set('Authorization', `Bearer ${empToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.sla).toHaveLength(2);
    const types = res.body.data.sla.map((s: { type: string }) => s.type).sort();
    expect(types).toEqual(['resolution', 'response']);
    expect(res.body.data.sla[0]).toMatchObject({ state: 'within' });
    expect(typeof res.body.data.sla[0].elapsedMins).toBe('number');
    expect(res.body.data.sla[0].deadlineAt).toBeTruthy();
  });
});

describe('Notification dedupe', () => {
  it('ignores a second insert with the same dedupeKey', async () => {
    await seedPolicy();
    const ticket = await createTicketAsEmp();
    await request(app)
      .post(`/api/v1/tickets/${ticket.id}/assign`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ assigneeId: techEmployeeId });

    const techUser = await prisma.user.findUniqueOrThrow({ where: { email: TECH.email } });
    const payload = {
      userId: techUser.id,
      type: 'test.dedupe',
      title: 'Dedupe check',
      body: 'Only one of these should exist',
      ticketId: ticket.id,
      dedupeKey: 'test:dedupe-key:assignee',
    };
    const { createNotification } = await import('../src/modules/notifications/notifications.service.js');
    await createNotification(payload);
    await createNotification(payload);
    await createNotification(payload);

    const rows = await prisma.notification.findMany({ where: { userId: techUser.id, type: 'test.dedupe' } });
    expect(rows).toHaveLength(1);
  });
});

describe('SLA policy admin API', () => {
  it('manages policies for settings:manage and rejects other roles', async () => {
    const created = await request(app)
      .post('/api/v1/sla-policies')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Critical SLA', responseTargetMins: 5, resolveTargetMins: 30, appliesTo: { priorities: ['critical'] } });
    expect(created.status).toBe(201);

    const listed = await request(app).get('/api/v1/sla-policies').set('Authorization', `Bearer ${adminToken}`);
    expect(listed.status).toBe(200);
    expect(listed.body.data.map((p: { name: string }) => p.name)).toContain('Critical SLA');

    const patched = await request(app)
      .patch(`/api/v1/sla-policies/${created.body.data.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ active: false });
    expect(patched.status).toBe(200);
    expect(patched.body.data.active).toBe(false);

    const forbidden = await request(app)
      .post('/api/v1/sla-policies')
      .set('Authorization', `Bearer ${techToken}`)
      .send({ name: 'Rogue policy' });
    expect(forbidden.status).toBe(403);
  });

  it('creates instances only for newly matching policies after priority change', async () => {
    const standard = await seedPolicy();
    await request(app)
      .post('/api/v1/sla-policies')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Critical only', resolveTargetMins: 30, appliesTo: { priorities: ['critical'] } });

    const ticket = await createTicketAsEmp(); // medium × high → high: only Standard matches
    let instances = await prisma.slaInstance.findMany({ where: { ticketId: ticket.id } });
    expect(instances).toHaveLength(2); // response + resolution from Standard

    // Override to critical → the Critical-only policy now matches and instantiates.
    const res = await request(app)
      .post(`/api/v1/tickets/${ticket.id}/priority`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ priority: 'critical', reason: 'Executive laptop — CEO blocked' });
    expect(res.status).toBe(200);

    instances = await prisma.slaInstance.findMany({ where: { ticketId: ticket.id } });
    const criticalPolicy = await prisma.slaPolicy.findUniqueOrThrow({ where: { name: 'Critical only' } });
    expect(instances.some((i) => i.policyId === criticalPolicy.id && i.type === 'resolution')).toBe(true);
    expect(instances.some((i) => i.policyId === standard.id && i.type === 'response')).toBe(true);
  });
});
