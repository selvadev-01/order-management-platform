/**
 * Auth routes.
 *
 * Route protection is declared per route group rather than checked inside
 * controllers, so a new endpoint cannot be left unguarded by omission
 * (US-AUTH-5).
 */
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { asyncHandler, validate, authenticate } from '@oms/shared';
import { registerSchema, loginSchema } from './auth.schemas.js';
import { register, login, me, verify } from './auth.controller.js';
import { config } from './config.js';

export function buildRoutes() {
  const router = Router();
  const requireAuth = authenticate(config.JWT_SECRET);

  /**
   * Credential endpoints get a tighter limit than the service default — these
   * are the routes worth brute-forcing (US-AUTH-2 edge case, US-SYS-7 AC1).
   */
  const credentialLimiter = rateLimit({
    windowMs: config.RATE_LIMIT_WINDOW_MS,
    max: config.AUTH_RATE_LIMIT_MAX,
    standardHeaders: true,
    legacyHeaders: false,
    // Count failures only, so a legitimate user is not locked out by
    // successful logins across a shared IP.
    skipSuccessfulRequests: true,
    message: {
      error: {
        message: 'Too many attempts, please wait before trying again',
        code: 'RATE_LIMITED',
      },
    },
  });

  router.post(
    '/auth/register',
    credentialLimiter,
    validate(registerSchema),
    asyncHandler(register),
  );

  router.post('/auth/login', credentialLimiter, validate(loginSchema), asyncHandler(login));

  router.get('/auth/verify', requireAuth, asyncHandler(verify));
  router.get('/users/me', requireAuth, asyncHandler(me));

  return router;
}
