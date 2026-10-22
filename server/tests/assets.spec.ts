import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '../src/app.js';
import { prisma } from '../src/prisma/client.js';

const app = createApp();

const SETUP_TOKEN = 'test-setup-token-0123456789abcdef0123456789abcdef';
const ADMIN = { email: 'admin@test.local', password: 'Sup3rSecret!pass', name: 'Root Admin' };
const EMP = { email: 'emp@test.local', name: 'Employee Person', password: 'Password123abc' };
const EMP2 = { email: 'emp2@test.local', name: 'Second Employee', password: 'Password123abc' };
const TECH = { email: 'tech@test.local', name: 'Tech Person', password: 'Password123abc' };

let adminToken = '';
let empToken = '';
let emp2Token = '';
let techToken = '';
let empEmployeeId = '';
let emp2EmployeeId = '';

async function login(email: string, password: string): Promise<string> {
  const res = await request(app).post('/api/v1/auth/login').send({ email, password });
  return res.body.data.accessToken;
}

beforeEach(async () => {
  await request(app).post('/api/v1/auth/bootstrap').send({ setupToken: SETUP_TOKEN, ...ADMIN });
  adminToken = await login(ADMIN.email, ADMIN.password);

  const mkUser = (body: Record<string, unknown>, roles: string[]) =>
    request(app).post('/api/v1/users').set('Authorization', `Bearer ${adminToken}`).send({ ...body, roles });
  const e1 = await mkUser(EMP, ['employee']);
  empEmployeeId = e1.body.data.employee.id;
  const e2 = await mkUser(EMP2, ['employee']);
  emp2EmployeeId = e2.body.data.employee.id;
  await mkUser(TECH, ['it_technician']);

  empToken = await login(EMP.email, EMP.password);
  emp2Token = await login(EMP2.email, EMP2.password);
  techToken = await login(TECH.email, TECH.password);
});

async function createAsset(token = adminToken, overrides: Record<string, unknown> = {}) {
  const res = await request(app)
    .post('/api/v1/assets')
    .set('Authorization', `Bearer ${token}`)
    .send({ name: 'Dell Latitude 5440', category: 'hardware', ...overrides });
  return res;
}

describe('Asset CRUD and numbers', () => {
  it('creates an asset with a sequential AST number and audits it', async () => {
    const first = await createAsset();
    const second = await createAsset(adminToken, { name: 'HP LaserJet', category: 'appliance' });

    expect(first.status).toBe(201);
    expect(first.body.data.number).toMatch(/^AST-\d{4}-\d{6}$/);
    expect(second.body.data.number).not.toBe(first.body.data.number);

    const audit = await prisma.auditLog.findFirst({ where: { action: 'asset.created', targetId: first.body.data.id } });
    expect(audit).toBeTruthy();
  });

  it('blocks employees without asset permissions (403) and lists for IT', async () => {
    const denied = await createAsset(empToken);
    expect(denied.status).toBe(403);

    await createAsset();
    await createAsset();
    const list = await request(app).get('/api/v1/assets').set('Authorization', `Bearer ${techToken}`);
    expect(list.status).toBe(200);
    expect(list.body.data.length).toBe(2);
    expect(list.body.meta.total).toBe(2);
  });

  it('filters the list by q and status', async () => {
    await createAsset(adminToken, { name: 'Dell Latitude 5440', serialNumber: 'SN-DELL-001' });
    await createAsset(adminToken, { name: 'Cisco Switch', category: 'network' });

    const byQ = await request(app).get('/api/v1/assets?q=SN-DELL').set('Authorization', `Bearer ${techToken}`);
    expect(byQ.body.data.length).toBe(1);
    expect(byQ.body.data[0].name).toBe('Dell Latitude 5440');

    const byCategory = await request(app).get('/api/v1/assets?category=network').set('Authorization', `Bearer ${techToken}`);
    expect(byCategory.body.data.length).toBe(1);
    expect(byCategory.body.data[0].category).toBe('network');
  });
});

describe('Asset lifecycle transitions', () => {
  it('follows the state machine and rejects illegal jumps', async () => {
    const asset = (await createAsset()).body.data;

    const ok = await request(app)
      .post(`/api/v1/assets/${asset.id}/transition`)
      .set('Authorization', `Bearer ${techToken}`)
      .send({ status: 'in_maintenance', reason: 'annual service' });
    expect(ok.status).toBe(200);
    expect(ok.body.data.status).toBe('in_maintenance');

    const illegal = await request(app)
      .post(`/api/v1/assets/${asset.id}/transition`)
      .set('Authorization', `Bearer ${techToken}`)
      .send({ status: 'in_repair' });
    expect(illegal.status).toBe(400);

    const audit = await prisma.auditLog.findFirst({ where: { action: 'asset.status_changed', targetId: asset.id } });
    expect(audit).toBeTruthy();
  });

  it('blocks assignment of retired assets', async () => {
    const asset = (await createAsset()).body.data;
    await request(app)
      .post(`/api/v1/assets/${asset.id}/transition`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'retired', reason: 'end of life' });

    const res = await request(app)
      .post(`/api/v1/assets/${asset.id}/assignments`)
      .set('Authorization', `Bearer ${techToken}`)
      .send({ employeeId: empEmployeeId });
    expect(res.status).toBe(409);
  });
});

describe('Custody assignments', () => {
  it('assign → acknowledge → return lifecycle with custodian tracking', async () => {
    const asset = (await createAsset()).body.data;

    const assigned = await request(app)
      .post(`/api/v1/assets/${asset.id}/assignments`)
      .set('Authorization', `Bearer ${techToken}`)
      .send({ employeeId: empEmployeeId, note: 'new starter kit' });
    expect(assigned.status).toBe(201);
    expect(assigned.body.data.status).toBe('active');

    // Asset became deployed with the employee as custodian.
    const detail1 = await request(app).get(`/api/v1/assets/${asset.id}`).set('Authorization', `Bearer ${techToken}`);
    expect(detail1.body.data.status).toBe('deployed');
    expect(detail1.body.data.custodian.id).toBe(empEmployeeId);

    // Employee acknowledges their own assignment.
    const ack = await request(app)
      .post(`/api/v1/assets/assignments/${assigned.body.data.id}/acknowledge`)
      .set('Authorization', `Bearer ${empToken}`);
    expect(ack.status).toBe(200);
    expect(ack.body.data.acknowledgedAt).toBeTruthy();

    // A different employee cannot acknowledge it.
    const asset2 = (await createAsset()).body.data;
    const assigned2 = await request(app)
      .post(`/api/v1/assets/${asset2.id}/assignments`)
      .set('Authorization', `Bearer ${techToken}`)
      .send({ employeeId: empEmployeeId });
    const wrongAck = await request(app)
      .post(`/api/v1/assets/assignments/${assigned2.body.data.id}/acknowledge`)
      .set('Authorization', `Bearer ${emp2Token}`);
    expect(wrongAck.status).toBe(403);

    // Employee returns their own asset.
    const returned = await request(app)
      .post(`/api/v1/assets/assignments/${assigned2.body.data.id}/return`)
      .set('Authorization', `Bearer ${empToken}`)
      .send({ note: 'leaving the company' });
    expect(returned.status).toBe(200);
    expect(returned.body.data.status).toBe('returned');

    const detail2 = await request(app).get(`/api/v1/assets/${asset2.id}`).set('Authorization', `Bearer ${techToken}`);
    expect(detail2.body.data.status).toBe('in_stock');
    expect(detail2.body.data.custodian).toBeNull();
  });

  it('enforces one ACTIVE assignment per asset; reassign closes the old one', async () => {
    const asset = (await createAsset()).body.data;

    const first = await request(app)
      .post(`/api/v1/assets/${asset.id}/assignments`)
      .set('Authorization', `Bearer ${techToken}`)
      .send({ employeeId: empEmployeeId });
    expect(first.status).toBe(201);

    // Reassign to emp2: old assignment auto-returns, new one active.
    const second = await request(app)
      .post(`/api/v1/assets/${asset.id}/assignments`)
      .set('Authorization', `Bearer ${techToken}`)
      .send({ employeeId: emp2EmployeeId });
    expect(second.status).toBe(201);

    const history = await prisma.assetAssignment.findMany({
      where: { assetId: asset.id },
      orderBy: { assignedAt: 'asc' },
    });
    expect(history.length).toBe(2);
    expect(history.filter((a) => a.status === 'active').length).toBe(1);
    expect(history.find((a) => a.status === 'active')?.employeeId).toBe(emp2EmployeeId);

    // The DB constraint itself: a second active row is impossible.
    const admin = await prisma.user.findUniqueOrThrow({ where: { email: ADMIN.email } });
    await expect(
      prisma.assetAssignment.create({
        data: {
          assetId: asset.id,
          employeeId: empEmployeeId,
          assignedById: admin.id,
          activeKey: asset.id,
        },
      }),
    ).rejects.toThrow();
  });

  it('supports loans with dueAt and employee self-assignment view', async () => {
    const asset = (await createAsset(adminToken, { name: 'Loaner Projector', category: 'peripheral' })).body.data;
    const due = new Date(Date.now() + 7 * 86400000).toISOString();
    const loan = await request(app)
      .post(`/api/v1/assets/${asset.id}/assignments`)
      .set('Authorization', `Bearer ${techToken}`)
      .send({ employeeId: empEmployeeId, dueAt: due, note: 'conference loan' });
    expect(loan.status).toBe(201);
    expect(loan.body.data.dueAt).toBe(due);

    const mine = await request(app).get('/api/v1/assets/assignments/my').set('Authorization', `Bearer ${empToken}`);
    expect(mine.status).toBe(200);
    expect(mine.body.data.length).toBe(1);
    expect(mine.body.data[0].asset.id).toBe(asset.id);
  });
});
