/**
 * Human-readable order references.
 *
 * The Mongo `_id` stays the internal key — it is what URLs, foreign keys in the
 * Payment and Notification services, and queue payloads use. It is a poor thing
 * to show a customer though: 24 hex characters that cannot be read aloud, and
 * whose truncated form (the last 8 characters) is not guaranteed unique.
 *
 * `orderNumber` is the customer-facing reference, and exists only for display
 * and support lookup. Format:
 *
 *     ORD-20260903-0147
 *         ^date     ^that day's sequence, from 0001
 *
 * The date is the placement date in UTC, so the number a customer quotes tells
 * support when the order was placed and sorts chronologically as a plain string.
 */
import { nextSequence } from './models/counter.model.js';

export const ORDER_NUMBER_PREFIX = 'ORD';

/** A parser-friendly shape check — used by request validation and the backfill. */
export const ORDER_NUMBER_PATTERN = /^ORD-\d{8}-\d{4,}$/;

/** `2026-09-03T…` → `20260903`. UTC, so the key does not shift with server locale. */
export function dayKey(date = new Date()) {
  return date.toISOString().slice(0, 10).replaceAll('-', '');
}

/**
 * Assemble a reference from its parts.
 *
 * The sequence is padded to four digits but deliberately not truncated: a day
 * with more than 9999 orders keeps counting into five digits rather than
 * wrapping and colliding.
 */
export function formatOrderNumber(day, seq) {
  return `${ORDER_NUMBER_PREFIX}-${day}-${String(seq).padStart(4, '0')}`;
}

/**
 * The next reference for an order placed now.
 *
 * Uniqueness comes from the atomic counter, not from this function — see
 * `counter.model.js`. The unique index on `Order.orderNumber` is the backstop
 * that turns any residual collision into a failed write rather than two orders
 * sharing a reference.
 */
export async function generateOrderNumber(date = new Date()) {
  const day = dayKey(date);
  const seq = await nextSequence(`order:${day}`);
  return formatOrderNumber(day, seq);
}