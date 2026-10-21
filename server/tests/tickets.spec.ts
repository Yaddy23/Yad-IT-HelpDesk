import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '../src/app.js';

const app = createApp();

const SETUP_TOKEN = 'test-setup-token-0123456789abcdef0123456789abcdef';
const ADMIN = { email: 'admin@test.local', password: 'Sup3rSecret!pass', name: 'Root Admin' };
const EMP = { email: 'emp@test.local', name: 'Employee Person', password: 'Password123abc' };
const TECH = { email: 'tech@test.local', name: 'Tech Person', password: 'Password123abc' };

let adminToken = '';
let empToken = '';
let techToken = '';
let empEmployeeId = '';
let techEmployeeId = '';

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

beforeEach(async () => {
  // Tables truncated by setup — bootstrap and log in all actors fresh.
  await request(app).post('/api/v1/auth/bootstrap').send({ setupToken: SETUP_TOKEN, ...ADMIN });
  adminToken = await login(ADMIN.email, ADMIN.password);

  const emp = await createUser(adminToken, { ...EMP, roles: ['employee'] });
  empEmployeeId = emp.body.data.employee.id;
  const tech = await createUser(adminToken, { ...TECH, roles: ['it_technician'] });
  techEmployeeId = tech.body.data.employee.id;

  empToken = await login(EMP.email, EMP.password);
  techToken = await login(TECH.email, TECH.password);
});

const validTicket = {
  title: 'Laptop will not start',
  description: 'The laptop shows a black screen when I press the power button.',
  category: 'hardware',
  impact: 'medium',
  urgency: 'high',
};

describe('Ticket creation & numbering', () => {
  it('creates a ticket with matrix priority and INC-YYYY-NNNNNN number', async () => {
    const res = await request(app)
      .post('/api/v1/tickets')
      .set('Authorization', `Bearer ${empToken}`)
      .send(validTicket);
    expect(res.status).toBe(201);
    expect(res.body.data.number).toMatch(/^INC-\d{4}-\d{6}$/);
    expect(res.body.data.priority).toBe('high'); // medium × high → high
    expect(res.body.data.status).toBe('new');
    expect(res.body.data.requester.id).toBe(empEmployeeId);
  });

  it('increments the number sequentially', async () => {
    const one = await request(app)
      .post('/api/v1/tickets')
      .set('Authorization', `Bearer ${empToken}`)
      .send(validTicket);
    const two = await request(app)
      .post('/api/v1/tickets')
      .set('Authorization', `Bearer ${empToken}`)
      .send({ ...validTicket, title: 'Second ticket needed' });
    const n1 = Number(one.body.data.number.slice(-6));
    const n2 = Number(two.body.data.number.slice(-6));
    expect(n2).toBe(n1 + 1);
  });

  it('rejects invalid payloads', async () => {
    const res = await request(app)
      .post('/api/v1/tickets')
      .set('Authorization', `Bearer ${empToken}`)
      .send({ ...validTicket, title: 'hi' });
    expect(res.status).toBe(400);
  });
});

describe('Record-level authorization', () => {
  it('employee sees only their own tickets', async () => {
    await request(app).post('/api/v1/tickets').set('Authorization', `Bearer ${empToken}`).send(validTicket);

    // Second employee files another ticket.
    await createUser(adminToken, { email: 'emp2@test.local', name: 'Second Employee', password: 'Password123abc', roles: ['employee'] });
    const emp2Token = await login('emp2@test.local', 'Password123abc');
    await request(app).post('/api/v1/tickets').set('Authorization', `Bearer ${emp2Token}`).send(validTicket);

    const mine = await request(app).get('/api/v1/tickets').set('Authorization', `Bearer ${empToken}`);
    expect(mine.status).toBe(200);
    expect(mine.body.data).toHaveLength(1);
    expect(mine.body.data[0].requester.id).toBe(empEmployeeId);
  });

  it("employee cannot read someone else's ticket directly", async () => {
    await createUser(adminToken, { email: 'emp2@test.local', name: 'Second Employee', password: 'Password123abc', roles: ['employee'] });
    const emp2Token = await login('emp2@test.local', 'Password123abc');
    const created = await request(app).post('/api/v1/tickets').set('Authorization', `Bearer ${emp2Token}`).send(validTicket);

    const res = await request(app).get(`/api/v1/tickets/${created.body.data.id}`).set('Authorization', `Bearer ${empToken}`);
    expect(res.status).toBe(404);
  });

  it('technician sees tickets in their group queue after assignment', async () => {
    const created = await request(app).post('/api/v1/tickets').set('Authorization', `Bearer ${empToken}`).send(validTicket);
    // Assign the ticket directly to the technician's employee id.
    await request(app)
      .post(`/api/v1/tickets/${created.body.data.id}/assign`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ assigneeId: techEmployeeId });

    const list = await request(app).get('/api/v1/tickets?queue=my').set('Authorization', `Bearer ${techToken}`);
    expect(list.status).toBe(200);
    expect(list.body.data).toHaveLength(1);
    expect(list.body.data[0].id).toBe(created.body.data.id);
  });
});

describe('Lifecycle & permissions', () => {
  async function createAsEmployee() {
    const res = await request(app).post('/api/v1/tickets').set('Authorization', `Bearer ${empToken}`).send(validTicket);
    return res.body.data as { id: string; version: number; number: string };
  }

  it('assigns with append-only history and in_progress transition', async () => {
    const ticket = await createAsEmployee();
    const res = await request(app)
      .post(`/api/v1/tickets/${ticket.id}/assign`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ assigneeId: techEmployeeId, note: 'Hardware queue' });
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('in_progress');
    expect(res.body.data.assignee.id).toBe(techEmployeeId);

    const detail = await request(app).get(`/api/v1/tickets/${ticket.id}`).set('Authorization', `Bearer ${adminToken}`);
    expect(detail.body.data.assignments).toHaveLength(1);
    const actions = detail.body.data.activities.map((a: { action: string }) => a.action);
    expect(actions).toContain('created');
    expect(actions).toContain('assigned');
  });

  it('requires tickets:assign to assign', async () => {
    const ticket = await createAsEmployee();
    const res = await request(app)
      .post(`/api/v1/tickets/${ticket.id}/assign`)
      .set('Authorization', `Bearer ${techToken}`)
      .send({ assigneeId: techEmployeeId });
    expect(res.status).toBe(403);
  });

  it('resolves with a note and closes afterwards', async () => {
    const ticket = await createAsEmployee();
    await request(app)
      .post(`/api/v1/tickets/${ticket.id}/assign`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ assigneeId: techEmployeeId });

    // Technician holds tickets:resolve.
    const resolve = await request(app)
      .post(`/api/v1/tickets/${ticket.id}/transition`)
      .set('Authorization', `Bearer ${techToken}`)
      .send({ status: 'resolved', resolutionNote: 'Replaced the power adapter.', version: ticket.version });
    expect(resolve.status).toBe(200);
    expect(resolve.body.data.status).toBe('resolved');

    // Employee (requester, no close permission) cannot close.
    const empClose = await request(app)
      .post(`/api/v1/tickets/${ticket.id}/transition`)
      .set('Authorization', `Bearer ${empToken}`)
      .send({ status: 'closed', version: resolve.body.data.version });
    expect(empClose.status).toBe(403);

    // Admin closes it.
    const close = await request(app)
      .post(`/api/v1/tickets/${ticket.id}/transition`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'closed', version: resolve.body.data.version });
    expect(close.status).toBe(200);
    expect(close.body.data.status).toBe('closed');

    // Closed is terminal for agents too.
    const after = await request(app)
      .post(`/api/v1/tickets/${ticket.id}/transition`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'in_progress', version: close.body.data.version });
    expect(after.status).toBe(409);
  });

  it('rejects resolution without a note', async () => {
    const ticket = await createAsEmployee();
    const res = await request(app)
      .post(`/api/v1/tickets/${ticket.id}/transition`)
      .set('Authorization', `Bearer ${techToken}`)
      .send({ status: 'resolved', version: ticket.version });
    expect(res.status).toBe(400);
  });

  it('lets the requester reopen a resolved ticket within the window', async () => {
    const ticket = await createAsEmployee();
    await request(app)
      .post(`/api/v1/tickets/${ticket.id}/transition`)
      .set('Authorization', `Bearer ${techToken}`)
      .send({ status: 'resolved', resolutionNote: 'Fixed the cable.', version: ticket.version });

    const reopen = await request(app)
      .post(`/api/v1/tickets/${ticket.id}/transition`)
      .set('Authorization', `Bearer ${empToken}`)
      .send({ status: 'in_progress', version: ticket.version + 1 });
    expect(reopen.status).toBe(200);
    expect(reopen.body.data.status).toBe('in_progress');
    expect(reopen.body.data.reopenedCount).toBe(1);
  });

  it('blocks stale versions (optimistic concurrency)', async () => {
    const ticket = await createAsEmployee();
    await request(app)
      .post(`/api/v1/tickets/${ticket.id}/transition`)
      .set('Authorization', `Bearer ${techToken}`)
      .send({ status: 'in_progress', version: ticket.version });
    const stale = await request(app)
      .post(`/api/v1/tickets/${ticket.id}/transition`)
      .set('Authorization', `Bearer ${techToken}`)
      .send({ status: 'pending_employee', version: ticket.version }); // now stale
    expect(stale.status).toBe(409);
  });

  it('requester cannot transition beyond reopen/cancel', async () => {
    const ticket = await createAsEmployee();
    const res = await request(app)
      .post(`/api/v1/tickets/${ticket.id}/transition`)
      .set('Authorization', `Bearer ${empToken}`)
      .send({ status: 'resolved', resolutionNote: 'self-resolution', version: ticket.version });
    expect(res.status).toBe(403);
  });
});

describe('Comments', () => {
  it('hides internal work notes from the requester', async () => {
    const created = await request(app).post('/api/v1/tickets').set('Authorization', `Bearer ${empToken}`).send(validTicket);
    const id = created.body.data.id as string;

    // The technician must be involved (assigned) before they can even see the ticket.
    await request(app)
      .post(`/api/v1/tickets/${id}/assign`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ assigneeId: techEmployeeId });

    const pub = await request(app)
      .post(`/api/v1/tickets/${id}/comments`)
      .set('Authorization', `Bearer ${techToken}`)
      .send({ body: 'We are looking into it.' });
    expect(pub.status).toBe(201);
    const internal = await request(app)
      .post(`/api/v1/tickets/${id}/comments`)
      .set('Authorization', `Bearer ${techToken}`)
      .send({ body: 'Suspect faulty charger — check warranty.', isInternal: true });
    expect(internal.status).toBe(201);

    const asEmployee = await request(app).get(`/api/v1/tickets/${id}`).set('Authorization', `Bearer ${empToken}`);
    const bodies = asEmployee.body.data.comments.map((c: { body: string }) => c.body);
    expect(bodies).toContain('We are looking into it.');
    expect(bodies).not.toContain('Suspect faulty charger — check warranty.');

    const asAdmin = await request(app).get(`/api/v1/tickets/${id}`).set('Authorization', `Bearer ${adminToken}`);
    expect(asAdmin.body.data.comments).toHaveLength(2);
  });

  it('blocks employees from writing internal notes', async () => {
    const created = await request(app).post('/api/v1/tickets').set('Authorization', `Bearer ${empToken}`).send(validTicket);
    const res = await request(app)
      .post(`/api/v1/tickets/${created.body.data.id}/comments`)
      .set('Authorization', `Bearer ${empToken}`)
      .send({ body: 'secret note', isInternal: true });
    expect(res.status).toBe(403);
  });
});

describe('Priority override', () => {
  it('overrides with a reason and records the audit trail', async () => {
    const created = await request(app).post('/api/v1/tickets').set('Authorization', `Bearer ${empToken}`).send(validTicket);
    const res = await request(app)
      .post(`/api/v1/tickets/${created.body.data.id}/priority`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ priority: 'critical', reason: 'Major outage affecting the whole floor' });
    expect(res.status).toBe(200);
    expect(res.body.data.priority).toBe('critical');
    expect(res.body.data.priorityOverrideReason).toContain('Major outage');

    const detail = await request(app).get(`/api/v1/tickets/${created.body.data.id}`).set('Authorization', `Bearer ${adminToken}`);
    expect(detail.body.data.activities.map((a: { action: string }) => a.action)).toContain('priority_changed');

    const audit = await request(app).get('/api/v1/audit').set('Authorization', `Bearer ${adminToken}`).query({ limit: 50 });
    const actions = audit.body.data.map((e: { action: string }) => e.action);
    expect(actions).toContain('ticket.priority_changed');
  });

  it('recomputes from the matrix when impact/urgency change', async () => {
    const created = await request(app).post('/api/v1/tickets').set('Authorization', `Bearer ${empToken}`).send(validTicket);
    const res = await request(app)
      .post(`/api/v1/tickets/${created.body.data.id}/priority`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ impact: 'low', urgency: 'low', reason: 'Downgraded after triage call' });
    expect(res.status).toBe(200);
    expect(res.body.data.priority).toBe('low');
    expect(res.body.data.priorityOverrideReason).toBeNull();
  });

  it('requires a reason', async () => {
    const created = await request(app).post('/api/v1/tickets').set('Authorization', `Bearer ${empToken}`).send(validTicket);
    const res = await request(app)
      .post(`/api/v1/tickets/${created.body.data.id}/priority`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ priority: 'low' });
    expect(res.status).toBe(400);
  });
});

describe('Queue counts', () => {
  it('reports open/unassigned/assignedToMe within scope', async () => {
    const created = await request(app).post('/api/v1/tickets').set('Authorization', `Bearer ${empToken}`).send(validTicket);
    await request(app)
      .post(`/api/v1/tickets/${created.body.data.id}/assign`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ assigneeId: techEmployeeId });

    const techCounts = await request(app).get('/api/v1/tickets/queues').set('Authorization', `Bearer ${techToken}`);
    expect(techCounts.status).toBe(200);
    expect(techCounts.body.data.assignedToMe).toBe(1);
    expect(techCounts.body.data.open).toBe(1);
  });
});
