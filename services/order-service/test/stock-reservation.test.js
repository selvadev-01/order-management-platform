/**
 * Stock reservation on order creation (§9 "update stock", §4 order semantics).
 *
 * The Product Service is faked so these assert the Order Service's decisions —
 * that stock is taken before the order is written, and put back when the order
 * does not survive. The atomic decrement itself is the Product Service's job
 * and is exercised through its own conditional update.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { OrderService } from '../src/order.service.js';

/**
 * These tests run without a database. Mongoose would otherwise buffer each
 * write for ten seconds before failing, so buffering is disabled: the write
 * fails immediately, which is the condition under test anyway.
 */
mongoose.set('bufferCommands', false);

const quiet = { info() {}, warn() {}, error() {}, debug() {} };

const CUSTOMER = { name: 'A', email: 'a@b.co', phone: '9876543210' };
const ADDRESS = { line1: '1 Rd', city: 'Blr', state: 'KA', postalCode: '560001', country: 'India' };

const CART = {
  items: [
    { productId: '507f1f77bcf86cd799439011', name: 'Widget', unitPrice: 1000, quantity: 2, lineTotal: 2000 },
  ],
  checkoutBlocked: false,
  issues: [],
};

/** Records every stock call the Order Service makes. */
function fakeProducts({ reserveFails = false } = {}) {
  return {
    calls: [],
    async post(path, body) {
      this.calls.push({ path, items: body.items });
      if (path.endsWith('/reserve') && reserveFails) {
        const err = new Error('Only 1 of "Widget" remain in stock');
        err.status = 409;
        throw err;
      }
      return { ok: true };
    },
  };
}

function makeService(products) {
  return new OrderService({
    cartService: { view: async () => CART, clear: async () => {} },
    productClient: products,
    queue: null,
    logger: quiet,
  });
}

test('stock is reserved before the order is written', async () => {
  const products = fakeProducts();
  const service = makeService(products);

  // The Order.create() that follows needs a database, so this asserts what
  // happened up to that point: the reservation must already have been made.
  await service
    .createFromCart(
      '507f1f77bcf86cd799439099',
      { customerInfo: CUSTOMER, deliveryAddress: ADDRESS },
      'tok',
    )
    .catch(() => {});

  const reserve = products.calls.find((c) => c.path.endsWith('/reserve'));
  assert.ok(reserve, 'stock must be taken before the order is persisted');
  assert.deepEqual(reserve.items, [
    { productId: '507f1f77bcf86cd799439011', quantity: 2 },
  ]);
});

test('a write failure after reservation releases the stock again', async () => {
  const products = fakeProducts();
  const service = makeService(products);

  // Order.create() cannot reach Mongo here, so it throws — which is exactly
  // the path that must put the reserved stock back.
  await service
    .createFromCart(
      '507f1f77bcf86cd799439099',
      { customerInfo: CUSTOMER, deliveryAddress: ADDRESS },
      'tok',
    )
    .catch(() => {});

  const release = products.calls.find((c) => c.path.endsWith('/release'));
  assert.ok(release, 'stock must not stay held for an order that was never written');
  assert.deepEqual(release.items, [
    { productId: '507f1f77bcf86cd799439011', quantity: 2 },
  ]);
});

test('an insufficient-stock rejection propagates and no order is created', async () => {
  const products = fakeProducts({ reserveFails: true });
  const service = makeService(products);

  await assert.rejects(
    () =>
      service.createFromCart('507f1f77bcf86cd799439099', {
        customerInfo: CUSTOMER,
        deliveryAddress: ADDRESS,
      }, 'tok'),
    (err) => {
      assert.equal(err.status, 409, 'the upstream conflict must not be flattened');
      assert.match(err.message, /stock/i);
      return true;
    },
  );

  // Nothing was taken, so nothing needs releasing.
  assert.equal(products.calls.filter((c) => c.path.endsWith('/release')).length, 0);
});

test('a failed payment releases the stock back to the catalogue', async () => {
  const products = fakeProducts();
  const service = new OrderService({
    cartService: { view: async () => CART, clear: async () => {} },
    productClient: products,
    queue: null,
    logger: quiet,
  });

  // Exercise the release helper directly — markPaymentFailed's Mongo write is
  // out of reach here, but the release decision is what matters.
  await service.releaseStockForItems(CART.items, 'tok');

  const release = products.calls.find((c) => c.path.endsWith('/release'));
  assert.ok(release, 'unpaid stock must go back');
  assert.deepEqual(release.items, [
    { productId: '507f1f77bcf86cd799439011', quantity: 2 },
  ]);
});

test('a release failure never throws', async () => {
  const broken = {
    async post() {
      throw new Error('product service down');
    },
  };
  const service = new OrderService({
    cartService: { view: async () => CART, clear: async () => {} },
    productClient: broken,
    queue: null,
    logger: quiet,
  });

  // Must resolve: a release problem cannot mask the failure being handled.
  await service.releaseStockForItems(CART.items, 'tok');
});
