/**
 * Order reference formatting and shape.
 *
 * The sequence source is an atomic Mongo counter and is not exercised here —
 * these cover the pure parts: how a number is assembled, and that the pattern
 * the backfill and validation rely on actually matches what is produced.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { dayKey, formatOrderNumber, ORDER_NUMBER_PATTERN } from '../src/order-number.js';

test('the day key is UTC and compact', () => {
  assert.equal(dayKey(new Date('2026-09-03T00:00:00Z')), '20260903');
  // Late-evening UTC must not roll into the next day.
  assert.equal(dayKey(new Date('2026-09-03T23:59:59Z')), '20260903');
});

test('a reference pads the sequence to four digits', () => {
  assert.equal(formatOrderNumber('20260903', 1), 'ORD-20260903-0001');
  assert.equal(formatOrderNumber('20260903', 147), 'ORD-20260903-0147');
});

/**
 * Beyond 9999 in a day the number grows rather than wrapping — wrapping would
 * reissue a reference already given to a customer.
 */
test('a busy day keeps counting past four digits', () => {
  assert.equal(formatOrderNumber('20260903', 10000), 'ORD-20260903-10000');
  assert.match(formatOrderNumber('20260903', 10000), ORDER_NUMBER_PATTERN);
});

test('generated references match the shared pattern', () => {
  assert.match(formatOrderNumber(dayKey(new Date()), 1), ORDER_NUMBER_PATTERN);
  assert.doesNotMatch('ORD-2026-0001', ORDER_NUMBER_PATTERN);
  assert.doesNotMatch('68b7f2a19c4e5d0012ab34cd', ORDER_NUMBER_PATTERN);
});
