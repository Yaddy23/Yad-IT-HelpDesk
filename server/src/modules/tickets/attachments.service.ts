import crypto from 'node:crypto';

import { recordAudit } from '../../core/audit.js';
import { badRequest, notFound } from '../../core/errors.js';
import type { AuthedUser } from '../../core/request.js';
import { prisma } from '../../prisma/client.js';
import { env } from '../../config/env.js';
import { assertCanView } from './tickets.service.js';
import { createSignedUrl, deleteObject, putObject } from './storage.js';

/**
 * Ticket attachments. Bytes go to a PRIVATE Supabase Storage bucket; the DB
 * row is the metadata record. Anyone who can view the ticket can attach and
 * download; every download is audited and delivered via a short-lived signed
 * URL (never a public object URL).
 */

/** Download validity — short on purpose; clients re-request for a fresh one. */
const SIGNED_URL_TTL_SECONDS = 60;

/** Executable/script extensions are rejected regardless of declared MIME type. */
const BLOCKED_EXTENSIONS = [
  '.exe', '.msi', '.bat', '.cmd', '.com', '.scr', '.ps1', '.vbs', '.js', '.jar',
  '.sh', '.app', '.deb', '.rpm', '.apk', '.dll', '.sys',
];

export async function uploadAttachment(
  user: AuthedUser,
  ticketId: string,
  file: { originalname: string; mimetype: string; size: number; buffer: Buffer },
) {
  const ticket = await prisma.ticket.findUnique({ where: { id: ticketId } });
  if (!ticket) throw notFound('Ticket not found');
  await assertCanView(user, ticket);

  if (file.size === 0) throw badRequest('File is empty', 'EMPTY_FILE');
  if (file.size > env.ATTACHMENTS_MAX_MB * 1024 * 1024) {
    throw badRequest(`File exceeds the ${env.ATTACHMENTS_MAX_MB} MB limit`, 'FILE_TOO_LARGE');
  }
  const filename = sanitizeFilename(file.originalname);
  if (BLOCKED_EXTENSIONS.some((ext) => filename.toLowerCase().endsWith(ext))) {
    throw badRequest('Executable files cannot be attached', 'FILE_TYPE_BLOCKED');
  }

  const storagePath = `tickets/${ticketId}/${crypto.randomUUID()}/${filename}`;

  // Upload first, then record — a failed insert cleans the orphan object up.
  await putObject(storagePath, file.buffer, file.mimetype || 'application/octet-stream');
  try {
    const attachment = await prisma.attachment.create({
      data: {
        ticketId,
        filename,
        mimeType: file.mimetype || 'application/octet-stream',
        sizeBytes: file.size,
        storagePath,
        uploadedById: user.id,
      },
      include: { uploadedBy: { select: { id: true, name: true } } },
    });

    await prisma.ticketActivity.create({
      data: {
        ticketId,
        actorId: user.id,
        action: 'attachment_added',
        detail: { filename, sizeBytes: file.size },
      },
    });
    await recordAudit({
      actorId: user.id,
      actorEmail: user.email,
      action: 'ticket.attachment_uploaded',
      targetType: 'ticket',
      targetId: ticketId,
      meta: { number: ticket.number, attachmentId: attachment.id, filename },
    });
    return attachment;
  } catch (err) {
    await deleteObject(storagePath);
    throw err;
  }
}

export async function listAttachments(user: AuthedUser, ticketId: string) {
  const ticket = await prisma.ticket.findUnique({ where: { id: ticketId } });
  if (!ticket) throw notFound('Ticket not found');
  await assertCanView(user, ticket);
  return prisma.attachment.findMany({
    where: { ticketId },
    orderBy: { createdAt: 'desc' },
    include: { uploadedBy: { select: { id: true, name: true } } },
  });
}

/** Returns a short-lived signed URL after an authorization + audit pass. */
export async function getAttachmentDownloadUrl(user: AuthedUser, ticketId: string, attachmentId: string) {
  const attachment = await prisma.attachment.findUnique({
    where: { id: attachmentId },
    include: {
      ticket: { select: { id: true, number: true, requesterId: true, assigneeId: true, groupId: true } },
    },
  });
  if (!attachment || attachment.ticketId !== ticketId) throw notFound('Attachment not found');
  await assertCanView(user, attachment.ticket);

  const url = await createSignedUrl(attachment.storagePath, SIGNED_URL_TTL_SECONDS);
  await recordAudit({
    actorId: user.id,
    actorEmail: user.email,
    action: 'ticket.attachment_downloaded',
    targetType: 'ticket',
    targetId: ticketId,
    meta: { number: attachment.ticket.number, attachmentId, filename: attachment.filename },
  });
  return { url, expiresIn: SIGNED_URL_TTL_SECONDS, filename: attachment.filename };
}

/** Strips directory components and control characters from client filenames. */
function sanitizeFilename(name: string): string {
  const base = name.split(/[/\\]/).pop() ?? 'file';
  const cleaned = base.replace(/[\u0000-\u001f<>:"|?*]/g, '_').trim();
  return cleaned.length > 0 ? cleaned.slice(0, 200) : 'file';
}
