import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '../src/app.js';
import { prisma } from '../src/prisma/client.js';

const app = createApp();

const SETUP_TOKEN = 'test-setup-token-0123456789abcdef0123456789abcdef';
const ADMIN = { email: 'admin@test.local', password: 'Sup3rSecret!pass', name: 'Root Admin' };
const MGR = { email: 'mgr@test.local', name: 'Manager Person', password: 'Password123abc' };
const EMP = { email: 'emp@test.local', name: 'Employee Person', password: 'Password123abc' };
const APR1 = { email: 'apr1@test.local', name: 'Approver One', password: 'Password123abc' };
const APR2 = { email: 'apr2@test.local', name: 'Approver Two', password: 'Password123abc' };

let adminToken = '';
let mgrToken = '';
let empToken = '';
let apr1Token = '';
let apr2Token = '';
let mgrUserId = '';
let mgrEmployeeId = '';
let apr1Id = '';
let apr2Id = '';

async function login(email: string, password: string): Promise<string> {
  const res = await request(app).post('/api/v1/auth/login').send({ email, password });
  return res.body.data.accessToken;
}

beforeEach(async () => {
  await request(app).post('/api/v1/auth/bootstrap').send({ setupToken: SETUP_TOKEN, ...ADMIN });
  adminToken = await login(ADMIN.email, ADMIN.password);

  const mkUser = (body: Record<string, unknown>, roles: string[]) =>
    request(app).post('/api/v1/users').set('Authorization', `Bearer ${adminToken}`).send({ ...body, roles });

  const mgr = await mkUser(MGR, ['it_manager']);
  mgrUserId = mgr.body.data.id;
  mgrEmployeeId = mgr.body.data.employee.id;
  await mkUser({ ...EMP, managerEmployeeId: mgrEmployeeId }, ['employee']);
  const apr1 = await mkUser(APR1, ['approver']);
  const apr2 = await mkUser(APR2, ['approver']);
  apr1Id = apr1.body.data.id;
  apr2Id = apr2.body.data.id;

  mgrToken = await login(MGR.email, MGR.password);
  empToken = await login(EMP.email, EMP.password);
  apr1Token = await login(APR1.email, APR1.password);
  apr2Token = await login(APR2.email, APR2.password);
});

/* ── Helpers ──────────────────────────────────────────────────────────────── */

const LAPTOP_FORM = [
  { name: 'device', label: 'Device type', type: 'select', required: true, options: ['Laptop', 'Desktop'] },
  { name: 'justification', label: 'Business justification', type: 'textarea', required: true },
  { name: 'neededBy', label: 'Needed by', type: 'date', required: false },
];

const SIMPLE_FORM = [{ name: 'notes', label: 'Notes', type: 'text', required: false }];

async function seedCatalog(overrides: Record<string, unknown> = {}) {
  const res = await request(app)
    .post('/api/v1/catalog')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ name: 'New laptop', description: 'Standard laptop', formSchema: LAPTOP_FORM, ...overrides });
  expect(res.status).toBe(201);
  return res.body.data as { id: string; name: string };
}

async function seedRule(itemId: string, steps: unknown[], name = 'Approval rule') {
  const res = await request(app)
    .put(`/api/v1/catalog/${itemId}/rule`)
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ name, steps, active: true });
  expect(res.status).toBe(200);
  return res.body.data as { id: string };
}

/** Standard one-manager rule on a laptop item. */
async function seedLaptopWithManagerRule() {
  const item = await seedCatalog();
  await seedRule(item.id, [{ name: 'Manager sign-off', mode: 'single', approver: { type: 'manager' } }]);
  return item;
}

async function submitAs(token: string, catalogItemId: string, answers: Record<string, unknown> = {}) {
  return request(app)
    .post('/api/v1/service-requests')
    .set('Authorization', `Bearer ${token}`)
    .send({ catalogItemId, answers });
}

const GOOD_ANSWERS = { device: 'Laptop', justification: 'Starting at the client site next month.' };

async function submitLaptop(): Promise<{ id: string; number: string; status: string; approvalRequestId: string | null }> {
  const item = await seedLaptopWithManagerRule();
  const res = await submitAs(empToken, item.id, GOOD_ANSWERS);
  expect(res.status).toBe(201);
  const data = res.body.data;
  return { id: data.id, number: data.number, status: data.status, approvalRequestId: data.approvalRequestId };
}

async function queueAs(token: string) {
  const res = await request(app).get('/api/v1/approvals/queue').set('Authorization', `Bearer ${token}`);
  expect(res.status).toBe(200);
  return res.body.data as Array<{ id: string; stepIndex: number; stepName: string; target: { id: string; number: string } | null }>;
}

async function decideAs(token: string, approvalId: string, body: Record<string, unknown>) {
  return request(app).post(`/api/v1/approvals/${approvalId}/decide`).set('Authorization', `Bearer ${token}`).send(body);
}

async function requestStatus(id: string): Promise<string> {
  const row = await prisma.serviceRequest.findUniqueOrThrow({ where: { id }, select: { status: true } });
  return row.status;
}

/* ── Catalog ──────────────────────────────────────────────────────────────── */

describe('Service catalog', () => {
  it('lets admin manage the catalog and hides inactive items from employees', async () => {
    // Employee cannot create.
    const forbidden = await request(app)
      .post('/api/v1/catalog')
      .set('Authorization', `Bearer ${empToken}`)
      .send({ name: 'Sneaky item', formSchema: SIMPLE_FORM });
    expect(forbidden.status).toBe(403);

    const item = await seedCatalog({ name: 'Monitor' });
    // Select field with no options is rejected.
    const badSelect = await request(app)
      .post('/api/v1/catalog')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Bad select', formSchema: [{ name: 'choice', label: 'Choice', type: 'select', required: true }] });
    expect(badSelect.status).toBe(400);

    // Deactivate it, then verify employees no longer see it.
    const patch = await request(app)
      .patch(`/api/v1/catalog/${item.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ active: false });
    expect(patch.status).toBe(200);

    const empList = await request(app).get('/api/v1/catalog').set('Authorization', `Bearer ${empToken}`);
    expect(empList.status).toBe(200);
    expect(empList.body.data.some((i: { id: string }) => i.id === item.id)).toBe(false);

    const adminList = await request(app).get('/api/v1/catalog').set('Authorization', `Bearer ${adminToken}`);
    expect(adminList.body.data.some((i: { id: string }) => i.id === item.id)).toBe(true);
  });

  it('rejects invalid approval rules and invalid form schemas', async () => {
    const item = await seedCatalog();

    const emptySteps = await request(app)
      .put(`/api/v1/catalog/${item.id}/rule`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ steps: [] });
    expect(emptySteps.status).toBe(400);

    const noValue = await request(app)
      .put(`/api/v1/catalog/${item.id}/rule`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ steps: [{ name: 'S', mode: 'single', approver: { type: 'user' } }] });
    expect(noValue.status).toBe(400);

    // Duplicate form field names.
    const dup = await request(app)
      .post('/api/v1/catalog')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'Dup fields',
        formSchema: [
          { name: 'a', label: 'A', type: 'text' },
          { name: 'a', label: 'A again', type: 'text' },
        ],
      });
    expect(dup.status).toBe(400);
  });
});

/* ── Submission ───────────────────────────────────────────────────────────── */

describe('Service request submission', () => {
  it('creates SR numbers; no rule means immediate fulfillment; fulfill completes it', async () => {
    const item = await seedCatalog({ name: 'Simple service', formSchema: SIMPLE_FORM });
    const res = await submitAs(empToken, item.id, { notes: 'pls' });
    expect(res.status).toBe(201);
    const created = res.body.data;
    expect(created.number).toMatch(/^SR-\d{4}-\d{6}$/);
    expect(created.status).toBe('in_fulfillment');
    expect(created.approvalRequestId).toBeNull();

    const fulfill = await request(app)
      .post(`/api/v1/service-requests/${created.id}/fulfill`)
      .set('Authorization', `Bearer ${mgrToken}`)
      .send({ note: 'Delivered' });
    expect(fulfill.status).toBe(200);
    expect(fulfill.body.data.status).toBe('fulfilled');

    // Second fulfill is a conflict.
    const again = await request(app)
      .post(`/api/v1/service-requests/${created.id}/fulfill`)
      .set('Authorization', `Bearer ${mgrToken}`)
      .send({});
    expect(again.status).toBe(409);
  });

  it('rejects invalid, unknown and malformed answers', async () => {
    const item = await seedCatalog();

    const missingRequired = await submitAs(empToken, item.id, { device: 'Laptop' });
    expect(missingRequired.status).toBe(400);
    expect(missingRequired.body.error.code).toBe('INVALID_ANSWERS');
    expect(missingRequired.body.error.message).toContain('justification');

    const unknownField = await submitAs(empToken, item.id, { ...GOOD_ANSWERS, hack: 'inject' });
    expect(unknownField.status).toBe(400);
    expect(unknownField.body.error.message).toContain('hack');

    const badSelect = await submitAs(empToken, item.id, { ...GOOD_ANSWERS, device: 'Mainframe' });
    expect(badSelect.status).toBe(400);
    expect(badSelect.body.error.message).toContain('device');

    // Missing catalog item.
    const noItem = await submitAs(empToken, 'nonexistent', GOOD_ANSWERS);
    expect(noItem.status).toBe(404);
  });

  it('enforces eligibility (403 when the requester does not match)', async () => {
    const item = await seedCatalog({ eligibility: { roles: ['it_admin'] } });
    const res = await submitAs(empToken, item.id, GOOD_ANSWERS);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('NOT_ELIGIBLE');
  });
});

/* ── Approval engine ──────────────────────────────────────────────────────── */

describe('Approval engine', () => {
  it('routes to the manager, blocks non-approvers and self-approval, then fulfills on approval', async () => {
    const sr = await submitLaptop();
    expect(sr.status).toBe('pending_approval');
    expect(sr.number).toMatch(/^SR-\d{4}-\d{6}$/);

    // Employees do not have the approvals queue.
    const empQueue = await request(app).get('/api/v1/approvals/queue').set('Authorization', `Bearer ${empToken}`);
    expect(empQueue.status).toBe(403);

    const mgrQueue = await queueAs(mgrToken);
    const entry = mgrQueue.find((q) => q.target?.id === sr.id);
    expect(entry).toBeDefined();
    const approvalId = entry!.id;

    // Back to the first request: wrong step index is rejected (while still open).
    const wrongStep = await decideAs(mgrToken, approvalId, { stepIndex: 5, decision: 'approved' });
    expect(wrongStep.status).toBe(400);

    // The candidate can act — but hold: settle this later; first the SoD checks.
    // (The approve below settles the approval; the wrong-step check above needed it open.)

    // Rebuild a fresh request for the SoD check: MGR submits, rule wants MGR as user-approver.
    const item2 = await seedCatalog({ name: 'SoD item' });
    await seedRule(item2.id, [{ name: 'Mgr gate', mode: 'single', approver: { type: 'user', value: mgrUserId } }]);
    const res2 = await submitAs(mgrToken, item2.id, GOOD_ANSWERS);
    expect(res2.status).toBe(201);
    const sod = await decideAs(mgrToken, res2.body.data.approvalRequestId, { stepIndex: 0, decision: 'approved' });
    expect(sod.status).toBe(403);
    expect(sod.body.error.code).toBe('SELF_APPROVAL');

    // An approvals:decide holder who is not a candidate is still blocked.
    const item3 = await seedCatalog({ name: 'Not approver item' });
    await seedRule(item3.id, [{ name: 'Mgr gate', mode: 'single', approver: { type: 'user', value: mgrUserId } }]);
    const res3 = await submitAs(empToken, item3.id, GOOD_ANSWERS);
    const notCandidate = await decideAs(apr1Token, res3.body.data.approvalRequestId, { stepIndex: 0, decision: 'approved' });
    expect(notCandidate.status).toBe(403);

    // Manager approves → in_fulfillment. Fulfill only from in_fulfillment.
    const pending = await submitLaptop();
    const pendingQueue = await queueAs(mgrToken);
    const pendingEntry = pendingQueue.find((q) => q.target?.id === pending.id)!;
    const earlyFulfill = await request(app)
      .post(`/api/v1/service-requests/${pending.id}/fulfill`)
      .set('Authorization', `Bearer ${mgrToken}`)
      .send({});
    expect(earlyFulfill.status).toBe(409);
    expect(earlyFulfill.body.error.code).toBe('NOT_IN_FULFILLMENT');

    const approve = await decideAs(mgrToken, pendingEntry.id, { stepIndex: 0, decision: 'approved' });
    expect(approve.status).toBe(200);
    expect(await requestStatus(pending.id)).toBe('in_fulfillment');

    // Approving again on the settled approval is a conflict.
    const reDecide = await decideAs(mgrToken, pendingEntry.id, { stepIndex: 0, decision: 'approved' });
    expect(reDecide.status).toBe(409);

    const fulfill = await request(app)
      .post(`/api/v1/service-requests/${pending.id}/fulfill`)
      .set('Authorization', `Bearer ${mgrToken}`)
      .send({ note: 'Shipped' });
    expect(fulfill.status).toBe(200);
    expect(fulfill.body.data.status).toBe('fulfilled');
  });

  it('rejects settle the request with the given reason; rejection without a reason is refused', async () => {
    const sr = await submitLaptop();
    const entry = (await queueAs(mgrToken)).find((q) => q.target?.id === sr.id)!;

    const noReason = await decideAs(mgrToken, entry.id, { stepIndex: 0, decision: 'rejected' });
    expect(noReason.status).toBe(400);
    expect(noReason.body.error.code).toBe('REASON_REQUIRED');

    const reject = await decideAs(mgrToken, entry.id, { stepIndex: 0, decision: 'rejected', reason: 'Not within budget' });
    expect(reject.status).toBe(200);
    const row = await prisma.serviceRequest.findUniqueOrThrow({ where: { id: sr.id } });
    expect(row.status).toBe('rejected');
    expect(row.rejectionReason).toBe('Not within budget');
    const approval = await prisma.approvalRequest.findUniqueOrThrow({ where: { id: entry.id } });
    expect(approval.status).toBe('rejected');
  });

  it('all-mode requires every candidate to approve before fulfillment', async () => {
    const item = await seedCatalog({ name: 'Panel item' });
    await seedRule(item.id, [{ name: 'Panel review', mode: 'all', approver: { type: 'role', value: 'approver' } }]);
    const res = await submitAs(empToken, item.id, GOOD_ANSWERS);
    expect(res.status).toBe(201);
    const approvalId = res.body.data.approvalRequestId;

    const first = await decideAs(apr1Token, approvalId, { stepIndex: 0, decision: 'approved' });
    expect(first.status).toBe(200);
    expect(await requestStatus(res.body.data.id)).toBe('pending_approval');

    // Second approval by the same candidate is impossible; the other one completes it.
    const second = await decideAs(apr2Token, approvalId, { stepIndex: 0, decision: 'approved' });
    expect(second.status).toBe(200);
    expect(await requestStatus(res.body.data.id)).toBe('in_fulfillment');
  });

  it('sequential mode enforces the candidate order', async () => {
    const item = await seedCatalog({ name: 'Chain item' });
    await seedRule(item.id, [{ name: 'Chain', mode: 'sequential', approver: { type: 'role', value: 'approver' } }]);
    const res = await submitAs(empToken, item.id, GOOD_ANSWERS);
    expect(res.status).toBe(201);
    const approvalId = res.body.data.approvalRequestId;

    // Candidate order is resolved at submission — read it back.
    const approval = await prisma.approvalRequest.findUniqueOrThrow({ where: { id: approvalId } });
    const steps = approval.steps as Array<{ candidates: string[] }>;
    const [firstId, secondId] = steps[0].candidates;
    const firstToken = firstId === apr1Id ? apr1Token : apr2Token;
    const secondToken = secondId === apr2Id ? apr2Token : apr1Token;

    // The second candidate cannot jump the queue.
    const jump = await decideAs(secondToken, approvalId, { stepIndex: 0, decision: 'approved' });
    expect(jump.status).toBe(400);

    const first = await decideAs(firstToken, approvalId, { stepIndex: 0, decision: 'approved' });
    expect(first.status).toBe(200);
    expect(await requestStatus(res.body.data.id)).toBe('pending_approval');

    const second = await decideAs(secondToken, approvalId, { stepIndex: 0, decision: 'approved' });
    expect(second.status).toBe(200);
    expect(await requestStatus(res.body.data.id)).toBe('in_fulfillment');
  });

  it('info_requested pauses the request; the requester answers and the same approver decides again', async () => {
    const sr = await submitLaptop();
    const entry = (await queueAs(mgrToken)).find((q) => q.target?.id === sr.id)!;

    const info = await decideAs(mgrToken, entry.id, {
      stepIndex: 0,
      decision: 'info_requested',
      reason: 'What model do you need?',
    });
    expect(info.status).toBe(200);
    expect(await requestStatus(sr.id)).toBe('info_requested');

    // Only the requester can add info.
    const notRequester = await request(app)
      .post(`/api/v1/service-requests/${sr.id}/info`)
      .set('Authorization', `Bearer ${apr1Token}`)
      .send({ note: 'wrong person' });
    expect(notRequester.status).toBe(404);

    const answer = await request(app)
      .post(`/api/v1/service-requests/${sr.id}/info`)
      .set('Authorization', `Bearer ${empToken}`)
      .send({ note: 'A 14-inch business laptop.' });
    expect(answer.status).toBe(200);
    expect(await requestStatus(sr.id)).toBe('pending_approval');

    // Same approver, same step, terminal decision now — the info round is history.
    const approve = await decideAs(mgrToken, entry.id, { stepIndex: 0, decision: 'approved' });
    expect(approve.status).toBe(200);
    expect(await requestStatus(sr.id)).toBe('in_fulfillment');

    const decisions = await prisma.approvalDecision.findMany({ where: { requestId: entry.id } });
    expect(decisions).toHaveLength(2); // info_requested + approved, both kept
  });

  it('delegation lets a candidate hand the step to someone else, with SoD and self-guardrails', async () => {
    const sr = await submitLaptop();
    const entry = (await queueAs(mgrToken)).find((q) => q.target?.id === sr.id)!;
    const approvalId = entry.id;

    // Only a current candidate may delegate.
    const notMine = await request(app)
      .post(`/api/v1/approvals/${approvalId}/delegate`)
      .set('Authorization', `Bearer ${apr1Token}`)
      .send({ stepIndex: 0, delegateUserId: apr2Id });
    expect(notMine.status).toBe(403);

    // The requester can never be delegated to.
    const empUser = await prisma.user.findFirstOrThrow({ where: { email: EMP.email } });
    const toRequester = await request(app)
      .post(`/api/v1/approvals/${approvalId}/delegate`)
      .set('Authorization', `Bearer ${mgrToken}`)
      .send({ stepIndex: 0, delegateUserId: empUser.id });
    expect(toRequester.status).toBe(403);

    // Delegate to self is refused.
    const toSelf = await request(app)
      .post(`/api/v1/approvals/${approvalId}/delegate`)
      .set('Authorization', `Bearer ${mgrToken}`)
      .send({ stepIndex: 0, delegateUserId: mgrUserId });
    expect(toSelf.status).toBe(400);

    // Real delegation: MGR → APR1, who then decides in MGR's place.
    const delegate = await request(app)
      .post(`/api/v1/approvals/${approvalId}/delegate`)
      .set('Authorization', `Bearer ${mgrToken}`)
      .send({ stepIndex: 0, delegateUserId: apr1Id });
    expect(delegate.status).toBe(200);

    const apr1Queue = await queueAs(apr1Token);
    expect(apr1Queue.some((q) => q.id === approvalId)).toBe(true);

    const decide = await decideAs(apr1Token, approvalId, { stepIndex: 0, decision: 'approved' });
    expect(decide.status).toBe(200);
    expect(await requestStatus(sr.id)).toBe('in_fulfillment');
  });

  it('cancellation works pre-fulfillment, cancels the pending approval, and is refused afterwards', async () => {
    const sr = await submitLaptop();
    const entry = (await queueAs(mgrToken)).find((q) => q.target?.id === sr.id)!;

    const cancel = await request(app)
      .post(`/api/v1/service-requests/${sr.id}/cancel`)
      .set('Authorization', `Bearer ${empToken}`)
      .send({});
    expect(cancel.status).toBe(200);
    expect(cancel.body.data.status).toBe('canceled');
    const approval = await prisma.approvalRequest.findUniqueOrThrow({ where: { id: entry.id } });
    expect(approval.status).toBe('canceled');

    // Deciding on a canceled approval is a conflict.
    const late = await decideAs(mgrToken, entry.id, { stepIndex: 0, decision: 'approved' });
    expect(late.status).toBe(409);

    // Canceling again is a conflict.
    const again = await request(app)
      .post(`/api/v1/service-requests/${sr.id}/cancel`)
      .set('Authorization', `Bearer ${empToken}`)
      .send({});
    expect(again.status).toBe(409);
  });

  it('scopes visibility: outsiders get a 404, staff and the requester can see it', async () => {
    const sr = await submitLaptop();

    // APR2 is neither requester, staff, nor involved.
    const outsider = await request(app).get(`/api/v1/service-requests/${sr.id}`).set('Authorization', `Bearer ${apr2Token}`);
    expect(outsider.status).toBe(404);

    const requesterView = await request(app).get(`/api/v1/service-requests/${sr.id}`).set('Authorization', `Bearer ${empToken}`);
    expect(requesterView.status).toBe(200);

    const staffView = await request(app).get(`/api/v1/service-requests/${sr.id}`).set('Authorization', `Bearer ${mgrToken}`);
    expect(staffView.status).toBe(200);

    // Employees only see their own requests in the list.
    const empList = await request(app).get('/api/v1/service-requests').set('Authorization', `Bearer ${empToken}`);
    expect(empList.body.data.every((r: { id: string }) => r.requester.id === empToken || r.number === sr.number)).toBe(true);
  });
});
