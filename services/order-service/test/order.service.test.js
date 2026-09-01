/**
 * Order service rules that unit-level checks can reach without a database:
 * the guards around creating an order from a cart.
 *
 * The Cart service is stubbed so these test the decision logic, not Mongo.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { OrderService } from '../src/order.service.js';

const quiet = { info() {}, warn() {}, error() {}, debug() {} };

function makeService(cartView) {
  return new OrderService({
    cartService: { view: async () => cartView, clear: async () => {} },
    productClient: null,
    queue: null,
    logger: quiet,
  });
}

const CUSTOMER = { name: 'A', email: 'a@b.co', phone: '9876543210' };
const ADDRESS = { line1: '1 Rd', city: 'Blr', state: 'KA', postalCode: '560001', country: 'India' };

test('an empty cart cannot be checked out', async () => {
  const service = makeService({ items: [], checkoutBlocked: true, issues: [] });

  await assert.rejects(
    () => service.createFromCart('u1', { customerInfo: CUSTOMER, deliveryAddress: ADDRESS }, 't'),
    (err) => {
      assert.equal(err.status, 409);
      assert.match(err.message, /empty/i);
      return true;
    },
  );
});

/**
 * A line whose product was deleted, or whose stock fell below the cart
 * quantity, blocks checkout — and the message names the offending product so
 * the customer knows what to fix.
 */
test('a flagged line blocks checkout and names the product', async () => {
  const service = makeService({
    items: [
      { productId: 'p1', name: 'Good Item', unitPrice: 1000, quantity: 1, lineTotal: 1000, available: true },
      { productId: 'p2', name: 'Gone Item', unitPrice: 0, quantity: 1, lineTotal: 0, available: false, issue: 'UNAVAILABLE' },
    ],
    checkoutBlocked: true,
    issues: [{ productId: 'p2', name: 'Gone Item', issue: 'UNAVAILABLE' }],
  });

  await assert.rejects(
    () => service.createFromCart('u1', { customerInfo: CUSTOMER, deliveryAddress: ADDRESS }, 't'),
    (err) => {
      assert.equal(err.status, 409);
      assert.match(err.message, /Gone Item/);
      return true;
    },
  );
});

test('an insufficient-stock line also blocks checkout', async () => {
  const service = makeService({
    items: [{ productId: 'p1', name: 'Popular Item', unitPrice: 1000, quantity: 9, lineTotal: 9000, available: false, issue: 'INSUFFICIENT_STOCK' }],
    checkoutBlocked: true,
    issues: [{ productId: 'p1', name: 'Popular Item', issue: 'INSUFFICIENT_STOCK' }],
  });

  await assert.rejects(
    () => service.createFromCart('u1', { customerInfo: CUSTOMER, deliveryAddress: ADDRESS }, 't'),
    (err) => err.status === 409,
  );
});
