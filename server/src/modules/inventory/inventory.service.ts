import { recordAudit } from '../../core/audit.js';
import { badRequest, conflict, notFound } from '../../core/errors.js';
import type { AuthedUser } from '../../core/request.js';
import { notifyRole } from '../notifications/notifications.service.js';
import { prisma } from '../../prisma/client.js';

/* ── Inventory items ──────────────────────────────────────────────────────── */

export async function createItem(
  user: AuthedUser,
  input: { name: string; sku?: string; category?: string; unit?: string; reorderPoint?: number; unitCost?: number; locationId?: string; initialQuantity?: number },
) {
  // Item + initial ledger row + level update commit atomically — a failure
  // partway cannot leave an item without its ledger entry or a stale level.
  const item = await prisma.$transaction(async (tx) => {
    const created = await tx.inventoryItem.create({
      data: {
        name: input.name,
        sku: input.sku,
        category: input.category,
        unit: input.unit,
        reorderPoint: input.reorderPoint,
        unitCost: input.unitCost,
        locationId: input.locationId,
      },
    });

    const initial = input.initialQuantity ?? 0;
    if (initial > 0) {
      await tx.stockMovement.create({
        data: {
          itemId: created.id,
          type: 'in',
          delta: initial,
          resultingQuantity: initial,
          reason: 'Initial stock',
          createdById: user.id,
        },
      });
      await tx.inventoryItem.update({ where: { id: created.id }, data: { quantity: initial } });
    }
    return created;
  });

  await recordAudit({ actorId: user.id, action: 'inventory.item_created', targetType: 'inventory_item', targetId: item.id, meta: { name: item.name } });
  return prisma.inventoryItem.findUniqueOrThrow({ where: { id: item.id }, include: { location: { select: { id: true, name: true } } } });
}

export async function updateItem(
  user: AuthedUser,
  id: string,
  input: Partial<{ name: string; sku: string | null; category: string | null; unit: string; reorderPoint: number; unitCost: number | null; locationId: string | null }>,
) {
  const item = await prisma.inventoryItem.findUnique({ where: { id } });
  if (!item) throw notFound('Inventory item not found');

  // Quantity is not editable here — stock only changes through movements.
  const updated = await prisma.inventoryItem.update({
    where: { id },
    data: input,
    include: { location: { select: { id: true, name: true } } },
  });
  await recordAudit({ actorId: user.id, action: 'inventory.item_updated', targetType: 'inventory_item', targetId: id });
  return updated;
}

export async function listItem(opts: { q?: string; lowStock?: boolean; page: number; limit: number }) {
  const where = {
    ...(opts.q
      ? { OR: [{ name: { contains: opts.q, mode: 'insensitive' as const } }, { sku: { contains: opts.q, mode: 'insensitive' as const } }] }
      : {}),
    ...(opts.lowStock ? { quantity: { lte: prisma.inventoryItem.fields.reorderPoint } } : {}),
  };
  const [data, total] = await Promise.all([
    prisma.inventoryItem.findMany({
      where,
      include: { location: { select: { id: true, name: true } } },
      orderBy: { name: 'asc' },
      skip: (opts.page - 1) * opts.limit,
      take: opts.limit,
    }),
    prisma.inventoryItem.count({ where }),
  ]);
  return { data, meta: { total, page: opts.page, limit: opts.limit, pages: Math.ceil(total / opts.limit) } };
}

/* ── Stock movements ──────────────────────────────────────────────────────── */

/**
 * Append-only ledger: the only way stock changes. 'in'/'out' move the level by
 * |delta|; 'adjust' sets it to `resultingQuantity` directly. The level update
 * happens in the same transaction as the ledger row, and the level can never
 * go negative — both guarded in-transaction against races.
 */
export async function createMovement(
  user: AuthedUser,
  itemId: string,
  input: { type: 'in' | 'out' | 'adjust'; delta?: number; resultingQuantity?: number; reason: string; ticketId?: string },
) {
  const item = await prisma.inventoryItem.findUnique({ where: { id: itemId } });
  if (!item) throw notFound('Inventory item not found');

  let delta: number;
  if (input.type === 'in' || input.type === 'out') {
    if (!input.delta || input.delta <= 0) throw badRequest('in/out movements need a positive delta');
    delta = input.type === 'out' ? -input.delta : input.delta;
  } else {
    if (input.resultingQuantity === undefined || input.resultingQuantity < 0) {
      throw badRequest('adjust movements need a non-negative resultingQuantity');
    }
    delta = input.resultingQuantity - item.quantity;
  }

  const { created, updated } = await prisma.$transaction(async (tx) => {
    const current = await tx.inventoryItem.findUniqueOrThrow({ where: { id: itemId }, select: { quantity: true, reorderPoint: true } });
    const resulting = current.quantity + delta;
    if (resulting < 0) throw conflict(`Stock would go negative: ${current.quantity} on hand, ${delta} requested`);

    await tx.stockMovement.create({
      data: {
        itemId,
        type: input.type,
        delta,
        resultingQuantity: resulting,
        reason: input.reason,
        ticketId: input.ticketId,
        createdById: user.id,
      },
    });
    await tx.inventoryItem.update({ where: { id: itemId }, data: { quantity: resulting } });
    const updatedItem = await tx.inventoryItem.findUniqueOrThrow({ where: { id: itemId } });
    const created = await tx.stockMovement.findFirstOrThrow({ where: { itemId, delta, resultingQuantity: resulting }, orderBy: { createdAt: 'desc' } });
    return { created, updated: updatedItem };
  });

  // Reorder alert when stock crosses down to the reorder point.
  if (updated.quantity <= updated.reorderPoint) {
    await Promise.all(
      (['it_manager', 'it_admin'] as const).map((role) =>
        notifyRole(role, {
          type: 'inventory_low_stock',
          title: 'Low stock',
          body: `"${updated.name}" is at ${updated.quantity} ${updated.unit} (reorder point ${updated.reorderPoint}).`,
          dedupeKey: `inventory_low_stock:${itemId}:${updated.quantity}`,
        }),
      ),
    );
  }

  await recordAudit({
    actorId: user.id,
    action: 'inventory.stock_moved',
    targetType: 'inventory_item',
    targetId: itemId,
    meta: { movementId: created.id, type: input.type, delta, resultingQuantity: updated.quantity },
  });

  return created;
}

export async function listMovements(itemId: string, opts: { page: number; limit: number }) {
  const [data, total] = await Promise.all([
    prisma.stockMovement.findMany({
      where: { itemId },
      orderBy: { createdAt: 'desc' },
      include: { createdBy: { select: { id: true, name: true } } },
      skip: (opts.page - 1) * opts.limit,
      take: opts.limit,
    }),
    prisma.stockMovement.count({ where: { itemId } }),
  ]);
  return { data, meta: { total, page: opts.page, limit: opts.limit, pages: Math.ceil(total / opts.limit) } };
}
