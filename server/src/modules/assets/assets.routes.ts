import { Router } from 'express';
import { z } from 'zod';

import { requireAuth, requirePermission } from '../../core/auth.js';
import { toAuthed } from '../../core/request.js';
import {
  acknowledgeAssignment,
  assignAsset,
  createAsset,
  getAsset,
  listAssignments,
  listAssets,
  listMyAssignments,
  returnAsset,
  transitionAsset,
  updateAsset,
} from './assets.service.js';
import {
  completeSchedule,
  createMaintenanceRecord,
  createSchedule,
  createVendor,
  createWarrantyClaim,
  listAllClaims,
  listAllRecords,
  listAllSchedules,
  listVendors,
  updateVendor,
  updateWarrantyClaim,
} from './maintenance.service.js';

export const assetsRouter = Router();

// Every asset endpoint requires a session; IT-side reads/writes gate on permissions.
assetsRouter.use(requireAuth);

const optionalId = z.string().min(1).optional();
const dateString = z.string().datetime({ offset: true }).optional();

const createSchema = z.object({
  body: z.object({
    name: z.string().min(1),
    category: z.enum(['hardware', 'mobile', 'peripheral', 'network', 'appliance', 'other']).default('hardware'),
    manufacturer: z.string().optional(),
    model: z.string().optional(),
    serialNumber: z.string().optional(),
    purchasedAt: dateString,
    purchaseCost: z.number().min(0).optional(),
    warrantyExpiry: dateString,
    notes: z.string().max(5000).optional(),
    locationId: optionalId,
    departmentId: optionalId,
    vendorId: optionalId,
  }),
});

const listSchema = z.object({
  query: z.object({
    q: z.string().optional(),
    status: z.string().optional(),
    category: z.string().optional(),
    custodianId: z.string().optional(),
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(25),
  }),
});

const updateSchema = z.object({
  params: z.object({ id: z.string().min(1) }),
  body: z
    .object({
      name: z.string().min(1).optional(),
      category: z.enum(['hardware', 'mobile', 'peripheral', 'network', 'appliance', 'other']).optional(),
      manufacturer: z.string().optional(),
      model: z.string().optional(),
      serialNumber: z.string().optional(),
      purchasedAt: dateString,
      purchaseCost: z.number().min(0).optional(),
      warrantyExpiry: dateString,
      notes: z.string().max(5000).optional(),
      locationId: optionalId,
      departmentId: optionalId,
      vendorId: optionalId,
    })
    .refine((b) => Object.keys(b).length > 0, { message: 'No fields to update' }),
});

const transitionSchema = z.object({
  params: z.object({ id: z.string().min(1) }),
  body: z.object({
    status: z.enum(['in_stock', 'deployed', 'in_repair', 'in_maintenance', 'retired', 'lost']),
    reason: z.string().max(2000).optional(),
  }),
});

const assignSchema = z.object({
  params: z.object({ id: z.string().min(1) }),
  body: z.object({
    employeeId: z.string().min(1),
    note: z.string().max(2000).optional(),
    dueAt: dateString,
  }),
});

const returnSchema = z.object({
  params: z.object({ id: z.string().min(1) }),
  body: z.object({ note: z.string().max(2000).optional() }),
});

const assignmentListSchema = z.object({
  query: z.object({
    employeeId: z.string().optional(),
    assetId: z.string().optional(),
    active: z
      .enum(['true', 'false'])
      .optional()
      .transform((v) => (v === undefined ? undefined : v === 'true')),
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(25),
  }),
});

/* ── Employee self-service (no asset permission needed) ──────────────────── */

assetsRouter.get('/assignments/my', async (req, res, next) => {
  try {
    const user = toAuthed(req).user!;
    res.json({ data: await listMyAssignments(user) });
  } catch (e) {
    next(e);
  }
});

assetsRouter.post('/assignments/:id/acknowledge', async (req, res, next) => {
  try {
    const parsed = z.object({ params: z.object({ id: z.string().min(1) }) }).parse({ params: req.params });
    const row = await acknowledgeAssignment(toAuthed(req).user!, parsed.params.id);
    res.json({ data: row });
  } catch (e) {
    next(e);
  }
});

assetsRouter.post('/assignments/:id/return', async (req, res, next) => {
  try {
    const parsed = returnSchema.parse({ params: req.params, body: req.body });
    const row = await returnAsset(toAuthed(req).user!, parsed.params.id, parsed.body);
    res.json({ data: row });
  } catch (e) {
    next(e);
  }
});

/* -- IT-side routes (assets, assignments, maintenance, warranty) -- */

assetsRouter.get('/', requirePermission('assets:read'), async (req, res, next) => {
  try {
    const parsed = listSchema.parse({ query: req.query });
    res.json(await listAssets(parsed.query));
  } catch (e) {
    next(e);
  }
});

assetsRouter.post('/', requirePermission('assets:create'), async (req, res, next) => {
  try {
    const parsed = createSchema.parse({ body: req.body });
    const asset = await createAsset(toAuthed(req).user!, parsed.body);
    res.status(201).json({ data: asset });
  } catch (e) {
    next(e);
  }
});

assetsRouter.get('/assignments', requirePermission('assets:read'), async (req, res, next) => {
  try {
    const parsed = assignmentListSchema.parse({ query: req.query });
    res.json(await listAssignments(parsed.query));
  } catch (e) {
    next(e);
  }
});

/* ── Global maintenance/warranty lists (static paths, before /:id) ────────── */

const globalListSchema = z.object({
  query: z.object({
    status: z.string().optional(),
    type: z.string().optional(),
    dueWithinDays: z.coerce.number().int().min(1).max(365).optional(),
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(25),
  }),
});

assetsRouter.get('/maintenance/schedules', requirePermission('assets:read'), async (req, res, next) => {
  try {
    const parsed = globalListSchema.parse({ query: req.query });
    res.json(await listAllSchedules({ dueWithinDays: parsed.query.dueWithinDays, page: parsed.query.page, limit: parsed.query.limit }));
  } catch (e) {
    next(e);
  }
});

assetsRouter.get('/maintenance/records', requirePermission('assets:read'), async (req, res, next) => {
  try {
    const parsed = globalListSchema.parse({ query: req.query });
    res.json(await listAllRecords({ type: parsed.query.type, page: parsed.query.page, limit: parsed.query.limit }));
  } catch (e) {
    next(e);
  }
});

assetsRouter.get('/warranty-claims', requirePermission('assets:read'), async (req, res, next) => {
  try {
    const parsed = globalListSchema.parse({ query: req.query });
    res.json(await listAllClaims({ status: parsed.query.status, page: parsed.query.page, limit: parsed.query.limit }));
  } catch (e) {
    next(e);
  }
});

assetsRouter.get('/:id', requirePermission('assets:read'), async (req, res, next) => {
  try {
    const parsed = z.object({ params: z.object({ id: z.string().min(1) }) }).parse({ params: req.params });
    res.json({ data: await getAsset(parsed.params.id) });
  } catch (e) {
    next(e);
  }
});

assetsRouter.patch('/:id', requirePermission('assets:update'), async (req, res, next) => {
  try {
    const parsed = updateSchema.parse({ params: req.params, body: req.body });
    const asset = await updateAsset(toAuthed(req).user!, parsed.params.id, parsed.body);
    res.json({ data: asset });
  } catch (e) {
    next(e);
  }
});

assetsRouter.post('/:id/transition', requirePermission('assets:update'), async (req, res, next) => {
  try {
    const parsed = transitionSchema.parse({ params: req.params, body: req.body });
    const asset = await transitionAsset(toAuthed(req).user!, parsed.params.id, parsed.body.status, parsed.body.reason);
    res.json({ data: asset });
  } catch (e) {
    next(e);
  }
});

assetsRouter.post('/:id/assignments', requirePermission('assets:assign'), async (req, res, next) => {
  try {
    const parsed = assignSchema.parse({ params: req.params, body: req.body });
    const assignment = await assignAsset(toAuthed(req).user!, parsed.params.id, parsed.body);
    res.status(201).json({ data: assignment });
  } catch (e) {
    next(e);
  }
});

/* ── Maintenance schedules & records ─────────────────────────────────────── */

const idParams = z.object({ params: z.object({ id: z.string().min(1) }) });

const scheduleBody = z.object({
  name: z.string().min(1).max(200),
  intervalDays: z.number().int().min(1).max(3650),
  firstDueAt: dateString,
});

assetsRouter.post('/:id/schedules', requirePermission('assets:update'), async (req, res, next) => {
  try {
    const body = scheduleBody.parse(req.body);
    const params = idParams.parse({ params: req.params }).params;
    const schedule = await createSchedule(toAuthed(req).user!, params.id, body);
    res.status(201).json({ data: schedule });
  } catch (e) {
    next(e);
  }
});

assetsRouter.get('/:id/schedules', requirePermission('assets:read'), async (req, res, next) => {
  try {
    const asset = await getAsset(idParams.parse({ params: req.params }).params.id);
    res.json({ data: asset.maintenanceSchedules });
  } catch (e) {
    next(e);
  }
});

const completeSchema = z.object({
  params: z.object({ id: z.string().min(1) }), // schedule id
  body: z.object({
    summary: z.string().min(1).max(5000),
    cost: z.number().min(0).optional(),
    vendorId: optionalId,
    performedBy: z.string().max(200).optional(),
  }),
});

assetsRouter.post('/schedules/:id/complete', requirePermission('assets:update'), async (req, res, next) => {
  try {
    const parsed = completeSchema.parse({ params: req.params, body: req.body });
    const result = await completeSchedule(toAuthed(req).user!, parsed.params.id, parsed.body);
    res.status(201).json({ data: result });
  } catch (e) {
    next(e);
  }
});

const recordSchema = z.object({
  params: z.object({ id: z.string().min(1) }),
  body: z.object({
    type: z.enum(['preventive', 'repair', 'inspection', 'upgrade']).default('preventive'),
    summary: z.string().min(1).max(5000),
    cost: z.number().min(0).optional(),
    vendorId: optionalId,
    performedBy: z.string().max(200).optional(),
    performedAt: dateString,
  }),
});

assetsRouter.post('/:id/maintenance', requirePermission('assets:update'), async (req, res, next) => {
  try {
    const parsed = recordSchema.parse({ params: req.params, body: req.body });
    const record = await createMaintenanceRecord(toAuthed(req).user!, parsed.params.id, parsed.body);
    res.status(201).json({ data: record });
  } catch (e) {
    next(e);
  }
});

/* ── Warranty claims ─────────────────────────────────────────────────────── */

const claimSchema = z.object({
  params: z.object({ id: z.string().min(1) }),
  body: z.object({ issue: z.string().min(1).max(5000), vendorId: optionalId }),
});

assetsRouter.post('/:id/warranty-claims', requirePermission('assets:update'), async (req, res, next) => {
  try {
    const parsed = claimSchema.parse({ params: req.params, body: req.body });
    const claim = await createWarrantyClaim(toAuthed(req).user!, parsed.params.id, parsed.body);
    res.status(201).json({ data: claim });
  } catch (e) {
    next(e);
  }
});

const claimUpdateSchema = z.object({
  params: z.object({ id: z.string().min(1) }), // claim id
  body: z.object({
    status: z.enum(['open', 'submitted', 'approved', 'rejected', 'resolved']).optional(),
    resolution: z.string().max(5000).optional(),
  }),
});

assetsRouter.patch('/warranty-claims/:id', requirePermission('assets:update'), async (req, res, next) => {
  try {
    const parsed = claimUpdateSchema.parse({ params: req.params, body: req.body });
    const claim = await updateWarrantyClaim(toAuthed(req).user!, parsed.params.id, parsed.body);
    res.json({ data: claim });
  } catch (e) {
    next(e);
  }
});

/* ── Vendors (separate router — /vendors must not collide with /:id) ─────── */

export const vendorsRouter = Router();
vendorsRouter.use(requireAuth);

const vendorSchema = z.object({
  body: z.object({
    name: z.string().min(1).max(200),
    contact: z.string().max(200).optional(),
    email: z.string().email().optional(),
    phone: z.string().max(50).optional(),
    notes: z.string().max(5000).optional(),
  }),
});

const vendorUpdateSchema = z.object({
  params: z.object({ id: z.string().min(1) }),
  body: vendorSchema.shape.body.partial().refine((b) => Object.keys(b).length > 0, { message: 'No fields to update' }),
});

vendorsRouter.get('/', requirePermission('assets:read'), async (req, res, next) => {
  try {
    const parsed = z.object({ query: z.object({ activeOnly: z.enum(['true', 'false']).optional() }) }).parse({ query: req.query });
    res.json({ data: await listVendors({ activeOnly: parsed.query.activeOnly === 'true' }) });
  } catch (e) {
    next(e);
  }
});

vendorsRouter.post('/', requirePermission('assets:create'), async (req, res, next) => {
  try {
    const parsed = vendorSchema.parse({ body: req.body });
    res.status(201).json({ data: await createVendor(toAuthed(req).user!, parsed.body) });
  } catch (e) {
    next(e);
  }
});

vendorsRouter.patch('/:id', requirePermission('assets:update'), async (req, res, next) => {
  try {
    const parsed = vendorUpdateSchema.parse({ params: req.params, body: req.body });
    res.json({ data: await updateVendor(toAuthed(req).user!, parsed.params.id, parsed.body) });
  } catch (e) {
    next(e);
  }
});
