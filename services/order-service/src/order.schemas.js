/**
 * Cart and order request schemas (US-SYS-2).
 */
import { z } from 'zod';
import { paginationQuery, OrderStatus } from '@oms/shared';

const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, 'Malformed identifier');

const quantity = z.coerce
  .number()
  .int('Quantity must be a whole number')
  .min(1, 'Quantity must be at least 1')
  .max(999, 'Quantity is too large');

export const addToCartSchema = {
  body: z.object({
    productId: objectId,
    quantity: quantity.default(1),
  }),
};

export const cartItemParamSchema = {
  params: z.object({ productId: objectId }),
};

export const setQuantitySchema = {
  params: z.object({ productId: objectId }),
  body: z.object({ quantity }),
};

/**
 * Checkout body.
 *
 * Note there is no `totalAmount` field: the total is computed server-side from
 * live prices. A client cannot propose what it will pay (US-PAY-1).
 */
export const createOrderSchema = {
  body: z.object({
    customerInfo: z.object({
      name: z.string().trim().min(2, 'Name is required').max(80),
      email: z.string().trim().toLowerCase().email('Must be a valid email address'),
      phone: z
        .string()
        .trim()
        .min(7, 'Phone number is too short')
        .max(20, 'Phone number is too long')
        .regex(/^[0-9+\-\s()]+$/, 'Phone number contains invalid characters'),
    }),
    deliveryAddress: z.object({
      line1: z.string().trim().min(3, 'Address line 1 is required').max(120),
      line2: z.string().trim().max(120).optional().default(''),
      city: z.string().trim().min(2, 'City is required').max(60),
      state: z.string().trim().min(2, 'State is required').max(60),
      postalCode: z
        .string()
        .trim()
        .min(4, 'Postal code is too short')
        .max(12, 'Postal code is too long'),
      country: z.string().trim().min(2).max(60).default('India'),
    }),
  }),
};

export const orderIdSchema = {
  params: z.object({ id: objectId }),
};

export const listOrdersSchema = {
  query: paginationQuery,
};

export const listAllOrdersSchema = {
  query: paginationQuery.extend({
    status: z.enum(Object.values(OrderStatus)).optional(),
  }),
};

export const updateStatusSchema = {
  params: z.object({ id: objectId }),
  body: z.object({
    status: z.enum(Object.values(OrderStatus), {
      errorMap: () => ({ message: `Status must be one of: ${Object.values(OrderStatus).join(', ')}` }),
    }),
  }),
};

/** Internal — called by the Payment Service, not by clients. */
export const markPaidSchema = {
  params: z.object({ id: objectId }),
  body: z.object({
    paymentId: objectId.optional(),
    paymentStatus: z.enum(['Paid', 'Failed']),
  }),
};
