import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '../src/app.js';
import { prisma } from '../src/prisma/client.js';

const app = createApp();

const SETUP_TOKEN = 'test-setup-token-0123456789abcdef0123456789abcdef';
const ADMIN = { email: 'admin@test.local', password: 'Sup3rSecret!pass', name: 'Root Admin' };
const EMP = { email: 'emp@test.local', name: 'Employee Person', password: 'Password123abc' };
const IT_ADMIN = { email: 'itadmin@test.local', name: 'IT Admin Person', password: 'Password123abc' };

let adminToken = '';
let empToken = '';
let itAdminToken = '';
let empUserId = '';
let empEmployeeId = '';
let itAdminUserId = '';

async function login(email: string, password: string): Promise<string> {
  const res = await request(app).post('/api/v1/auth/login').send({ email, password });
  return (res.body.data as { accessToken: string }).accessToken;
}

function createUser(token: string, body: Record<string, unknown>) {
  return request(app).post('/api/v1/users').set('Authorization', `Bearer ${token}`).send(body);
}

beforeEach(async () => {
  await request(app).post('/api/v1/auth/bootstrap').send({ setupToken: SETUP_TOKEN, ...ADMIN });
  adminToken = await login(ADMIN.email, ADMIN.password);

  const emp = await createUser(adminToken, { ...EMP, roles: ['employee'] });
  empUserId = emp.body.data.id;
  empEmployeeId = emp.body.data.employee.id;
  const itAdmin = await createUser(adminToken, { ...IT_ADMIN, roles: ['it_admin'] });
  itAdminUserId = itAdmin.body.data.id;

  empToken = await login(EMP.email, EMP.password);
  itAdminToken = await login(IT_ADMIN.email, IT_ADMIN.password);
});

describe('Organization options', () => {
  it('serves pickers to org:manage holders — not to plain employees', async () => {
    // The user-admin options endpoint needs users:manage, which the role that
    // holds org:manage (it_admin) does not have — hence this endpoint.
    const denied = await request(app).get('/api/v1/org/options').set('Authorization', `Bearer ${empToken}`);
    expect(denied.status).toBe(403);

    const allowed = await request(app).get('/api/v1/org/options').set('Authorization', `Bearer ${itAdminToken}`);
    expect(allowed.status).toBe(200);
    expect(Object.keys(allowed.body.data).sort()).toEqual([
      'departments',
      'employees',
      'locations',
      'supportGroups',
      'users',
    ]);
  });

  it('lists only active records and excludes inactive ones', async () => {
    await request(app)
      .post('/api/v1/departments')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Service Desk', code: 'sd' });
    const retired = await request(app)
      .post('/api/v1/departments')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Legacy Ops', code: 'legacy' });
    await request(app)
      .patch(`/api/v1/departments/${retired.body.data.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ active: false });

    const res = await request(app).get('/api/v1/org/options').set('Authorization', `Bearer ${adminToken}`);
    const names = res.body.data.departments.map((d: { name: string }) => d.name);
    expect(names).toContain('Service Desk');
    expect(names).not.toContain('Legacy Ops');

    // Employees carry the employeeId the department manager picker needs.
    expect(res.body.data.employees[0]).toHaveProperty('employeeId');
    expect(res.body.data.users.map((u: { email: string }) => u.email)).toContain(EMP.email);
  });
});

describe('Departments', () => {
  it('creates, uppercases the code, and updates a department', async () => {
    const created = await request(app)
      .post('/api/v1/departments')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Network Operations', code: 'noc', managerId: empEmployeeId });
    expect(created.status).toBe(201);
    expect(created.body.data.code).toBe('NOC');

    const updated = await request(app)
      .patch(`/api/v1/departments/${created.body.data.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Network Ops', timezone: 'Europe/Berlin' });
    expect(updated.status).toBe(200);
    expect(updated.body.data.name).toBe('Network Ops');
    expect(updated.body.data.timezone).toBe('Europe/Berlin');

    const listed = await request(app).get('/api/v1/departments').set('Authorization', `Bearer ${adminToken}`);
    expect(listed.status).toBe(200);
    expect(listed.body.total).toBe(1);
    expect(listed.body.data[0].manager.employeeId).toBeTruthy();
  });

  it('rejects a duplicate code and invalid payloads', async () => {
    await request(app)
      .post('/api/v1/departments')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Service Desk', code: 'SD' });
    const dup = await request(app)
      .post('/api/v1/departments')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Service Desk Two', code: 'sd' });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('DUPLICATE');

    const invalid = await request(app)
      .post('/api/v1/departments')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'x', code: 'y' });
    expect(invalid.status).toBe(400);

    const emptyPatch = await request(app)
      .patch('/api/v1/departments/nonexistent-id')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({});
    expect(emptyPatch.status).toBe(400);
  });

  it('refuses employees outright', async () => {
    const res = await request(app).get('/api/v1/departments').set('Authorization', `Bearer ${empToken}`);
    expect(res.status).toBe(403);
  });

  it('clears optional references when a form sends an empty string', async () => {
    const location = await request(app)
      .post('/api/v1/locations')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Berlin Office', code: 'ber', address: 'Alexanderplatz 1' });
    const group = await request(app)
      .post('/api/v1/groups')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Service Desk', code: 'sd' });

    const created = await request(app)
      .post('/api/v1/departments')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'Network Operations',
        code: 'noc',
        managerId: empEmployeeId,
        officeLocationId: location.body.data.id,
        supportGroupId: group.body.data.id,
      });
    expect(created.status).toBe(201);
    expect(created.body.data.managerId).toBe(empEmployeeId);

    // An empty select must clear the reference, not write '' into the FK.
    const cleared = await request(app)
      .patch(`/api/v1/departments/${created.body.data.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ managerId: '', officeLocationId: '', supportGroupId: '', timezone: '' });
    expect(cleared.status).toBe(200);
    expect(cleared.body.data.managerId).toBeNull();
    expect(cleared.body.data.officeLocationId).toBeNull();
    expect(cleared.body.data.supportGroupId).toBeNull();
    expect(cleared.body.data.timezone).toBe('UTC'); // blank means "leave alone", not "empty"

    const clearedLocation = await request(app)
      .patch(`/api/v1/locations/${location.body.data.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ address: '' });
    expect(clearedLocation.status).toBe(200);
    expect(clearedLocation.body.data.address).toBeNull();
  });
});

describe('Assignment groups', () => {
  it('creates a group with members and keeps membership history on removal', async () => {
    const created = await request(app)
      .post('/api/v1/groups')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'Tier 2 Support',
        code: 'tier2',
        description: 'Escalation queue',
        managerId: itAdminUserId,
        memberIds: [empUserId, itAdminUserId],
      });
    expect(created.status).toBe(201);

    const withMembers = await request(app).get('/api/v1/groups').set('Authorization', `Bearer ${adminToken}`);
    expect(withMembers.body.data[0].members).toHaveLength(2);

    const trimmed = await request(app)
      .patch(`/api/v1/groups/${created.body.data.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ memberIds: [empUserId] });
    expect(trimmed.status).toBe(200);

    const after = await request(app).get('/api/v1/groups').set('Authorization', `Bearer ${adminToken}`);
    expect(after.body.data[0].members).toHaveLength(1);
    expect(after.body.data[0].members[0].user.id).toBe(empUserId);

    // Removal is a soft delete: both rows survive, the removed one carries leftAt.
    const rows = await prisma.assignmentGroupMember.findMany({ where: { groupId: created.body.data.id } });
    expect(rows).toHaveLength(2);
    expect(rows.filter((r) => r.leftAt !== null)).toHaveLength(1);

    // Clearing the manager uses the same empty-string convention as the forms.
    const clearedManager = await request(app)
      .patch(`/api/v1/groups/${created.body.data.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ managerId: '' });
    expect(clearedManager.status).toBe(200);
    expect(clearedManager.body.data.managerId).toBeNull();
  });

  it('empties the roster when every member is removed', async () => {
    const created = await request(app)
      .post('/api/v1/groups')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Tier 2 Support', code: 'tier2', memberIds: [empUserId] });

    const emptied = await request(app)
      .patch(`/api/v1/groups/${created.body.data.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ memberIds: [] });
    expect(emptied.status).toBe(200);

    const listed = await request(app).get('/api/v1/groups').set('Authorization', `Bearer ${adminToken}`);
    expect(listed.body.data[0].members).toHaveLength(0);
  });
});
