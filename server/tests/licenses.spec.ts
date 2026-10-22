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
let techToken = '';

let empEmployeeId = '';
let emp2EmployeeId = '';
let thirdEmployeeId = '';

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
  const e2 = await mkUser(EMP2, ['employee']);
  await mkUser(TECH, ['it_technician']);
  empEmployeeId = e1.body.data.employee.id;
  emp2EmployeeId = e2.body.data.employee.id;

  const e3 = await mkUser({ email: 'emp3@test.local', name: 'Third Employee', password: 'Password123abc' }, ['employee']);
  thirdEmployeeId = e3.body.data.employee.id;

  techToken = await login(TECH.email, TECH.password);
});

async function createLicense(seats: number, overrides: Record<string, unknown> = {}): Promise<string> {
  const res = await request(app)
    .post('/api/v1/licenses')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ name: 'Office 365 Business', seats, type: 'subscription', ...overrides });
  expect(res.status).toBe(201);
  return res.body.data.id;
}

describe('Licenses', () => {
  it('creates and lists licenses with seat usage counts', async () => {
    const licenseId = await createLicense(5, { licenseKey: 'O365-BIZ-XXXX' });
    const list = await request(app).get('/api/v1/licenses').set('Authorization', `Bearer ${techToken}`);
    expect(list.status).toBe(200);
    const row = list.body.data.find((l: { id: string }) => l.id === licenseId);
    expect(row.seats).toBe(5);
    expect(row.seatsInUse).toBe(0);
  });

  it('blocks seat cuts below current usage', async () => {
    const licenseId = await createLicense(2);
    await request(app).post(`/api/v1/licenses/${licenseId}/assignments`).set('Authorization', `Bearer ${techToken}`).send({ employeeId: empEmployeeId });
    await request(app).post(`/api/v1/licenses/${licenseId}/assignments`).set('Authorization', `Bearer ${techToken}`).send({ employeeId: emp2EmployeeId });
    const cut = await request(app).patch(`/api/v1/licenses/${licenseId}`).set('Authorization', `Bearer ${adminToken}`).send({ seats: 1 });
    expect(cut.status).toBe(409);
    const raise = await request(app).patch(`/api/v1/licenses/${licenseId}`).set('Authorization', `Bearer ${adminToken}`).send({ seats: 3 });
    expect(raise.status).toBe(200);
    expect(raise.body.data.seats).toBe(3);
  });
});

describe('Seat assignments', () => {
  it('assigns seats up to the entitlement then 409s', async () => {
    const licenseId = await createLicense(2);

    const first = await request(app).post(`/api/v1/licenses/${licenseId}/assignments`).set('Authorization', `Bearer ${techToken}`).send({ employeeId: empEmployeeId });
    expect(first.status).toBe(201);
    const second = await request(app).post(`/api/v1/licenses/${licenseId}/assignments`).set('Authorization', `Bearer ${techToken}`).send({ employeeId: emp2EmployeeId });
    expect(second.status).toBe(201);
    const third = await request(app).post(`/api/v1/licenses/${licenseId}/assignments`).set('Authorization', `Bearer ${techToken}`).send({ employeeId: thirdEmployeeId });
    expect(third.status).toBe(409);
    expect(third.body.error.message).toContain('No seats left');
  });

  it('one active seat per employee per license; DB constraint backs it', async () => {
    const licenseId = await createLicense(5);
    await request(app).post(`/api/v1/licenses/${licenseId}/assignments`).set('Authorization', `Bearer ${techToken}`).send({ employeeId: empEmployeeId });

    const again = await request(app).post(`/api/v1/licenses/${licenseId}/assignments`).set('Authorization', `Bearer ${techToken}`).send({ employeeId: empEmployeeId });
    expect(again.status).toBe(409);

    // Even bypassing the API, the DB rejects a second active row for the pair.
    let dbRejected = false;
    try {
      await prisma.licenseAssignment.create({
        data: { licenseId, employeeId: empEmployeeId, assignedById: (await prisma.user.findFirstOrThrow({ where: { email: 'admin@test.local' } })).id, activeKey: `${licenseId}:${empEmployeeId}` },
      });
    } catch {
      dbRejected = true;
    }
    expect(dbRejected).toBe(true);
  });

  it('serializes concurrent assigns for different employees onto the seat limit', async () => {
    const licenseId = await createLicense(1);

    // Both fire at once: without the license-row lock both could pass the
    // seat check before either commits and over-allocate a 1-seat license.
    const [a, b] = await Promise.all([
      request(app).post(`/api/v1/licenses/${licenseId}/assignments`).set('Authorization', `Bearer ${techToken}`).send({ employeeId: empEmployeeId }),
      request(app).post(`/api/v1/licenses/${licenseId}/assignments`).set('Authorization', `Bearer ${techToken}`).send({ employeeId: emp2EmployeeId }),
    ]);
    const statuses = [a.status, b.status].sort((x, y) => x - y);
    expect(statuses).toEqual([201, 409]);
    expect(a.body.error?.message ?? b.body.error?.message).toContain('No seats left');
  });

  it('returning a seat frees it for reassignment', async () => {
    const licenseId = await createLicense(1);
    const assign = await request(app).post(`/api/v1/licenses/${licenseId}/assignments`).set('Authorization', `Bearer ${techToken}`).send({ employeeId: empEmployeeId });
    const assignmentId = assign.body.data.id;

    const full = await request(app).post(`/api/v1/licenses/${licenseId}/assignments`).set('Authorization', `Bearer ${techToken}`).send({ employeeId: emp2EmployeeId });
    expect(full.status).toBe(409);

    const ret = await request(app).post(`/api/v1/licenses/assignments/${assignmentId}/return`).set('Authorization', `Bearer ${techToken}`).send({ note: 'Offboarded' });
    expect(ret.status).toBe(200);
    expect(ret.body.data.status).toBe('returned');
    expect(ret.body.data.returnedAt).toBeTruthy();

    const freed = await request(app).post(`/api/v1/licenses/${licenseId}/assignments`).set('Authorization', `Bearer ${techToken}`).send({ employeeId: emp2EmployeeId });
    expect(freed.status).toBe(201);

    const detail = await request(app).get(`/api/v1/licenses/${licenseId}`).set('Authorization', `Bearer ${techToken}`);
    expect(detail.body.data.seatsInUse).toBe(1);
    expect(detail.body.data.assignments.length).toBe(2);
  });
});
