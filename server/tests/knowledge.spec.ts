import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '../src/app.js';
import { prisma } from '../src/prisma/client.js';

const app = createApp();

const SETUP_TOKEN = 'test-setup-token-0123456789abcdef0123456789abcdef';
const ADMIN = { email: 'admin@test.local', password: 'Sup3rSecret!pass', name: 'Root Admin' };
const TECH = { email: 'tech@test.local', name: 'Tech Person', password: 'Password123abc' };
const MGR = { email: 'mgr@test.local', name: 'Manager Person', password: 'Password123abc' };
const EMP = { email: 'emp@test.local', name: 'Employee Person', password: 'Password123abc' };

let adminToken = '';
let techToken = '';
let mgrToken = '';
let employeeToken = '';
let techEmployeeId = '';
let techUserId = '';
let mgrUserId = '';
let publishedPublicId = '';
let publishedInternalId = '';
let restrictedEmptyId = '';
let draftId = '';
let inReviewId = '';
let resolvedTicketId = '';
let openTicketId = '';

async function login(email: string, password: string): Promise<string> {
  const res = await request(app).post('/api/v1/auth/login').send({ email, password });
  return res.body.data.accessToken;
}

beforeEach(async () => {
  const bootstrapRes = await request(app).post('/api/v1/auth/bootstrap').send({ setupToken: SETUP_TOKEN, ...ADMIN });
  expect(bootstrapRes.status).toBe(201);
  adminToken = await login(ADMIN.email, ADMIN.password);

  const mkUser = (body: Record<string, unknown>, roles: string[]) =>
    request(app).post('/api/v1/users').set('Authorization', `Bearer ${adminToken}`).send({ ...body, roles });

  const tech = await mkUser(TECH, ['it_technician']);
  expect(tech.status).toBe(201);
  techUserId = tech.body.data.id;
  techEmployeeId = tech.body.data.employee.id;
  const mgr = await mkUser(MGR, ['it_manager']);
  expect(mgr.status).toBe(201);
  mgrUserId = mgr.body.data.id;
  const emp = await mkUser(EMP, ['employee']);
  expect(emp.status).toBe(201);

  techToken = await login(TECH.email, TECH.password);
  mgrToken = await login(MGR.email, MGR.password);
  employeeToken = await login(EMP.email, EMP.password);

  // Create tickets via API (Phase 2 is done) - employee creates, tech resolves
  const ticketRes = await request(app)
    .post('/api/v1/tickets')
    .set('Authorization', `Bearer ${employeeToken}`)
    .send({
      title: 'Printer issue',
      description: 'Printer not printing',
      category: 'hardware',
      impact: 'medium',
      urgency: 'high',
    });
  expect(ticketRes.status).toBe(201);
  openTicketId = ticketRes.body.data.id;

  // Assign to technician
  const assignRes = await request(app)
    .post(`/api/v1/tickets/${openTicketId}/assign`)
    .set('Authorization', `Bearer ${mgrToken}`)
    .send({ assigneeId: techEmployeeId });
  expect(assignRes.status).toBe(200);

  // Resolve the ticket as technician
  const detail = await request(app).get(`/api/v1/tickets/${openTicketId}`).set('Authorization', `Bearer ${techToken}`);
  const version = detail.body.data.version as number;
  const resolveRes = await request(app)
    .post(`/api/v1/tickets/${openTicketId}/transition`)
    .set('Authorization', `Bearer ${techToken}`)
    .send({ status: 'resolved', resolutionNote: 'Restart the print spooler service and retry.', version });
  expect(resolveRes.status).toBe(200);
  resolvedTicketId = openTicketId;

  // Second ticket stays open (resolutionNote null) — Task 5's from-ticket
  // conversion tests an open ticket as the "nothing to convert" case.
  const openRes = await request(app)
    .post('/api/v1/tickets')
    .set('Authorization', `Bearer ${employeeToken}`)
    .send({
      title: 'Laptop battery drains within an hour',
      description: 'Battery no longer holds charge after the last update.',
      category: 'hardware',
      impact: 'low',
      urgency: 'medium',
    });
  expect(openRes.status).toBe(201);
  openTicketId = openRes.body.data.id;

  // Seed knowledge articles via direct Prisma writes (create + revision 1 in a transaction)
  // publishedPublicId: authored by technician, published, visibility: 'public'
  const pubPublic = await prisma.$transaction(async (tx) => {
    const article = await tx.knowledgeArticle.create({
      data: {
        title: 'How to reset your VPN password',
        summary: 'Steps to reset an expired VPN password from the self-service portal.',
        body: 'Open the self-service portal, choose Reset password, and follow the prompts.',
        category: 'Access',
        tags: ['vpn', 'password'],
        status: 'published',
        visibility: 'public',
        authorId: techUserId,
        ownerId: techUserId,
        version: 1,
        publishedAt: new Date(),
        reviewDueAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
      },
    });
    await tx.knowledgeRevision.create({
      data: {
        articleId: article.id,
        revisionNumber: 1,
        title: article.title,
        summary: article.summary,
        body: article.body,
        category: article.category,
        tags: article.tags,
        visibility: article.visibility,
        allowedRoles: article.allowedRoles,
        changeNote: 'Initial version',
        editorId: techUserId,
      },
    });
    return article;
  });
  publishedPublicId = pubPublic.id;

  // publishedInternalId: authored by technician, published, visibility: 'internal'
  const pubInternal = await prisma.$transaction(async (tx) => {
    const article = await tx.knowledgeArticle.create({
      data: {
        title: 'Internal: VPN troubleshooting guide',
        summary: 'Detailed troubleshooting for IT staff only.',
        body: 'Check the RADIUS logs, verify the certificate, and ensure the user is in the VPN group.',
        category: 'Access',
        tags: ['vpn', 'troubleshooting'],
        status: 'published',
        visibility: 'internal',
        authorId: techUserId,
        ownerId: techUserId,
        version: 1,
        publishedAt: new Date(),
        reviewDueAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
      },
    });
    await tx.knowledgeRevision.create({
      data: {
        articleId: article.id,
        revisionNumber: 1,
        title: article.title,
        summary: article.summary,
        body: article.body,
        category: article.category,
        tags: article.tags,
        visibility: article.visibility,
        allowedRoles: article.allowedRoles,
        changeNote: 'Initial version',
        editorId: techUserId,
      },
    });
    return article;
  });
  publishedInternalId = pubInternal.id;

  // restrictedEmptyId: authored by technician, published, visibility: 'restricted', allowedRoles: []
  const restrictedEmpty = await prisma.$transaction(async (tx) => {
    const article = await tx.knowledgeArticle.create({
      data: {
        title: 'Restricted: Security incident response',
        summary: 'Internal security incident response procedures.',
        body: 'Follow the incident response playbook. Contact the security team immediately.',
        category: 'Security',
        tags: ['security', 'incident'],
        status: 'published',
        visibility: 'restricted',
        allowedRoles: [],
        authorId: techUserId,
        ownerId: techUserId,
        version: 1,
        publishedAt: new Date(),
        reviewDueAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
      },
    });
    await tx.knowledgeRevision.create({
      data: {
        articleId: article.id,
        revisionNumber: 1,
        title: article.title,
        summary: article.summary,
        body: article.body,
        category: article.category,
        tags: article.tags,
        visibility: article.visibility,
        allowedRoles: article.allowedRoles,
        changeNote: 'Initial version',
        editorId: techUserId,
      },
    });
    return article;
  });
  restrictedEmptyId = restrictedEmpty.id;

  // draftId: draft owned by the technician
  const draft = await prisma.$transaction(async (tx) => {
    const article = await tx.knowledgeArticle.create({
      data: {
        title: 'Draft: New onboarding checklist',
        summary: 'Checklist for new employee onboarding.',
        body: '1. Create account. 2. Assign laptop. 3. Setup email.',
        category: 'Onboarding',
        tags: ['onboarding', 'checklist'],
        status: 'draft',
        visibility: 'internal',
        authorId: techUserId,
        ownerId: techUserId,
        version: 1,
      },
    });
    await tx.knowledgeRevision.create({
      data: {
        articleId: article.id,
        revisionNumber: 1,
        title: article.title,
        summary: article.summary,
        body: article.body,
        category: article.category,
        tags: article.tags,
        visibility: article.visibility,
        allowedRoles: article.allowedRoles,
        changeNote: 'Initial version',
        editorId: techUserId,
      },
    });
    return article;
  });
  draftId = draft.id;

  // inReviewId: draft submitted for review by the technician
  const inReview = await prisma.$transaction(async (tx) => {
    const article = await tx.knowledgeArticle.create({
      data: {
        title: 'In Review: Password policy update',
        summary: 'Proposed changes to the password policy.',
        body: 'New policy requires 12 characters, MFA, and rotation every 90 days.',
        category: 'Security',
        tags: ['password', 'policy'],
        status: 'in_review',
        visibility: 'internal',
        authorId: techUserId,
        ownerId: techUserId,
        version: 1,
      },
    });
    await tx.knowledgeRevision.create({
      data: {
        articleId: article.id,
        revisionNumber: 1,
        title: article.title,
        summary: article.summary,
        body: article.body,
        category: article.category,
        tags: article.tags,
        visibility: article.visibility,
        allowedRoles: article.allowedRoles,
        changeNote: 'Initial version',
        editorId: techUserId,
      },
    });
    return article;
  });
  inReviewId = inReview.id;
});

/** Minimum valid create payload — spread and override per test. */
const ARTICLE = {
  title: 'Reset your VPN password',
  summary: 'Steps to reset an expired VPN password from the self-service portal.',
  body: 'Open the self-service portal, choose Reset password, and follow the prompts.',
  category: 'Access',
  tags: ['vpn', 'password'],
  visibility: 'internal' as const,
};

describe('Knowledge base — visibility scoping', () => {
  it('lists only published articles to an employee', async () => {
    const res = await request(app).get('/api/v1/knowledge')
      .set('Authorization', `Bearer ${employeeToken}`);
    expect(res.status).toBe(200);
    // `.every` alone is vacuously true on an empty array — also assert the
    // public fixture is actually in the list.
    expect(res.body.data.some((a: { id: string }) => a.id === publishedPublicId)).toBe(true);
    expect(res.body.data.every((a: { status: string }) => a.status === 'published')).toBe(true);
  });

  it('ignores a status=draft filter from an employee', async () => {
    const res = await request(app).get('/api/v1/knowledge?status=draft')
      .set('Authorization', `Bearer ${employeeToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(0);
  });

  it('hides internal articles from an employee but shows them to a technician', async () => {
    const asEmployee = await request(app).get(`/api/v1/knowledge/${publishedInternalId}`)
      .set('Authorization', `Bearer ${employeeToken}`);
    expect(asEmployee.status).toBe(404);
    const asTech = await request(app).get(`/api/v1/knowledge/${publishedInternalId}`)
      .set('Authorization', `Bearer ${techToken}`);
    expect(asTech.status).toBe(200);
  });

  it('fails closed for a restricted article with an empty allowedRoles list', async () => {
    const res = await request(app).get(`/api/v1/knowledge/${restrictedEmptyId}`)
      .set('Authorization', `Bearer ${employeeToken}`);
    expect(res.status).toBe(404);
  });

  it('still lets a publisher read a restricted article whose role list is empty', async () => {
    const res = await request(app).get(`/api/v1/knowledge/${restrictedEmptyId}`)
      .set('Authorization', `Bearer ${mgrToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(restrictedEmptyId);
  });

  it('returns 200 and no results for a q of only LIKE wildcards', async () => {
    const res = await request(app).get('/api/v1/knowledge?q=%25%25')
      .set('Authorization', `Bearer ${employeeToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(0);
  });
});