/**
 * Payment routes.
 *
 * The webhook is PUBLIC — it carries no JWT, because the gateway cannot hold
 * one. Its HMAC signature is the authentication, verified in the service
 * before anything is parsed or trusted.
 */
import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, validate, authenticate, requireRole, Role } from '@oms/shared';

const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, 'Malformed identifier');

const createPaymentSchema = { body: z.object({ orderId: objectId }) };
const orderIdParamSchema = { params: z.object({ orderId: objectId }) };

export function buildRoutes({ controllers, config }) {
  const router = Router();
  const requireAuth = authenticate(config.JWT_SECRET);

  router.post(
    '/payments/create',
    requireAuth,
    validate(createPaymentSchema),
    asyncHandler(controllers.createPayment),
  );

  /**
   * Webhook — no auth middleware by design.
   *
   * express.raw() is applied to this exact path in the app factory, BEFORE the
   * global JSON parser, so req.body arrives as the untouched Buffer the HMAC
   * must be computed over.
   */
  router.post('/payments/webhook', asyncHandler(controllers.webhook));

  router.get(
    '/payments/:orderId',
    requireAuth,
    validate(orderIdParamSchema),
    asyncHandler(controllers.getPayment),
  );

  // Development helper: emit a correctly-signed webhook so the verification
  // path can be exercised without a live gateway. Refuses to exist in
  // production, and requires an admin token.
  if (config.NODE_ENV !== 'production') {
    router.post(
      '/payments/mock/settle',
      requireAuth,
      requireRole(Role.ADMIN),
      validate({ body: z.object({ orderId: objectId, outcome: z.enum(['captured', 'failed']).default('captured') }) }),
      asyncHandler(controllers.mockSettle),
    );
  }

  return router;
}
