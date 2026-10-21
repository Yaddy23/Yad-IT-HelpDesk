import type { NextFunction, Request, Response } from 'express';

import { createUserSchema, listUsersSchema, resetPasswordSchema, updateUserSchema } from './users.validators.js';
import * as usersService from './users.service.js';
import { toAuthed } from '../../core/request.js';

export async function list(req: Request, res: Response, next: NextFunction) {
  try {
    const parsed = listUsersSchema.parse({ query: req.query });
    res.json(await usersService.listUsers(parsed.query));
  } catch (e) {
    next(e);
  }
}

export async function get(req: Request, res: Response, next: NextFunction) {
  try {
    res.json({ data: await usersService.getUser(String(req.params.id)) });
  } catch (e) {
    next(e);
  }
}

export async function create(req: Request, res: Response, next: NextFunction) {
  try {
    const parsed = createUserSchema.parse({ body: req.body });
    res.status(201).json({ data: await usersService.createUser(toAuthed(req), parsed.body) });
  } catch (e) {
    next(e);
  }
}

export async function update(req: Request, res: Response, next: NextFunction) {
  try {
    const parsed = updateUserSchema.parse({ params: req.params, body: req.body });
    res.json({ data: await usersService.updateUser(toAuthed(req), parsed.params.id, parsed.body) });
  } catch (e) {
    next(e);
  }
}

export async function resetPassword(req: Request, res: Response, next: NextFunction) {
  try {
    const parsed = resetPasswordSchema.parse({ params: req.params, body: req.body });
    await usersService.resetPassword(toAuthed(req), parsed.params.id, parsed.body.newPassword);
    res.status(204).send();
  } catch (e) {
    next(e);
  }
}

export async function options(_req: Request, res: Response, next: NextFunction) {
  try {
    res.json({ data: await usersService.orgOptions() });
  } catch (e) {
    next(e);
  }
}
