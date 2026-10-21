import type { Request } from 'express';

export interface AuthedUser {
  id: string;
  email: string;
  name: string;
  roles: string[];
  employeeId?: string | null;
}

/** Request after requireAuth has run (global Express.user augmentation in core/auth.ts). */
export type AuthedRequest = Request & { user?: AuthedUser };

export function toAuthed(req: Request): AuthedRequest {
  return req as AuthedRequest;
}
