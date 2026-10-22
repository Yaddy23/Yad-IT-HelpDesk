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

let itemId = '';

beforeEach(async () => {
  const item = await request(app)
    .post('/api/v1/inventory')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ name: 'USB-C cables', sku: 'CBL-USBC-2M', unit: 'pcs', reorderPoint: 10, initialQuantity: 25 });
  expect(item.status).toBe(201);
  itemId = item.body.data.id;
});

describe('Inventory items', () => {
  it('creates with initial stock ledgered as an "in" movement; lists with filters', async () => {
    const detail = await request(app).get('/api/v1/inventory').set('Authorization', `Bearer ${techToken}`);
    expect(detail.status).toBe(200);
    expect(detail.body.data.length).toBe(1);
    expect(detail.body.data[0].quantity).toBe(25);

    const movements = await prisma.stockMovement.findMany({ where: { itemId } });
    expect(movements.length).toBe(1);
    expect(movements[0].type).toBe('in');
    expect(movements[0].delta).toBe(25);
    expect(movements[0].resultingQuantity).toBe(25);

    const filtered = await request(app).get('/api/v1/inventory?q=USBC').set('Authorization', `Bearer ${techToken}`);
    expect(filtered.body.data.length).toBe(1);
    const missing = await request(app).get('/api/v1/inventory?q=monitor').set('Authorization', `Bearer ${techToken}`);
    expect(missing.body.data.length).toBe(0);
  });

  it('blocks employees from creating items', async () => {
    const denied = await request(app).post('/api/v1/inventory').set('Authorization', `Bearer ${empToken}`).send({ name: 'Stickers' });
    expect(denied.status).toBe(403);
  });

  it('edits metadata but not the quantity field', async () => {
    const patched = await request(app)
      .patch(`/api/v1/inventory/${itemId}`)
      .set('Authorization', `Bearer ${techToken}`)
      .send({ reorderPoint: 15 });
    expect(patched.status).toBe(200);
    expect(patched.body.data.reorderPoint).toBe(15);

    const forced = await request(app)
      .patch(`/api/v1/inventory/${itemId}`)
      .set('Authorization', `Bearer ${techToken}`)
      .send({ quantity: 999 });
    expect(forced.status).toBe(400);
    const after = await prisma.inventoryItem.findUnique({ where: { id: itemId } });
    expect(after?.quantity).toBe(25);
  });
});

describe('Stock movements', () => {
  it('moves stock in/out with a full ledger trail', async () => {
    const out = await request(app)
      .post(`/api/v1/inventory/${itemId}/movements`)
      .set('Authorization', `Bearer ${techToken}`)
      .send({ type: 'out', delta: 5, reason: 'Issued to helpdesk' });
    expect(out.status).toBe(201);
    expect(out.body.data.delta).toBe(-5);
    expect(out.body.data.resultingQuantity).toBe(20);

    const back = await request(app)
      .post(`/api/v1/inventory/${itemId}/movements`)
      .set('Authorization', `Bearer ${techToken}`)
      .send({ type: 'in', delta: 8, reason: 'Restock' });
    expect(back.body.data.resultingQuantity).toBe(28);

    const ledger = await request(app).get(`/api/v1/inventory/${itemId}/movements`).set('Authorization', `Bearer ${techToken}`);
    expect(ledger.body.data.length).toBe(3); // initial + out + in
    const levels = ledger.body.data.map((m: { resultingQuantity: number }) => m.resultingQuantity).sort((a: number, b: number) => b - a);
    expect(levels).toEqual([28, 25, 20]);
  });

  it('guards against negative stock with a 409', async () => {
    const denied = await request(app)
      .post(`/api/v1/inventory/${itemId}/movements`)
      .set('Authorization', `Bearer ${techToken}`)
      .send({ type: 'out', delta: 100, reason: 'Oversell' });
    expect(denied.status).toBe(409);

    const after = await prisma.inventoryItem.findUnique({ where: { id: itemId } });
    expect(after?.quantity).toBe(25);
    const ledger = await prisma.stockMovement.findMany({ where: { itemId } });
    expect(ledger.length).toBe(1); // failed movement left no trace
  });

  it('adjust sets the level and computes the signed delta', async () => {
    const adjust = await request(app)
      .post(`/api/v1/inventory/${itemId}/movements`)
      .set('Authorization', `Bearer ${techToken}`)
      .send({ type: 'adjust', resultingQuantity: 30, reason: 'Annual count' });
    expect(adjust.status).toBe(201);
    expect(adjust.body.data.delta).toBe(5);
    expect(adjust.body.data.resultingQuantity).toBe(30);
  });

  it('notifies IT admins/managers when stock drops to the reorder point', async () => {
    // Low-stock alerts target it_manager/it_admin (not super_admin) — make a recipient.
    await request(app).post('/api/v1/users').set('Authorization', `Bearer ${adminToken}`).send({
      email: 'manager@test.local',
      name: 'Manager Person',
      password: 'Password123abc',
      roles: ['it_admin'],
    });

    await request(app)
      .post(`/api/v1/inventory/${itemId}/movements`)
      .set('Authorization', `Bearer ${techToken}`)
      .send({ type: 'out', delta: 15, reason: 'Big issue' }); // 25 → 10 = reorder point

    const notes = await prisma.notification.findMany({ where: { type: 'inventory_low_stock' } });
    expect(notes.length).toBe(1);
    expect(notes[0].body).toContain('USB-C cables');
  });
});
