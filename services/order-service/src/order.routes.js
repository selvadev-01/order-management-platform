/**
 * Cart and order routes.
 *
 * Every route requires authentication — there is no anonymous cart. Admin
 * routes additionally require the ADMIN role.
 */
import { Router } from 'express';
import { asyncHandler, validate, authenticate, requireRole, Role } from '@oms/shared';
import {
  addToCartSchema,
  cartItemParamSchema,
  setQuantitySchema,
  createOrderSchema,
  orderIdSchema,
  listOrdersSchema,
  listAllOrdersSchema,
  updateStatusSchema,
  markPaidSchema,
} from './order.schemas.js';

export function buildRoutes({ controllers, config }) {
  const router = Router();
  const requireAuth = authenticate(config.JWT_SECRET);
  const requireAdmin = [requireAuth, requireRole(Role.ADMIN)];

  // --- Cart ---------------------------------------------------------------
  router.get('/cart', requireAuth, asyncHandler(controllers.getCart));
  router.post('/cart', requireAuth, validate(addToCartSchema), asyncHandler(controllers.addToCart));
  router.patch(
    '/cart/:productId',
    requireAuth,
    validate(setQuantitySchema),
    asyncHandler(controllers.setQuantity),
  );
  router.delete(
    '/cart/:productId',
    requireAuth,
    validate(cartItemParamSchema),
    asyncHandler(controllers.removeFromCart),
  );

  // --- Orders -------------------------------------------------------------
  // Admin routes registered before /orders/:id so 'admin' is not read as an id.
  router.get(
    '/orders/admin',
    ...requireAdmin,
    validate(listAllOrdersSchema),
    asyncHandler(controllers.listAllOrders),
  );

  router.post('/orders', requireAuth, validate(createOrderSchema), asyncHandler(controllers.createOrder));
  router.get('/orders', requireAuth, validate(listOrdersSchema), asyncHandler(controllers.listMyOrders));

  router.patch(
    '/orders/:id/status',
    ...requireAdmin,
    validate(updateStatusSchema),
    asyncHandler(controllers.updateStatus),
  );

  // Internal: Payment Service → Order Service.
  router.patch(
    '/orders/:id/payment',
    ...requireAdmin,
    validate(markPaidSchema),
    asyncHandler(controllers.markPayment),
  );

  router.get('/orders/:id', requireAuth, validate(orderIdSchema), asyncHandler(controllers.getOrder));

  return router;
}
