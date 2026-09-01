/**
 * Order status transitions, money arithmetic, pagination, and retry
 * classification — the pure domain rules the services depend on.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  OrderStatus,
  ORDER_STATUS_SEQUENCE,
  canTransition,
  nextStatus,
  STATUS_NOTIFICATION,
  NotificationEvent,
} from '../src/constants.js';
import { toMinor, toMajor, sumMinor, lineTotal, formatMoney } from '../src/money.js';
import { paginated, clampPage, paginationQuery } from '../src/pagination.js';
import { isRetryable, NonRetryableError } from '../src/queue.js';

// --- Order status lifecycle (US-ADMIN-8) ------------------------------------

test('each stage advances only to its immediate successor', () => {
  for (let i = 0; i < ORDER_STATUS_SEQUENCE.length - 1; i += 1) {
    assert.equal(canTransition(ORDER_STATUS_SEQUENCE[i], ORDER_STATUS_SEQUENCE[i + 1]), true);
  }
});

test('skipping a stage is rejected', () => {
  assert.equal(canTransition(OrderStatus.PENDING, OrderStatus.SHIPPED), false);
  assert.equal(canTransition(OrderStatus.CONFIRMED, OrderStatus.DELIVERED), false);
});

test('moving backwards is rejected', () => {
  assert.equal(canTransition(OrderStatus.SHIPPED, OrderStatus.PROCESSING), false);
  assert.equal(canTransition(OrderStatus.DELIVERED, OrderStatus.PENDING), false);
});

test('Delivered is terminal', () => {
  assert.equal(nextStatus(OrderStatus.DELIVERED), null);
});

test('an unknown status has no valid transition', () => {
  assert.equal(canTransition('Teleported', OrderStatus.SHIPPED), false);
  assert.equal(nextStatus('Teleported'), null);
});

test('the three customer-facing transitions raise notifications', () => {
  assert.equal(STATUS_NOTIFICATION[OrderStatus.CONFIRMED], NotificationEvent.ORDER_CONFIRMED);
  assert.equal(STATUS_NOTIFICATION[OrderStatus.SHIPPED], NotificationEvent.ORDER_SHIPPED);
  assert.equal(STATUS_NOTIFICATION[OrderStatus.DELIVERED], NotificationEvent.ORDER_DELIVERED);
  // Pending is the initial state, not a change worth notifying about.
  assert.equal(STATUS_NOTIFICATION[OrderStatus.PENDING], undefined);
});

// --- Money (US-SYS-6) -------------------------------------------------------

test('major units convert to integer minor units', () => {
  assert.equal(toMinor(19.99), 1999);
  assert.equal(toMinor(0.1), 10);
  assert.equal(toMajor(459900), 4599);
});

/** The reason money is stored as integers rather than floats. */
test('integer arithmetic avoids float drift', () => {
  assert.notEqual(0.1 + 0.2, 0.3); // the problem being avoided
  assert.equal(sumMinor([toMinor(0.1), toMinor(0.2)]), toMinor(0.3));
});

test('line totals multiply exactly', () => {
  assert.equal(lineTotal(459900, 3), 1379700);
  assert.equal(sumMinor([lineTotal(1999, 2), lineTotal(500, 1)]), 4498);
});

test('formatting renders minor units as currency', () => {
  const out = formatMoney(199900);
  assert.ok(out.includes('1,999'), `expected a thousands-separated amount, got ${out}`);
});

// --- Pagination (US-PROD-4) -------------------------------------------------

test('pagination metadata is computed from the total', () => {
  const page = paginated([], { page: 2, limit: 12, total: 25 });
  assert.equal(page.totalPages, 3);
  assert.equal(page.hasPrev, true);
  assert.equal(page.hasNext, true);
});

test('an empty result set reports zero pages and no navigation', () => {
  const page = paginated([], { page: 1, limit: 12, total: 0 });
  assert.equal(page.totalPages, 0);
  assert.equal(page.hasPrev, false);
  assert.equal(page.hasNext, false);
});

test('a page beyond the end clamps to the last page', () => {
  assert.equal(clampPage(999, 25, 12), 3);
});

test('zero, negative and empty-collection pages clamp to 1', () => {
  assert.equal(clampPage(0, 25, 12), 1);
  assert.equal(clampPage(-5, 25, 12), 1);
  assert.equal(clampPage(3, 0, 12), 1);
});

test('query params are coerced, defaulted and bounded', () => {
  assert.equal(paginationQuery.parse({}).page, 1);
  assert.equal(paginationQuery.parse({}).limit, 12);
  assert.equal(paginationQuery.parse({ page: '3' }).page, 3);
  assert.equal(paginationQuery.safeParse({ page: 'abc' }).success, false);
  assert.equal(paginationQuery.safeParse({ page: -1 }).success, false);
  // Capped so a client cannot request the whole collection.
  assert.equal(paginationQuery.safeParse({ limit: 5000 }).success, false);
});

// --- Retry classification (US-NOTIF-3) --------------------------------------

test('transient failures are retryable', () => {
  assert.equal(isRetryable(new Error('socket hang up')), true);
  assert.equal(isRetryable({ status: 502 }), true);
  assert.equal(isRetryable({ status: 503 }), true);
});

test('client-class failures are not retried', () => {
  // A 404 will fail identically on every attempt — retrying only delays the
  // failed-set entry and buries the real cause.
  assert.equal(isRetryable({ status: 404 }), false);
  assert.equal(isRetryable({ status: 400 }), false);
  assert.equal(isRetryable(new NonRetryableError('deleted order')), false);
});
