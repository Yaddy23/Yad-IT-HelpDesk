import { z } from 'zod';

export const bootstrapSchema = z.object({
  body: z.object({
    setupToken: z.string().min(1),
    email: z.string().email(),
    password: z
      .string()
      .min(10, 'Password must be at least 10 characters')
      .regex(/[A-Z]/, 'Password must contain an uppercase letter')
      .regex(/[a-z]/, 'Password must contain a lowercase letter')
      .regex(/[0-9]/, 'Password must contain a digit'),
    name: z.string().min(2).max(120),
  }),
});

export const loginSchema = z.object({
  body: z.object({
    email: z.string().email(),
    password: z.string().min(1),
  }),
});

export const refreshSchema = z.object({
  body: z.object({
    refreshToken: z.string().min(20),
  }),
});

export const logoutSchema = refreshSchema;
