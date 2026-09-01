/**
 * Pagination contract shared by every list endpoint (US-PROD-4).
 *
 * The response always carries metadata, so clients render controls from real
 * numbers rather than inferring from array length.
 */
import { z } from 'zod';
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from './constants.js';

/**
 * Query schema for paginated endpoints.
 *
 * `limit` is capped server-side so a client cannot request the whole
 * collection, and both values are coerced to integers — which is what turns
 * `?page=abc` and `?page=-3` into page 1 rather than a driver error.
 */
export const paginationQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
});

export function paginationToSkipLimit({ page, limit }) {
  return { skip: (page - 1) * limit, limit };
}

/**
 * Build the standard paginated envelope.
 *
 * When `page` exceeds the available pages the caller should clamp and re-query;
 * `totalPages` here is what makes that decision possible (US-PROD-4 edge case).
 */
export function paginated(items, { page, limit, total }) {
  const totalPages = total === 0 ? 0 : Math.ceil(total / limit);
  return {
    items,
    page,
    limit,
    total,
    totalPages,
    hasPrev: page > 1,
    hasNext: page < totalPages,
  };
}

/** Clamp a requested page into range once the total is known. */
export function clampPage(page, total, limit) {
  const totalPages = total === 0 ? 1 : Math.ceil(total / limit);
  return Math.min(Math.max(1, page), totalPages);
}
