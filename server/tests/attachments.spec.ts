import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createApp } from '../src/app.js';

// Hermetic storage: the real Supabase Storage client is replaced with an
// in-memory stand-in so tests never touch the project's bucket.
const objectStore = vi.hoisted(() => new Map<string, Buffer>());
vi.mock('../src/modules/tickets/storage.js', () => ({
  storageEnabled: () => true,
  putObject: vi.fn(async (path: string, body: Buffer) => {
    objectStore.set(path, body);
  }),
  createSignedUrl: vi.fn(async (path: string) => `https://signed.test/${encodeURIComponent(path)}?token=t`),
  deleteObject: vi.fn(async (path: string) => {
    objectStore.delete(path);
  }),
}));

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
  objectStore.clear();
  await request(app).post('/api/v1/auth/bootstrap').send({ setupToken: SETUP_TOKEN, ...ADMIN });
  adminToken = await login(ADMIN.email, ADMIN.password);
  await request(app)
    .post('/api/v1/users')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ ...EMP, roles: ['employee'] });
  empToken = await login(EMP.email, EMP.password);
});

async function createTicket(): Promise<string> {
  const res = await request(app)
    .post('/api/v1/tickets')
    .set('Authorization', `Bearer ${empToken}`)
    .send({
      title: 'Attachment test ticket',
      description: 'Testing the mediated attachment upload and download flow.',
      category: 'hardware',
      impact: 'low',
      urgency: 'low',
    });
  return res.body.data.id as string;
}

describe('Attachments', () => {
  it('uploads, lists on the ticket, and mediates the download with a signed URL', async () => {
    const ticketId = await createTicket();

    const up = await request(app)
      .post(`/api/v1/tickets/${ticketId}/attachments`)
      .set('Authorization', `Bearer ${empToken}`)
      .attach('file', Buffer.from('log file contents'), 'diagnostics.txt');
    expect(up.status).toBe(201);
    expect(up.body.data.filename).toBe('diagnostics.txt');
    expect(up.body.data.sizeBytes).toBe(17);

    const detail = await request(app).get(`/api/v1/tickets/${ticketId}`).set('Authorization', `Bearer ${empToken}`);
    expect(detail.body.data.attachments).toHaveLength(1);
    expect(detail.body.data.attachments[0].filename).toBe('diagnostics.txt');
    const actions = detail.body.data.activities.map((a: { action: string }) => a.action);
    expect(actions).toContain('attachment_added');

    const dl = await request(app)
      .get(`/api/v1/tickets/${ticketId}/attachments/${up.body.data.id}/download`)
      .set('Authorization', `Bearer ${empToken}`);
    expect(dl.status).toBe(200);
    expect(dl.body.data.url).toContain('diagnostics.txt');
    expect(dl.body.data.filename).toBe('diagnostics.txt');

    // Download is audited.
    const audit = await request(app).get('/api/v1/audit').set('Authorization', `Bearer ${adminToken}`).query({ limit: 50 });
    const actionsList = audit.body.data.map((e: { action: string }) => e.action);
    expect(actionsList).toContain('ticket.attachment_downloaded');
  });

  it('blocks strangers from uploading to or listing someone else’s attachments', async () => {
    const ticketId = await createTicket();

    const stranger = await request(app)
      .post('/api/v1/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ email: 'stranger@test.local', name: 'Stranger Person', password: 'Password123abc', roles: ['employee'] });
    expect(stranger.status).toBe(201);
    const strangerToken = await login('stranger@test.local', 'Password123abc');

    const up = await request(app)
      .post(`/api/v1/tickets/${ticketId}/attachments`)
      .set('Authorization', `Bearer ${strangerToken}`)
      .attach('file', Buffer.from('x'), 'evil.txt');
    expect(up.status).toBe(404);

    const list = await request(app)
      .get(`/api/v1/tickets/${ticketId}/attachments`)
      .set('Authorization', `Bearer ${strangerToken}`);
    expect(list.status).toBe(404);
  });

  it('rejects executable extensions and empty files', async () => {
    const ticketId = await createTicket();

    const exe = await request(app)
      .post(`/api/v1/tickets/${ticketId}/attachments`)
      .set('Authorization', `Bearer ${empToken}`)
      .attach('file', Buffer.from('MZ...'), 'update.exe');
    expect(exe.status).toBe(400);

    const empty = await request(app)
      .post(`/api/v1/tickets/${ticketId}/attachments`)
      .set('Authorization', `Bearer ${empToken}`)
      .attach('file', Buffer.from(''), 'empty.txt');
    expect(empty.status).toBe(400);

    const missing = await request(app)
      .post(`/api/v1/tickets/${ticketId}/attachments`)
      .set('Authorization', `Bearer ${empToken}`);
    expect(missing.status).toBe(400);
  });
});
