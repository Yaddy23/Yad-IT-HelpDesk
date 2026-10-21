import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '../src/app.js';

const app = createApp();

const SETUP_TOKEN = 'test-setup-token-0123456789abcdef0123456789abcdef';
const ADMIN = { email: 'admin@test.local', password: 'Sup3rSecret!pass', name: 'Root Admin' };
const EMP = { email: 'emp@test.local', name: 'Employee Person', password: 'Password123abc' };

let adminToken = '';
let empToken = '';

interface LoginData {
  accessToken: string;
}

async function login(email: string, password: string): Promise<string> {
  const res = await request(app).post('/api/v1/auth/login').send({ email, password });
  return (res.body.data as LoginData).accessToken;
}

beforeEach(async () => {
  await request(app).post('/api/v1/auth/bootstrap').send({ setupToken: SETUP_TOKEN, ...ADMIN });
  adminToken = await login(ADMIN.email, ADMIN.password);
  await request(app)
    .post('/api/v1/users')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ ...EMP, roles: ['employee'] });
  empToken = await login(EMP.email, EMP.password);
});

async function createTicketAs(
  token: string,
  title: string,
  description = 'A shared boilerplate description body.',
): Promise<string> {
  const res = await request(app)
    .post('/api/v1/tickets')
    .set('Authorization', `Bearer ${token}`)
    .send({ title, description, category: 'hardware', impact: 'low', urgency: 'low' });
  return res.body.data.id as string;
}

describe('Global search — record-level authorization', () => {
  it('returns only the searcher’s own tickets for an employee', async () => {
    await createTicketAs(empToken, 'VPN will not connect at all');
    await createTicketAs(adminToken, 'VPN drops every hour for me too');

    const res = await request(app)
      .get('/api/v1/search')
      .query({ q: 'vpn' })
      .set('Authorization', `Bearer ${empToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.tickets).toHaveLength(1);
    expect(res.body.data.tickets[0].title).toContain('VPN');
    expect(res.body.data.people).toEqual([]); // no users:manage
  });

  it('shows everything to global roles and includes people results', async () => {
    await createTicketAs(empToken, 'Keyboard missing keys entirely');
    await createTicketAs(adminToken, 'Monitor flickers after wake');

    const res = await request(app)
      .get('/api/v1/search')
      .query({ q: 'keyboard' })
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.tickets).toHaveLength(1);

    const people = await request(app)
      .get('/api/v1/search')
      .query({ q: 'employee person' })
      .set('Authorization', `Bearer ${adminToken}`);
    expect(people.status).toBe(200);
    expect(people.body.data.people.map((p: { email: string }) => p.email)).toContain('emp@test.local');
  });

  it('clips direct-number lookups to scope (foreign ticket number → empty)', async () => {
    const foreignId = await createTicketAs(adminToken, 'Secret server room is flooded');
    const detail = await request(app).get(`/api/v1/tickets/${foreignId}`).set('Authorization', `Bearer ${adminToken}`);
    const foreignNumber = detail.body.data.number as string;

    const res = await request(app)
      .get('/api/v1/search')
      .query({ q: foreignNumber })
      .set('Authorization', `Bearer ${empToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.tickets).toHaveLength(0);
  });

  it('matches on description text within scope', async () => {
    await createTicketAs(empToken, 'Printer acting up again', 'The third floor printer jams on duplex jobs.');

    const res = await request(app)
      .get('/api/v1/search')
      .query({ q: 'duplex' })
      .set('Authorization', `Bearer ${empToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.tickets).toHaveLength(1);
  });

  it('rejects short or missing queries', async () => {
    const short = await request(app).get('/api/v1/search').query({ q: 'a' }).set('Authorization', `Bearer ${empToken}`);
    expect(short.status).toBe(400);

    const missing = await request(app).get('/api/v1/search').set('Authorization', `Bearer ${empToken}`);
    expect(missing.status).toBe(400);
  });

  it('requires authentication', async () => {
    const res = await request(app).get('/api/v1/search').query({ q: 'anything' });
    expect(res.status).toBe(401);
  });
});
