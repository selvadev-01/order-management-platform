/**
 * Request schemas (US-SYS-2, US-AUTH-1 AC3).
 *
 * Zod strips unknown keys, so a `role` field smuggled into a registration body
 * is discarded before the controller sees it. Without this, any visitor could
 * self-promote to ADMIN — the reason US-AUTH-1's technical notes call it out.
 */
import { z } from 'zod';

const email = z
  .string()
  .trim()
  .toLowerCase()
  .min(1, 'Email is required')
  .email('Must be a valid email address')
  .max(160, 'Email is too long');

/**
 * Password rules are enforced here AND mirrored in the UI. The server check is
 * the real one — the client cannot be trusted to have run its own.
 */
const password = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .max(128, 'Password must be at most 128 characters')
  .regex(/[a-z]/, 'Password must contain a lowercase letter')
  .regex(/[A-Z]/, 'Password must contain an uppercase letter')
  .regex(/[0-9]/, 'Password must contain a number');

export const registerSchema = {
  body: z.object({
    name: z
      .string()
      .trim()
      .min(2, 'Name must be at least 2 characters')
      .max(80, 'Name must be at most 80 characters'),
    email,
    password,
  }),
};

/**
 * Login deliberately does NOT apply the password complexity rules. Doing so
 * would reveal, through validation errors, whether a submitted password could
 * possibly be a real one.
 */
export const loginSchema = {
  body: z.object({
    email,
    password: z.string().min(1, 'Password is required'),
  }),
};
