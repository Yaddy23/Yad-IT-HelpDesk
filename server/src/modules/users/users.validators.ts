import { z } from 'zod';

const roleEnum = z.enum([
  'super_admin',
  'it_admin',
  'it_manager',
  'it_technician',
  'employee',
  'approver',
] as const);

/**
 * An empty string from a form's optional select/text field means "no value".
 * Mapping it to null (rather than passing '' through to a foreign key) is what
 * lets an admin clear a department, location, manager or job title.
 */
const optionalText = z
  .string()
  .max(120)
  .optional()
  .transform((v) => (v === '' ? null : v));

export const createUserSchema = z.object({
  body: z.object({
    email: z.string().email(),
    name: z.string().min(2).max(120),
    password: z.string().min(10),
    roles: z.array(roleEnum).min(1),
    jobTitle: optionalText,
    departmentId: optionalText,
    locationId: optionalText,
    managerEmployeeId: optionalText,
  }),
});

export const updateUserSchema = z.object({
  params: z.object({ id: z.string().min(1) }),
  body: z
    .object({
      name: z.string().min(2).max(120).optional(),
      roles: z.array(roleEnum).min(1).optional(),
      active: z.boolean().optional(),
      jobTitle: optionalText,
      departmentId: optionalText,
      locationId: optionalText,
      managerEmployeeId: optionalText,
    })
    .refine((b) => Object.keys(b).length > 0, { message: 'No changes provided' }),
});

export const resetPasswordSchema = z.object({
  params: z.object({ id: z.string().min(1) }),
  body: z.object({ newPassword: z.string().min(10) }),
});

export const listUsersSchema = z.object({
  query: z.object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(25),
    role: roleEnum.optional(),
    q: z.string().max(120).optional(),
  }),
});
