import { recordAudit } from '../../core/audit.js';
import { badRequest, conflict, notFound } from '../../core/errors.js';
import type { AuthedUser } from '../../core/request.js';
import { prisma } from '../../prisma/client.js';

/**
 * A stock-take: opening a session snapshots the in-scope assets into items
 * (unchecked). Marking an asset that wasn't snapshotted creates an
 * 'unexpected' item. Closing freezes the session — no more marks.
 */

const ASSET_INCLUDE = { select: { id: true, number: true, name: true, status: true } };

async function scopeWhere(scopeType?: string | null, scopeId?: string | null) {
  const base = { status: { notIn: ['retired', 'lost'] as Array<'retired' | 'lost'> } };
  if (scopeType === 'location' && scopeId) return { ...base, locationId: scopeId };
  if (scopeType === 'department' && scopeId) return { ...base, departmentId: scopeId };
  return base; // 'all' or unspecified
}

export async function createSession(
  user: AuthedUser,
  input: { name: string; scopeType?: 'location' | 'department' | 'all'; scopeId?: string },
) {
  const where = await scopeWhere(input.scopeType, input.scopeId);
  const assets = await prisma.asset.findMany({ where, select: { id: true } });

  const session = await prisma.assetAuditSession.create({
    data: {
      name: input.name,
      scopeType: input.scopeType,
      scopeId: input.scopeId,
      startedById: user.id,
      items: { create: assets.map((a) => ({ assetId: a.id })) },
    },
    include: { items: true },
  });

  await recordAudit({
    actorId: user.id,
    action: 'audit.session_opened',
    targetType: 'asset_audit',
    targetId: session.id,
    meta: { name: session.name, scopeType: session.scopeType, itemCount: session.items.length },
  });
  return session;
}

export async function listSessions(opts: { status?: string; page: number; limit: number }) {
  const where = opts.status ? { status: opts.status } : {};
  const [data, total] = await Promise.all([
    prisma.assetAuditSession.findMany({
      where,
      include: { startedBy: { select: { id: true, name: true } }, _count: { select: { items: true } } },
      orderBy: { startedAt: 'desc' },
      skip: (opts.page - 1) * opts.limit,
      take: opts.limit,
    }),
    prisma.assetAuditSession.count({ where }),
  ]);
  return {
    data: data.map((s) => ({ ...s, itemCount: s._count.items, _count: undefined })),
    meta: { total, page: opts.page, limit: opts.limit, pages: Math.ceil(total / opts.limit) },
  };
}

export async function getSession(id: string) {
  const session = await prisma.assetAuditSession.findUnique({
    where: { id },
    include: {
      startedBy: { select: { id: true, name: true } },
      closedBy: { select: { id: true, name: true } },
      items: {
        include: { asset: ASSET_INCLUDE, checkedBy: { select: { id: true, name: true } } },
        orderBy: [{ status: 'asc' }, { asset: { number: 'asc' } }],
      },
    },
  });
  if (!session) throw notFound('Audit session not found');

  const counts = { found: 0, missing: 0, unexpected: 0, unchecked: 0 };
  for (const item of session.items) counts[item.status ?? 'unchecked'] += 1;
  return { ...session, counts };
}

export async function markItem(
  user: AuthedUser,
  sessionId: string,
  assetId: string,
  input: { status: 'found' | 'missing' | 'unexpected'; note?: string },
) {
  const session = await prisma.assetAuditSession.findUnique({ where: { id: sessionId } });
  if (!session) throw notFound('Audit session not found');
  if (session.status !== 'open') throw conflict('Audit session is closed');
  const asset = await prisma.asset.findUnique({ where: { id: assetId }, select: { id: true } });
  if (!asset) throw notFound('Asset not found');

  const existing = await prisma.assetAuditItem.findUnique({ where: { sessionId_assetId: { sessionId, assetId } } });
  if (!existing && input.status !== 'unexpected') {
    throw badRequest('Asset is not in this audit scope; only "unexpected" findings can be added');
  }

  const item = existing
    ? await prisma.assetAuditItem.update({
        where: { id: existing.id },
        data: { status: input.status, note: input.note, checkedById: user.id, checkedAt: new Date() },
        include: { asset: ASSET_INCLUDE, checkedBy: { select: { id: true, name: true } } },
      })
    : await prisma.assetAuditItem.create({
        data: { sessionId, assetId, status: input.status, note: input.note, checkedById: user.id, checkedAt: new Date() },
        include: { asset: ASSET_INCLUDE, checkedBy: { select: { id: true, name: true } } },
      });

  await recordAudit({ actorId: user.id, action: 'audit.item_marked', targetType: 'asset_audit', targetId: sessionId, meta: { assetId, status: input.status } });
  return item;
}

export async function closeSession(user: AuthedUser, id: string) {
  const session = await prisma.assetAuditSession.findUnique({ where: { id } });
  if (!session) throw notFound('Audit session not found');
  if (session.status === 'closed') throw badRequest('Audit session already closed');

  const closed = await prisma.assetAuditSession.update({
    where: { id },
    data: { status: 'closed', closedAt: new Date(), closedById: user.id },
    include: {
      startedBy: { select: { id: true, name: true } },
      closedBy: { select: { id: true, name: true } },
      items: { include: { asset: ASSET_INCLUDE, checkedBy: { select: { id: true, name: true } } } },
    },
  });

  const counts = { found: 0, missing: 0, unexpected: 0, unchecked: 0 };
  for (const item of closed.items) counts[item.status ?? 'unchecked'] += 1;

  await recordAudit({ actorId: user.id, action: 'audit.session_closed', targetType: 'asset_audit', targetId: id, meta: counts });
  return { ...closed, counts };
}
