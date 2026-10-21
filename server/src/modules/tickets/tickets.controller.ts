import type { Request, Response, NextFunction } from 'express';

import { toAuthed } from '../../core/request.js';
import * as service from './tickets.service.js';
import * as attachments from './attachments.service.js';
import {
  addCommentSchema,
  assignTicketSchema,
  createTicketSchema,
  listTicketsSchema,
  overridePrioritySchema,
  transitionTicketSchema,
} from './tickets.validators.js';

// Express 5 types req.params.id as string | string[] — normalise with String().
const idOf = (req: Request) => String(req.params.id);

export async function create(req: Request, res: Response, next: NextFunction) {
  try {
    const parsed = createTicketSchema.parse({ body: req.body });
    const ticket = await service.createTicket(toAuthed(req).user!, parsed.body);
    res.status(201).json({ data: ticket });
  } catch (e) {
    next(e);
  }
}

export async function list(req: Request, res: Response, next: NextFunction) {
  try {
    const parsed = listTicketsSchema.parse({ query: req.query });
    const result = await service.listTickets(toAuthed(req).user!, parsed.query);
    res.json({
      data: result.items,
      meta: { total: result.total, page: result.page, limit: result.limit, pages: result.pages },
    });
  } catch (e) {
    next(e);
  }
}

export async function get(req: Request, res: Response, next: NextFunction) {
  try {
    const ticket = await service.getTicket(toAuthed(req).user!, idOf(req));
    res.json({ data: ticket });
  } catch (e) {
    next(e);
  }
}

export async function assign(req: Request, res: Response, next: NextFunction) {
  try {
    const parsed = assignTicketSchema.parse({ params: req.params, body: req.body });
    const ticket = await service.assignTicket(toAuthed(req).user!, String(parsed.params.id), parsed.body);
    res.json({ data: ticket });
  } catch (e) {
    next(e);
  }
}

export async function transition(req: Request, res: Response, next: NextFunction) {
  try {
    const parsed = transitionTicketSchema.parse({ params: req.params, body: req.body });
    const ticket = await service.transitionTicket(toAuthed(req).user!, String(parsed.params.id), parsed.body);
    res.json({ data: ticket });
  } catch (e) {
    next(e);
  }
}

export async function overridePriority(req: Request, res: Response, next: NextFunction) {
  try {
    const parsed = overridePrioritySchema.parse({ params: req.params, body: req.body });
    const ticket = await service.overridePriority(toAuthed(req).user!, String(parsed.params.id), parsed.body);
    res.json({ data: ticket });
  } catch (e) {
    next(e);
  }
}

export async function addComment(req: Request, res: Response, next: NextFunction) {
  try {
    const parsed = addCommentSchema.parse({ params: req.params, body: req.body });
    const comment = await service.addComment(toAuthed(req).user!, String(parsed.params.id), parsed.body);
    res.status(201).json({ data: comment });
  } catch (e) {
    next(e);
  }
}

export async function queues(_req: Request, res: Response, next: NextFunction) {
  try {
    const counts = await service.queueCounts(toAuthed(_req).user!);
    res.json({ data: counts });
  } catch (e) {
    next(e);
  }
}

/* ── Attachments ─────────────────────────────────────────────────────────── */

export async function uploadAttachment(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.file) {
      return res.status(400).json({ error: { code: 'FILE_REQUIRED', message: 'A file is required (multipart field "file")' } });
    }
    const attachment = await attachments.uploadAttachment(toAuthed(req).user!, idOf(req), {
      originalname: req.file.originalname,
      mimetype: req.file.mimetype,
      size: req.file.size,
      buffer: req.file.buffer,
    });
    res.status(201).json({ data: attachment });
  } catch (e) {
    next(e);
  }
}

export async function listAttachments(req: Request, res: Response, next: NextFunction) {
  try {
    const attachmentsList = await attachments.listAttachments(toAuthed(req).user!, idOf(req));
    res.json({ data: attachmentsList });
  } catch (e) {
    next(e);
  }
}

export async function downloadAttachment(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await attachments.getAttachmentDownloadUrl(
      toAuthed(req).user!,
      idOf(req),
      String(req.params.attachmentId),
    );
    res.json({ data: result });
  } catch (e) {
    next(e);
  }
}
