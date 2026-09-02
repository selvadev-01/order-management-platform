/**
 * Product and category routes.
 *
 * Read routes are public (US-PROD-1 AC5, US-PDP-1 AC5). Every write route
 * carries both authenticate and requireRole(ADMIN) — the server check that
 * makes US-ADMIN-1 AC4 hold regardless of what the UI shows.
 */
import { Router } from 'express';
import { asyncHandler, validate, authenticate, requireRole, Role, paginationQuery } from '@oms/shared';
import {
  listProductsSchema,
  productIdSchema,
  createProductSchema,
  updateProductSchema,
  updateStockSchema,
  reserveStockSchema,
  createCategorySchema,
} from './product.schemas.js';

export function buildRoutes({ controllers, config }) {
  const router = Router();
  const requireAuth = authenticate(config.JWT_SECRET);
  const requireAdmin = [requireAuth, requireRole(Role.ADMIN)];

  // --- Public reads -------------------------------------------------------
  router.get('/products', validate(listProductsSchema), asyncHandler(controllers.listProducts));
  router.get('/categories', asyncHandler(controllers.listCategories));

  // --- Admin writes -------------------------------------------------------
  // Registered BEFORE /products/:id so 'admin' is not parsed as an id.
  router.get(
    '/products/admin/all',
    ...requireAdmin,
    validate({ query: paginationQuery }),
    asyncHandler(controllers.listProductsAdmin),
  );

  router.post(
    '/products',
    ...requireAdmin,
    validate(createProductSchema),
    asyncHandler(controllers.createProduct),
  );

  router.put(
    '/products/:id',
    ...requireAdmin,
    validate(updateProductSchema),
    asyncHandler(controllers.updateProduct),
  );

  router.patch(
    '/products/:id/stock',
    ...requireAdmin,
    validate(updateStockSchema),
    asyncHandler(controllers.updateStock),
  );

  router.delete(
    '/products/:id',
    ...requireAdmin,
    validate(productIdSchema),
    asyncHandler(controllers.deleteProduct),
  );

  router.post(
    '/categories',
    ...requireAdmin,
    validate(createCategorySchema),
    asyncHandler(controllers.createCategory),
  );

  // --- Internal (service-to-service) --------------------------------------
  // Registered before /products/:id so 'stock' is not parsed as an id.
  router.post(
    '/products/stock/reserve',
    requireAuth,
    validate(reserveStockSchema),
    asyncHandler(controllers.reserveStock),
  );

  router.post(
    '/products/stock/release',
    requireAuth,
    validate(reserveStockSchema),
    asyncHandler(controllers.releaseStock),
  );

  router.get(
    '/products/:id/stock',
    requireAuth,
    validate(productIdSchema),
    asyncHandler(controllers.getStock),
  );

  // Public detail — last, so more specific paths above win.
  router.get('/products/:id', validate(productIdSchema), asyncHandler(controllers.getProduct));

  return router;
}
