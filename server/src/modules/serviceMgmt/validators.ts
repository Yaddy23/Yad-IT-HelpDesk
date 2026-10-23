import { z } from 'zod';

/**
 * Service-catalog form schemas and the answer validator. The form schema is
 * the one genuinely schemaless place in the data model (jsonb), so its shape
 * is validated here and answers are checked against it at submission time.
 */

export const FORM_FIELD_TYPES = ['text', 'textarea', 'number', 'date', 'select', 'checkbox'] as const;
export type FormFieldType = (typeof FORM_FIELD_TYPES)[number];

export interface FormField {
  name: string;
  label: string;
  type: FormFieldType;
  required?: boolean;
  options?: string[];
  help?: string;
}

export const formFieldSchema = z
  .object({
    name: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]{0,39}$/, 'Field name must start with a letter and use letters, digits or underscores'),
    label: z.string().min(1).max(120),
    type: z.enum(FORM_FIELD_TYPES),
    required: z.boolean().optional().default(false),
    options: z.array(z.string().min(1).max(120)).max(50).optional(),
    help: z.string().max(300).optional(),
  })
  .superRefine((f, ctx) => {
    if (f.type === 'select' && (!f.options || f.options.length === 0)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Select fields need at least one option', path: ['options'] });
    }
  });

export const formSchemaSchema = z
  .array(formFieldSchema)
  .max(50)
  .superRefine((fields, ctx) => {
    const seen = new Set<string>();
    fields.forEach((f, i) => {
      if (seen.has(f.name)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Duplicate field name: ${f.name}`, path: [i, 'name'] });
      }
      seen.add(f.name);
    });
  });

export type AnswerErrors = Record<string, string>;

/**
 * Validates submitted answers against a catalog item's form schema. Returns
 * a per-field error map, or null when everything checks out. Unknown keys are
 * rejected — an answer for a field the form does not define is a client bug
 * (or tampering), never silently ignored.
 */
export function validateAnswers(schema: FormField[], answers: Record<string, unknown>): AnswerErrors | null {
  const errors: AnswerErrors = {};
  for (const field of schema) {
    const v = answers[field.name];
    const empty = v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0);
    if (empty) {
      if (field.required) errors[field.name] = 'This field is required';
      continue;
    }
    switch (field.type) {
      case 'text':
        if (typeof v !== 'string') errors[field.name] = 'Must be text';
        else if (v.length > 200) errors[field.name] = 'Maximum 200 characters';
        break;
      case 'textarea':
        if (typeof v !== 'string') errors[field.name] = 'Must be text';
        else if (v.length > 5000) errors[field.name] = 'Maximum 5000 characters';
        break;
      case 'number': {
        const n = typeof v === 'string' ? Number(v) : v;
        if (typeof n !== 'number' || !Number.isFinite(n)) errors[field.name] = 'Must be a number';
        break;
      }
      case 'date':
        if (typeof v !== 'string' || Number.isNaN(Date.parse(v))) errors[field.name] = 'Must be a valid date';
        break;
      case 'select':
        if (typeof v !== 'string' || !field.options?.includes(v)) errors[field.name] = 'Choose one of the listed options';
        break;
      case 'checkbox':
        if (typeof v !== 'boolean') errors[field.name] = 'Must be true or false';
        break;
    }
  }
  const known = new Set(schema.map((f) => f.name));
  for (const key of Object.keys(answers)) {
    if (!known.has(key)) errors[key] = 'Unknown field';
  }
  return Object.keys(errors).length ? errors : null;
}

/* ── Approval rule steps ───────────────────────────────────────────────────── */

export const approverSpecSchema = z
  .object({
    type: z.enum(['user', 'manager', 'role']),
    value: z.string().min(1).max(80).optional(),
  })
  .superRefine((a, ctx) => {
    if ((a.type === 'user' || a.type === 'role') && !a.value) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `approver type "${a.type}" requires a value`, path: ['value'] });
    }
  });

export const stepSpecSchema = z.object({
  name: z.string().min(1).max(80),
  mode: z.enum(['single', 'all', 'any', 'sequential']),
  approver: approverSpecSchema,
  deadlineHours: z.number().int().positive().max(24 * 90).optional(),
});

export const stepsSpecSchema = z.array(stepSpecSchema).min(1).max(10);

export const ROLES_FOR_ELIGIBILITY = ['super_admin', 'it_admin', 'it_manager', 'it_technician', 'employee', 'approver'] as const;

export const eligibilitySchema = z
  .object({
    departments: z.array(z.string().min(1).max(40)).max(50).optional(),
    locations: z.array(z.string().min(1).max(40)).max(50).optional(),
    roles: z.array(z.enum(ROLES_FOR_ELIGIBILITY)).max(ROLES_FOR_ELIGIBILITY.length).optional(),
  })
  .optional();

/* ── Catalog payloads ──────────────────────────────────────────────────────── */

export const catalogCreateSchema = z.object({
  body: z.object({
    name: z.string().min(2).max(120),
    description: z.string().max(2000).nullable().optional(),
    category: z.string().max(60).nullable().optional(),
    icon: z.string().max(40).nullable().optional(),
    sortOrder: z.number().int().min(0).max(10000).default(0),
    active: z.boolean().default(true),
    eligibility: eligibilitySchema,
    formSchema: formSchemaSchema,
  }),
});

export const catalogUpdateSchema = z.object({
  params: z.object({ id: z.string().min(1) }),
  body: catalogCreateSchema.shape.body.partial(),
});

export const ruleUpsertSchema = z.object({
  params: z.object({ id: z.string().min(1) }),
  body: z.object({
    name: z.string().min(2).max(120).optional(),
    steps: stepsSpecSchema,
    active: z.boolean().default(true),
  }),
});
