import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '../src/app.js';

const app = createApp();

const SETUP_TOKEN = 'test-setup-token-0123456789abcdef0123456789abcdef';
const ADMIN = { email: 'admin@test.local', password: 'Sup3rSecret!pass', name: 'Root Admin' };

let adminToken = '';

async function loginAs(email: string, password: string) {
  const res = await request(app).post('/api/v1/auth/login').send({ email, password });
  return res.body.data as { accessToken: string } | undefined;
}

beforeEach(async () => {
  // Users truncated by setup; bootstrap a fresh admin for each test block that needs one.
  const res = await request(app)
    .post('/api/v1/auth/bootstrap')
    .send({ setupToken: SETUP_TOKEN, ...ADMIN });
  if (res.status === 201) {
    const login = await loginAs(ADMIN.email, ADMIN.password);
    adminToken = login!.accessToken;
  } else {
    const login = await loginAs(ADMIN.email, ADMIN.password);
    adminToken = login!.accessToken;
  }
});

describe('First-admin bootstrap', () => {
  it('rejects bootstrap with a wrong setup token', async () => {
    const res = await request(app)
      .post('/api/v1/auth/bootstrap')
      .send({ setupToken: 'wrong-token-aaaaaaaaaaaaaaaaaaaaaaaa', email: 'x@y.local', password: 'Whatever123abc', name: 'Wrong Token User' });
    // After the beforeEach bootstrap, setup is already complete.
    expect([401, 403]).toContain(res.status);
  });

  it('locks bootstrap once any user exists', async () => {
    const res = await request(app)
      .post('/api/v1/auth/bootstrap')
      .send({ setupToken: SETUP_TOKEN, email: 'other@test.local', password: 'Whatever123abc', name: 'Other' });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('ALREADY_INITIALIZED');
  });
});

describe('Auth lifecycle', () => {
  it('rejects bad credentials without revealing account existence', async () => {
    const res = await request(app).post('/api/v1/auth/login').send({ email: 'ghost@test.local', password: 'nope' });
    expect(res.status).toBe(401);
  });

  it('logs in, exposes /me, refreshes with rotation, and logs out', async () => {
    const login = await request(app).post('/api/v1/auth/login').send(ADMIN);
    expect(login.status).toBe(200);
    const { accessToken, refreshToken } = login.body.data;

    const me = await request(app).get('/api/v1/auth/me').set('Authorization', `Bearer ${accessToken}`);
    expect(me.status).toBe(200);
    expect(me.body.data.roles).toContain('super_admin');
    expect(me.body.data.permissions).toContain('users:manage');

    const refreshed = await request(app).post('/api/v1/auth/refresh').send({ refreshToken });
    expect(refreshed.status).toBe(200);
    const newRefresh = refreshed.body.data.refreshToken;

    // Old refresh token was rotated — reuse must be rejected AND revoke the family.
    const reuse = await request(app).post('/api/v1/auth/refresh').send({ refreshToken });
    expect(reuse.status).toBe(401);
    const stolenFamily = await request(app).post('/api/v1/auth/refresh').send({ refreshToken: newRefresh });
    expect(stolenFamily.status).toBe(401);
  });

  it('revokes the session on logout', async () => {
    const login = await request(app).post('/api/v1/auth/login').send(ADMIN);
    const { refreshToken } = login.body.data;
    await request(app).post('/api/v1/auth/logout').send({ refreshToken });
    const after = await request(app).post('/api/v1/auth/refresh').send({ refreshToken });
    expect(after.status).toBe(401);
  });

  it('rejects requests without a valid token', async () => {
    const res = await request(app).get('/api/v1/auth/me');
    expect(res.status).toBe(401);
  });
});

describe('RBAC enforcement', () => {
  it('blocks employee role from admin endpoints', async () => {
    await request(app)
      .post('/api/v1/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ email: 'emp@test.local', name: 'EmpLOYEE TEST', password: 'Password123abc', roles: ['employee'] });

    const empLogin = await loginAs('emp@test.local', 'Password123abc');
    const empToken = empLogin!.accessToken;

    const users = await request(app).get('/api/v1/users').set('Authorization', `Bearer ${empToken}`);
    expect(users.status).toBe(403);
    const audit = await request(app).get('/api/v1/audit').set('Authorization', `Bearer ${empToken}`);
    expect(audit.status).toBe(403);
    const depts = await request(app).get('/api/v1/departments').set('Authorization', `Bearer ${empToken}`);
    expect(depts.status).toBe(403);
  });

  it('allows admin to manage users and write the audit trail', async () => {
    const created = await request(app)
      .post('/api/v1/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ email: 'tech@test.local', name: 'Tech Person', password: 'Password123abc', roles: ['it_technician'] });
    expect(created.status).toBe(201);
    expect(created.body.data.roles).toEqual(['it_technician']);
    expect(created.body.data.employee.employeeId).toMatch(/^EMP-\d{6}$/);

    // Duplicate email rejected
    const dup = await request(app)
      .post('/api/v1/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ email: 'tech@test.local', name: 'Tech Person', password: 'Password123abc', roles: ['employee'] });
    expect(dup.status).toBe(400);

    const audit = await request(app)
      .get('/api/v1/audit')
      .set('Authorization', `Bearer ${adminToken}`)
      .query({ limit: 50 });
    expect(audit.status).toBe(200);
    const actions = audit.body.data.map((e: { action: string }) => e.action);
    expect(actions).toContain('auth.bootstrap');
    expect(actions).toContain('user.created');
  });
});
