import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '../src/app.js';
import { prisma } from '../src/prisma/client.js';

const app = createApp();

const SETUP_TOKEN = 'test-setup-token-0123456789abcdef0123456789abcdef';
const ADMIN = { email: 'admin@test.local', password: 'Sup3rSecret!pass', name: 'Root Admin' };
const TECH = { email: 'tech@test.local', name: 'Tech Person', password: 'Password123abc' };

let adminToken = '';
let techToken = '';

async function login(email: string, password: string): Promise<string> {
  const res = await request(app).post('/api/v1/auth/login').send({ email, password });
  return res.body.data.accessToken;
}

beforeEach(async () => {
  await request(app).post('/api/v1/auth/bootstrap').send({ setupToken: SETUP_TOKEN, ...ADMIN });
  adminToken = await login(ADMIN.email, ADMIN.password);

  await request(app).post('/api/v1/users').set('Authorization', `Bearer ${adminToken}`).send({ ...TECH, roles: ['it_technician'] });
  techToken = await login(TECH.email, TECH.password);
});

let assetA = '';
let assetB = '';

beforeEach(async () => {
  const mk = (name: string, overrides: Record<string, unknown> = {}) =>
    request(app).post('/api/v1/assets').set('Authorization', `Bearer ${adminToken}`).send({ name, ...overrides });

  assetA = (await mk('Audit laptop A')).body.data.id;
  assetB = (await mk('Audit laptop B')).body.data.id;
  const r = await mk('Old printer');
  await request(app).post(`/api/v1/assets/${r.body.data.id}/transition`).set('Authorization', `Bearer ${adminToken}`).send({ status: 'retired' });
});

describe('Audit sessions', () => {
  it('opens with a snapshot of in-scope assets (retired excluded)', async () => {
    const session = await request(app)
      .post('/api/v1/asset-audits')
      .set('Authorization', `Bearer ${techToken}`)
      .send({ name: 'Q4 stocktake', scopeType: 'all' });
    expect(session.status).toBe(201);
    expect(session.body.data.items.length).toBe(2); // A + B, not the retired printer

    const detail = await request(app).get(`/api/v1/asset-audits/${session.body.data.id}`).set('Authorization', `Bearer ${techToken}`);
    expect(detail.body.data.counts).toEqual({ found: 0, missing: 0, unexpected: 0, unchecked: 2 });
  });

  it('marks items found/missing and reports counts', async () => {
    const session = (await request(app).post('/api/v1/asset-audits').set('Authorization', `Bearer ${techToken}`).send({ name: 'Marks run' })).body.data;

    const found = await request(app).post(`/api/v1/asset-audits/${session.id}/items`).set('Authorization', `Bearer ${techToken}`).send({ assetId: assetA, status: 'found' });
    expect(found.status).toBe(200);
    expect(found.body.data.checkedAt).toBeTruthy();

    await request(app).post(`/api/v1/asset-audits/${session.id}/items`).set('Authorization', `Bearer ${techToken}`).send({ assetId: assetB, status: 'missing', note: 'Not on shelf' });

    const detail = await request(app).get(`/api/v1/asset-audits/${session.id}`).set('Authorization', `Bearer ${techToken}`);
    expect(detail.body.data.counts).toEqual({ found: 1, missing: 1, unexpected: 0, unchecked: 0 });
  });

  it('records out-of-scope assets as unexpected', async () => {
    const session = (await request(app).post('/api/v1/asset-audits').set('Authorization', `Bearer ${techToken}`).send({ name: 'Narrow scope', scopeType: 'all' })).body.data;
    // Create an asset AFTER the snapshot — not on the checklist.
    const late = await request(app).post('/api/v1/assets').set('Authorization', `Bearer ${adminToken}`).send({ name: 'Latecomer tablet' });
    const lateId = late.body.data.id;

    const rejected = await request(app).post(`/api/v1/asset-audits/${session.id}/items`).set('Authorization', `Bearer ${techToken}`).send({ assetId: lateId, status: 'found' });
    expect(rejected.status).toBe(400);

    const unexpected = await request(app).post(`/api/v1/asset-audits/${session.id}/items`).set('Authorization', `Bearer ${techToken}`).send({ assetId: lateId, status: 'unexpected' });
    expect(unexpected.status).toBe(200);
    expect(unexpected.body.data.status).toBe('unexpected');
  });

  it('closes a session and freezes marking', async () => {
    const session = (await request(app).post('/api/v1/asset-audits').set('Authorization', `Bearer ${techToken}`).send({ name: 'Short run' })).body.data;
    await request(app).post(`/api/v1/asset-audits/${session.id}/items`).set('Authorization', `Bearer ${techToken}`).send({ assetId: assetA, status: 'found' });

    const closed = await request(app).post(`/api/v1/asset-audits/${session.id}/close`).set('Authorization', `Bearer ${techToken}`);
    expect(closed.status).toBe(200);
    expect(closed.body.data.status).toBe('closed');
    expect(closed.body.data.closedAt).toBeTruthy();
    expect(closed.body.data.counts.unchecked).toBe(1);

    const after = await request(app).post(`/api/v1/asset-audits/${session.id}/items`).set('Authorization', `Bearer ${techToken}`).send({ assetId: assetB, status: 'found' });
    expect(after.status).toBe(409);

    const reclosed = await request(app).post(`/api/v1/asset-audits/${session.id}/close`).set('Authorization', `Bearer ${techToken}`);
    expect(reclosed.status).toBe(400);
  });

  it('lists sessions with counts in the audit log trail', async () => {
    await request(app).post('/api/v1/asset-audits').set('Authorization', `Bearer ${techToken}`).send({ name: 'Run one' });
    const second = (await request(app).post('/api/v1/asset-audits').set('Authorization', `Bearer ${techToken}`).send({ name: 'Run two' })).body.data;
    await request(app).post(`/api/v1/asset-audits/${second.id}/close`).set('Authorization', `Bearer ${techToken}`);

    const open = await request(app).get('/api/v1/asset-audits?status=open').set('Authorization', `Bearer ${techToken}`);
    expect(open.body.data.length).toBe(1);
    expect(open.body.data[0].name).toBe('Run one');

    const logs = await prisma.auditLog.findMany({ where: { targetType: 'asset_audit', action: 'audit.session_closed' } });
    expect(logs.length).toBe(1);
  });
});
