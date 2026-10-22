import { Router } from 'express';
import { z } from 'zod';

import { requireAuth, requirePermission } from '../../core/auth.js';
import { toAuthed } from '../../core/request.js';
import { createMovement, createItem, listItem, listMovements, updateItem } from './inventory.service.js';

export const inventoryRouter = Router();

inventoryRouter.use(requireAuth);

const optionalId = z.string().min(1).optional();

const createSchema = z.object({
  body: z.object({
    name: z.string().min(1).max(200),
    sku: z.string().max(100).optional(),
    category: z.string().max(100).optional(),
    unit: z.string().max(20).optional(),
    reorderPoint: z.number().int().min(0).optional(),
    unitCost: z.number().min(0).optional(),
    locationId: optionalId,
    initialQuantity: z.number().int().min(0).optional(),
  }),
});

const updateSchema = z.object({
  params: z.object({ id: z.string().min(1) }),
  body: z
    .object({
      name: z.string().min(1).max(200).optional(),
      sku: z.string().max(100).nullable().optional(),
      category: z.string().max(100).nullable().optional(),
      unit: z.string().max(20).optional(),
      reorderPoint: z.number().int().min(0).optional(),
      unitCost: z.number().min(0).nullable().optional(),
      locationId: optionalId.nullable(),
    })
    .refine((b) => Object.keys(b).length > 0, { message: 'No fields to update' }),
});

const listSchema = z.object({
  query: z.object({
    q: z.string().optional(),
    lowStock: z
      .enum(['true', 'false'])
      .optional()
      .transform((v) => (v === undefined ? undefined : v === 'true')),
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(25),
  }),
});

const movementSchema = z.object({
  params: z.object({ id: z.string().min(1) }),
  body: z.object({
    type: z.enum(['in', 'out', 'adjust']),
    delta: z.number().int().positive().optional(),
    resultingQuantity: z.number().int().min(0).optional(),
    reason: z.string().min(1).max(2000),
    ticketId: optionalId,
  }),
});

inventoryRouter.get('/', requirePermission('assets:read'), async (req, res, next) => {
  try {
    const parsed = listSchema.parse({ query: req.query });
    res.json(await listItem(parsed.query));
  } catch (e) {
    next(e);
  }
});

inventoryRouter.post('/', requirePermission('assets:create'), async (req, res, next) => {
  try {
    const parsed = createSchema.parse({ body: req.body });
    res.status(201).json({ data: await createItem(toAuthed(req).user!, parsed.body) });
  } catch (e) {
    next(e);
  }
});

inventoryRouter.get('/:id/movements', requirePermission('assets:read'), async (req, res, next) => {
  try {
    const parsed = z
      .object({
        params: z.object({ id: z.string().min(1) }),
        query: z.object({
          page: z.coerce.number().int().min(1).default(1),
          limit: z.coerce.number().int().min(1).max(100).default(25),
        }),
      })
      .parse({ params: req.params, query: req.query });
    res.json(await listMovements(parsed.params.id, parsed.query));
  } catch (e) {
    next(e);
  }
});

inventoryRouter.patch('/:id', requirePermission('assets:update'), async (req, res, next) => {
  try {
    const parsed = updateSchema.parse({ params: req.params, body: req.body });
    res.json({ data: await updateItem(toAuthed(req).user!, parsed.params.id, parsed.body) });
  } catch (e) {
    next(e);
  }
});

inventoryRouter.post('/:id/movements', requirePermission('assets:update'), async (req, res, next) => {
  try {
    const parsed = movementSchema.parse({ params: req.params, body: req.body });
    const movement = await createMovement(toAuthed(req).user!, parsed.params.id, parsed.body);
    res.status(201).json({ data: movement });
  } catch (e) {
    next(e);
  }
});
