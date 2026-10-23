import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '../src/app.js';

const app = createApp();

const SETUP_TOKEN = 'test-setup-token-0123456789abcdef0123456789abcdef';
const ADMIN = { email: 'admin@test.local', password: 'Sup3rSecret!pass', name: 'Root Admin' };
const MANAGER = { email: 'manager@test.local', name: 'Manager Person', password: 'Password123abc' };
const EMP = { email: 'emp@test.local', name: 'Employee Person', password: 'Password123abc' };

let adminToken = '';
let managerEmployeeId = '';
let empId = '';

async function login(email: string, password: string): Promise<string> {
  const res = await request(app).post('/api/v1/auth/login').send({ email, password });
  return (res.body.data as { accessToken: string }).accessToken;
}

function createUser(body: Record<string, unknown>) {
  return request(app).post('/api/v1/users').set('Authorization', `Bearer ${adminToken}`).send(body);
}

beforeEach(async () => {
  await request(app).post('/api/v1/auth/bootstrap').send({ setupToken: SETUP_TOKEN, ...ADMIN });
  adminToken = await login(ADMIN.email, ADMIN.password);

  const manager = await createUser({ ...MANAGER, roles: ['it_manager'] });
  managerEmployeeId = manager.body.data.employee.id;
  const emp = await createUser({ ...EMP, roles: ['employee'] });
  empId = emp.body.data.id;
});

describe('User administration', () => {
  it('exposes managerId in the list so the edit form can prefill it', async () => {
    const updated = await request(app)
      .patch(`/api/v1/users/${empId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ managerEmployeeId });
    expect(updated.status).toBe(200);

    const list = await request(app).get('/api/v1/users').set('Authorization', `Bearer ${adminToken}`);
    const emp = list.body.data.find((u: { email: string }) => u.email === EMP.email);
    expect(emp.employee.managerId).toBe(managerEmployeeId);
  });

  it('clears optional references when a form sends an empty string', async () => {
    await request(app)
      .post('/api/v1/departments')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Service Desk', code: 'SD' });
    const dept = await request(app).get('/api/v1/departments').set('Authorization', `Bearer ${adminToken}`);
    const departmentId = dept.body.data[0].id;

    const set = await request(app)
      .patch(`/api/v1/users/${empId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ jobTitle: 'Analyst', departmentId, managerEmployeeId });
    expect(set.status).toBe(200);
    expect(set.body.data.employee.departmentId).toBe(departmentId);

    // An empty select must clear the reference, not write '' into the FK.
    const cleared = await request(app)
      .patch(`/api/v1/users/${empId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ jobTitle: '', departmentId: '', locationId: '', managerEmployeeId: '' });
    expect(cleared.status).toBe(200);
    expect(cleared.body.data.employee.departmentId).toBeNull();
    expect(cleared.body.data.employee.locationId).toBeNull();
    expect(cleared.body.data.employee.jobTitle).toBeNull();
  });

  it('refuses to deactivate your own account', async () => {
    const me = await request(app).get('/api/v1/auth/me').set('Authorization', `Bearer ${adminToken}`);
    const res = await request(app)
      .patch(`/api/v1/users/${me.body.data.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ active: false });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('SELF_DEACTIVATION');
  });

  it('revokes live sessions when an account is deactivated', async () => {
    const empLogin = await request(app).post('/api/v1/auth/login').send(EMP);
    const { refreshToken } = empLogin.body.data;

    const off = await request(app)
      .patch(`/api/v1/users/${empId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ active: false });
    expect(off.status).toBe(200);
    expect(off.body.data.active).toBe(false);

    const reuse = await request(app).post('/api/v1/auth/refresh').send({ refreshToken });
    expect(reuse.status).toBe(401);

    // Disabled accounts are refused with a distinct code, not "bad credentials".
    const relogin = await request(app).post('/api/v1/auth/login').send(EMP);
    expect(relogin.status).toBe(403);
    expect(relogin.body.error.code).toBe('ACCOUNT_DISABLED');
  });

  it('resets a password, revoking sessions and auditing the change', async () => {
    const empLogin = await request(app).post('/api/v1/auth/login').send(EMP);
    const { refreshToken } = empLogin.body.data;

    const short = await request(app)
      .post(`/api/v1/users/${empId}/password`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ newPassword: 'short' });
    expect(short.status).toBe(400);

    const reset = await request(app)
      .post(`/api/v1/users/${empId}/password`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ newPassword: 'BrandNewPass123' });
    expect(reset.status).toBe(204);

    const stale = await request(app).post('/api/v1/auth/refresh').send({ refreshToken });
    expect(stale.status).toBe(401);

    const relogin = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: EMP.email, password: 'BrandNewPass123' });
    expect(relogin.status).toBe(200);

    const audit = await request(app).get('/api/v1/audit').set('Authorization', `Bearer ${adminToken}`).query({ limit: 50 });
    expect(audit.body.data.map((e: { action: string }) => e.action)).toContain('user.password_reset');
  });

  it('rejects a user with no roles', async () => {
    const res = await createUser({ email: 'noroles@test.local', name: 'No Roles', password: 'Password123abc', roles: [] });
    expect(res.status).toBe(400);
  });
});
