import { Router } from 'express';
import { z } from 'zod';

import { requireAuth, requirePermission } from '../../core/auth.js';
import { toAuthed } from '../../core/request.js';
import { assignLicense, createLicense, getLicense, listAssignments, listLicenses, returnLicense, updateLicense } from './licenses.service.js';

export const licensesRouter = Router();

licensesRouter.use(requireAuth);

const dateString = z.string().datetime({ offset: true }).optional();
const optionalId = z.string().min(1).optional();
const licenseType = z.enum(['perpetual', 'subscription', 'oem', 'volume']);

const createSchema = z.object({
  body: z.object({
    name: z.string().min(1).max(200),
    vendorId: optionalId,
    licenseKey: z.string().max(500).optional(),
    type: licenseType.optional(),
    seats: z.number().int().min(1).max(100000),
    expiresAt: dateString,
    cost: z.number().min(0).optional(),
    notes: z.string().max(5000).optional(),
  }),
});

const listSchema = z.object({
  query: z.object({
    q: z.string().optional(),
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(25),
  }),
});

const updateSchema = z.object({
  params: z.object({ id: z.string().min(1) }),
  body: z
    .object({
      name: z.string().min(1).max(200).optional(),
      vendorId: optionalId.nullable(),
      licenseKey: z.string().max(500).nullable().optional(),
      type: licenseType.optional(),
      seats: z.number().int().min(1).max(100000).optional(),
      expiresAt: dateString.nullable(),
      cost: z.number().min(0).nullable().optional(),
      notes: z.string().max(5000).nullable().optional(),
    })
    .refine((b) => Object.keys(b).length > 0, { message: 'No fields to update' }),
});

const assignSchema = z.object({
  params: z.object({ id: z.string().min(1) }),
  body: z.object({ employeeId: z.string().min(1), note: z.string().max(2000).optional() }),
});

const assignmentListSchema = z.object({
  query: z.object({
    licenseId: z.string().optional(),
    employeeId: z.string().optional(),
    active: z
      .enum(['true', 'false'])
      .optional()
      .transform((v) => (v === undefined ? undefined : v === 'true')),
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(25),
  }),
});

licensesRouter.get('/', requirePermission('assets:read'), async (req, res, next) => {
  try {
    const parsed = listSchema.parse({ query: req.query });
    res.json(await listLicenses(parsed.query));
  } catch (e) {
    next(e);
  }
});

licensesRouter.post('/', requirePermission('assets:create'), async (req, res, next) => {
  try {
    const parsed = createSchema.parse({ body: req.body });
    res.status(201).json({ data: await createLicense(toAuthed(req).user!, parsed.body) });
  } catch (e) {
    next(e);
  }
});

licensesRouter.get('/assignments', requirePermission('assets:read'), async (req, res, next) => {
  try {
    const parsed = assignmentListSchema.parse({ query: req.query });
    res.json(await listAssignments(parsed.query));
  } catch (e) {
    next(e);
  }
});

licensesRouter.get('/:id', requirePermission('assets:read'), async (req, res, next) => {
  try {
    const parsed = z.object({ params: z.object({ id: z.string().min(1) }) }).parse({ params: req.params });
    res.json({ data: await getLicense(parsed.params.id) });
  } catch (e) {
    next(e);
  }
});

licensesRouter.patch('/:id', requirePermission('assets:update'), async (req, res, next) => {
  try {
    const parsed = updateSchema.parse({ params: req.params, body: req.body });
    res.json({ data: await updateLicense(toAuthed(req).user!, parsed.params.id, parsed.body) });
  } catch (e) {
    next(e);
  }
});

licensesRouter.post('/:id/assignments', requirePermission('assets:assign'), async (req, res, next) => {
  try {
    const parsed = assignSchema.parse({ params: req.params, body: req.body });
    res.status(201).json({ data: await assignLicense(toAuthed(req).user!, parsed.params.id, parsed.body) });
  } catch (e) {
    next(e);
  }
});

const returnSchema = z.object({
  params: z.object({ id: z.string().min(1) }), // assignment id
  body: z.object({ note: z.string().max(2000).optional() }),
});

licensesRouter.post('/assignments/:id/return', requirePermission('assets:assign'), async (req, res, next) => {
  try {
    const parsed = returnSchema.parse({ params: req.params, body: req.body });
    res.json({ data: await returnLicense(toAuthed(req).user!, parsed.params.id, parsed.body.note) });
  } catch (e) {
    next(e);
  }
});
