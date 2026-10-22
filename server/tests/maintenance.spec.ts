import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '../src/app.js';
import { prisma } from '../src/prisma/client.js';

const app = createApp();

const SETUP_TOKEN = 'test-setup-token-0123456789abcdef0123456789abcdef';
const ADMIN = { email: 'admin@test.local', password: 'Sup3rSecret!pass', name: 'Root Admin' };
const EMP = { email: 'emp@test.local', name: 'Employee Person', password: 'Password123abc' };
const TECH = { email: 'tech@test.local', name: 'Tech Person', password: 'Password123abc' };

let adminToken = '';
let empToken = '';
let techToken = '';

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
  await mkUser(TECH, ['it_technician']);

  empToken = await login(EMP.email, EMP.password);
  techToken = await login(TECH.email, TECH.password);
});

let assetId = '';
let vendorId = '';

beforeEach(async () => {
  const asset = await request(app)
    .post('/api/v1/assets')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ name: 'HP LaserJet Pro', category: 'appliance', warrantyExpiry: new Date(Date.now() + 365 * 86400000).toISOString() });
  assetId = asset.body.data.id;

  const vendor = await request(app)
    .post('/api/v1/vendors')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ name: 'PrinterFix Ltd', email: 'service@printerfix.example' });
  vendorId = vendor.body.data.id;
});

describe('Vendors', () => {
  it('creates and lists vendors; blocks employees', async () => {
    const list = await request(app).get('/api/v1/vendors').set('Authorization', `Bearer ${techToken}`);
    expect(list.status).toBe(200);
    expect(list.body.data.length).toBe(1);

    const denied = await request(app).get('/api/v1/vendors').set('Authorization', `Bearer ${empToken}`);
    expect(denied.status).toBe(403);
  });
});

describe('Maintenance schedules', () => {
  it('creates a schedule, completing it logs a record and advances nextDueAt', async () => {
    const schedule = await request(app)
      .post(`/api/v1/assets/${assetId}/schedules`)
      .set('Authorization', `Bearer ${techToken}`)
      .send({ name: 'Quarterly service', intervalDays: 90 });
    expect(schedule.status).toBe(201);
    expect(schedule.body.data.nextDueAt).toBeTruthy();

    const firstDue = new Date(schedule.body.data.nextDueAt).getTime();

    const done = await request(app)
      .post(`/api/v1/assets/schedules/${schedule.body.data.id}/complete`)
      .set('Authorization', `Bearer ${techToken}`)
      .send({ summary: 'Cleaned and calibrated', cost: 45 });
    expect(done.status).toBe(201);
    expect(done.body.data.record.summary).toBe('Cleaned and calibrated');

    const nextDue = new Date(done.body.data.schedule.nextDueAt).getTime();
    expect(nextDue - firstDue).toBe(90 * 86400000);
    expect(done.body.data.schedule.lastCompletedAt).toBeTruthy();

    const audit = await prisma.auditLog.findFirst({ where: { action: 'asset.maintenance_logged', targetId: assetId } });
    expect(audit).toBeTruthy();
  });

  it('rejects completion of an inactive schedule', async () => {
    const schedule = await request(app)
      .post(`/api/v1/assets/${assetId}/schedules`)
      .set('Authorization', `Bearer ${techToken}`)
      .send({ name: 'Old plan', intervalDays: 30 });
    const scheduleId = schedule.body.data.id;
    await prisma.maintenanceSchedule.update({ where: { id: scheduleId }, data: { active: false } });

    const done = await request(app)
      .post(`/api/v1/assets/schedules/${scheduleId}/complete`)
      .set('Authorization', `Bearer ${techToken}`)
      .send({ summary: 'should fail' });
    expect(done.status).toBe(409);
  });
});

describe('Maintenance records (incl. vendor repairs)', () => {
  it('records a vendor repair with cost', async () => {
    const record = await request(app)
      .post(`/api/v1/assets/${assetId}/maintenance`)
      .set('Authorization', `Bearer ${techToken}`)
      .send({ type: 'repair', summary: 'Replaced fuser', cost: 120, vendorId, performedBy: 'J. Ruiz' });
    expect(record.status).toBe(201);
    expect(record.body.data.vendor.id).toBe(vendorId);
    expect(record.body.data.cost).toBe(120);

    const detail = await request(app).get(`/api/v1/assets/${assetId}`).set('Authorization', `Bearer ${techToken}`);
    expect(detail.body.data.maintenanceRecords.length).toBe(1);
    expect(detail.body.data.maintenanceRecords[0].type).toBe('repair');
  });
});

describe('Global maintenance lists', () => {
  it('lists schedules, records, and claims across assets', async () => {
    const schedule = await request(app)
      .post(`/api/v1/assets/${assetId}/schedules`)
      .set('Authorization', `Bearer ${techToken}`)
      .send({ name: 'Global check', intervalDays: 30 });
    await request(app)
      .post(`/api/v1/assets/schedules/${schedule.body.data.id}/complete`)
      .set('Authorization', `Bearer ${techToken}`)
      .send({ summary: 'done once' });
    await request(app)
      .post(`/api/v1/assets/${assetId}/maintenance`)
      .set('Authorization', `Bearer ${techToken}`)
      .send({ type: 'repair', summary: 'Standalone fix' });
    await request(app)
      .post(`/api/v1/assets/${assetId}/warranty-claims`)
      .set('Authorization', `Bearer ${techToken}`)
      .send({ issue: 'Something broke' });

    const schedules = await request(app).get('/api/v1/assets/maintenance/schedules').set('Authorization', `Bearer ${techToken}`);
    expect(schedules.status).toBe(200);
    expect(schedules.body.data.length).toBeGreaterThanOrEqual(1);
    expect(schedules.body.data[0].asset.number).toMatch(/^AST-/);

    const dueSoon = await request(app).get('/api/v1/assets/maintenance/schedules?dueWithinDays=60').set('Authorization', `Bearer ${techToken}`);
    expect(dueSoon.status).toBe(200);
    expect(dueSoon.body.data.length).toBeGreaterThanOrEqual(1);

    const records = await request(app).get('/api/v1/assets/maintenance/records').set('Authorization', `Bearer ${techToken}`);
    expect(records.body.data.length).toBe(2);

    const claims = await request(app).get('/api/v1/assets/warranty-claims?status=open').set('Authorization', `Bearer ${techToken}`);
    expect(claims.body.data.length).toBe(1);
    expect(claims.body.data[0].asset.number).toMatch(/^AST-/);
  });
});

describe('Warranty claims', () => {
  it('follows the claim state machine and requires a resolution to resolve', async () => {
    const claim = await request(app)
      .post(`/api/v1/assets/${assetId}/warranty-claims`)
      .set('Authorization', `Bearer ${techToken}`)
      .send({ issue: 'Paper feeder jams repeatedly', vendorId });
    expect(claim.status).toBe(201);
    const claimId = claim.body.data.id;

    // open → resolved directly is allowed, but requires a resolution note.
    const noNote = await request(app)
      .patch(`/api/v1/assets/warranty-claims/${claimId}`)
      .set('Authorization', `Bearer ${techToken}`)
      .send({ status: 'resolved' });
    expect(noNote.status).toBe(400);

    const resolved = await request(app)
      .patch(`/api/v1/assets/warranty-claims/${claimId}`)
      .set('Authorization', `Bearer ${techToken}`)
      .send({ status: 'resolved', resolution: 'Feeder assembly replaced under warranty' });
    expect(resolved.status).toBe(200);
    expect(resolved.body.data.status).toBe('resolved');
    expect(resolved.body.data.resolvedAt).toBeTruthy();

    // Terminal state: no further moves.
    const reopen = await request(app)
      .patch(`/api/v1/assets/warranty-claims/${claimId}`)
      .set('Authorization', `Bearer ${techToken}`)
      .send({ status: 'submitted' });
    expect(reopen.status).toBe(400);
  });

  it('blocks illegal jumps like submitted → open', async () => {
    const claim = await request(app)
      .post(`/api/v1/assets/${assetId}/warranty-claims`)
      .set('Authorization', `Bearer ${techToken}`)
      .send({ issue: 'Loud grinding noise' });
    const claimId = claim.body.data.id;

    await request(app)
      .patch(`/api/v1/assets/warranty-claims/${claimId}`)
      .set('Authorization', `Bearer ${techToken}`)
      .send({ status: 'submitted' });
    const back = await request(app)
      .patch(`/api/v1/assets/warranty-claims/${claimId}`)
      .set('Authorization', `Bearer ${techToken}`)
      .send({ status: 'open' });
    expect(back.status).toBe(400);
  });
});
