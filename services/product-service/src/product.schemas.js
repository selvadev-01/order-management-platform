/**
 * Product request schemas (US-SYS-2).
 *
 * Query values are coerced and bounded here, which is what turns `?page=abc`
 * and `?limit=5000` into safe values rather than driver errors or unbounded
 * reads (US-PROD-4 edge cases).
 */
import { z } from 'zod';
import { paginationQuery } from '@oms/shared';

const objectId = z
  .string()
  .regex(/^[0-9a-fA-F]{24}$/, 'Malformed identifier');

/**
 * Search terms are validated as plain strings and bound as query parameters,
 * never spliced into a query object — this is what closes off NoSQL operator
 * injection via `{"$ne": null}` in the search box (US-PROD-2 edge case).
 */
export const listProductsSchema = {
  query: paginationQuery.extend({
    search: z.string().trim().max(120, 'Search term is too long').optional(),
    category: objectId.optional(),
    sort: z.enum(['newest', 'price_asc', 'price_desc', 'relevance']).default('newest'),
  }),
};

export const productIdSchema = {
  params: z.object({ id: objectId }),
};

const priceMinor = z.coerce
  .number()
  .int('Price must be an integer in minor units')
  .positive('Price must be greater than zero')
  .max(100_000_000, 'Price is unrealistically high');

const stock = z.coerce
  .number()
  .int('Stock must be a whole number')
  .min(0, 'Stock cannot be negative')
  .max(1_000_000, 'Stock is unrealistically high');

export const createProductSchema = {
  body: z.object({
    name: z.string().trim().min(2, 'Name must be at least 2 characters').max(140),
    description: z.string().trim().min(1, 'Description is required').max(2000),
    price: priceMinor,
    stock: stock.default(0),
    category: objectId,
    images: z.array(z.string().url('Each image must be a valid URL')).max(8).default([]),
  }),
};

export const updateProductSchema = {
  params: z.object({ id: objectId }),
  body: z
    .object({
      name: z.string().trim().min(2).max(140).optional(),
      description: z.string().trim().min(1).max(2000).optional(),
      price: priceMinor.optional(),
      stock: stock.optional(),
      category: objectId.optional(),
      images: z.array(z.string().url()).max(8).optional(),
    })
    .refine((b) => Object.keys(b).length > 0, {
      message: 'Provide at least one field to update',
    }),
};

export const updateStockSchema = {
  params: z.object({ id: objectId }),
  body: z.object({ stock }),
};

/**
 * Internal stock reservation (service-to-service).
 *
 * A positive quantity reserves (decrements); the release path sends the same
 * lines back to restore them. Quantities are bounded so a malformed or hostile
 * payload cannot swing stock arbitrarily.
 */
export const reserveStockSchema = {
  body: z.object({
    items: z
      .array(
        z.object({
          productId: objectId,
          quantity: z.coerce.number().int().positive().max(1000),
        }),
      )
      .min(1, 'At least one item is required')
      .max(100),
  }),
};

export const createCategorySchema = {
  body: z.object({
    name: z.string().trim().min(2, 'Name must be at least 2 characters').max(60),
  }),
};
