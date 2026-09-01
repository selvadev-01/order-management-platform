/**
 * Cart and order request validation (US-SYS-2).
 *
 * These schemas are the outermost guard: they run before any controller, so a
 * malformed or hostile payload never reaches business logic.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addToCartSchema,
  setQuantitySchema,
  createOrderSchema,
  updateStatusSchema,
} from '../src/order.schemas.js';

const VALID_ID = '507f1f77bcf86cd799439011';

const validCheckout = {
  customerInfo: { name: 'Test Customer', email: 'a@b.co', phone: '9876543210' },
  deliveryAddress: {
    line1: '12 MG Road',
    city: 'Bengaluru',
    state: 'Karnataka',
    postalCode: '560001',
  },
};

// --- Cart -------------------------------------------------------------------

test('a valid add-to-cart body passes and defaults quantity to 1', () => {
  const parsed = addToCartSchema.body.parse({ productId: VALID_ID });
  assert.equal(parsed.quantity, 1);
});

test('a malformed product id is rejected before any database query', () => {
  assert.equal(addToCartSchema.body.safeParse({ productId: 'not-an-id' }).success, false);
});

test('zero, negative and fractional quantities are rejected', () => {
  for (const quantity of [0, -1, 2.5]) {
    assert.equal(
      addToCartSchema.body.safeParse({ productId: VALID_ID, quantity }).success,
      false,
      `quantity ${quantity} should be rejected`,
    );
  }
});

test('numeric strings are coerced', () => {
  assert.equal(setQuantitySchema.body.parse({ quantity: '3' }).quantity, 3);
});

/**
 * Zod strips unknown keys, which is what stops a client smuggling extra fields
 * into a write — the same mechanism that blocks role escalation on register.
 */
test('unexpected fields are stripped rather than passed through', () => {
  const parsed = addToCartSchema.body.parse({
    productId: VALID_ID,
    quantity: 1,
    unitPrice: 1,
    isAdmin: true,
  });
  assert.deepEqual(Object.keys(parsed).sort(), ['productId', 'quantity']);
});

/** A Mongo operator where a string is expected must not survive validation. */
test('NoSQL operator objects are rejected by type validation', () => {
  assert.equal(addToCartSchema.body.safeParse({ productId: { $ne: null } }).success, false);
});

// --- Checkout ---------------------------------------------------------------

test('a complete checkout body passes and defaults the country', () => {
  const parsed = createOrderSchema.body.parse(validCheckout);
  assert.equal(parsed.deliveryAddress.country, 'India');
  assert.equal(parsed.deliveryAddress.line2, '');
});

test('an invalid email is rejected', () => {
  const body = { ...validCheckout, customerInfo: { ...validCheckout.customerInfo, email: 'nope' } };
  assert.equal(createOrderSchema.body.safeParse(body).success, false);
});

test('a phone containing letters is rejected', () => {
  const body = { ...validCheckout, customerInfo: { ...validCheckout.customerInfo, phone: 'call-me' } };
  assert.equal(createOrderSchema.body.safeParse(body).success, false);
});

test('missing address fields are reported per field', () => {
  const result = createOrderSchema.body.safeParse({
    customerInfo: validCheckout.customerInfo,
    deliveryAddress: { line1: '', city: '', state: '', postalCode: '' },
  });
  assert.equal(result.success, false);
  const fields = result.error.issues.map((i) => i.path.join('.'));
  for (const f of ['deliveryAddress.line1', 'deliveryAddress.city', 'deliveryAddress.state']) {
    assert.ok(fields.includes(f), `expected an error for ${f}`);
  }
});

/**
 * The client cannot propose what it pays — there is no total field to send.
 * The server recomputes it from live prices.
 */
test('a client-supplied total is stripped from the checkout body', () => {
  const parsed = createOrderSchema.body.parse({ ...validCheckout, totalAmount: 1, total: 1 });
  assert.equal(parsed.totalAmount, undefined);
  assert.equal(parsed.total, undefined);
});

test('email is normalised to lowercase and trimmed', () => {
  const parsed = createOrderSchema.body.parse({
    ...validCheckout,
    customerInfo: { ...validCheckout.customerInfo, email: '  Person@Example.COM ' },
  });
  assert.equal(parsed.customerInfo.email, 'person@example.com');
});

// --- Status -----------------------------------------------------------------

test('only the five defined statuses are accepted', () => {
  for (const status of ['Pending', 'Confirmed', 'Processing', 'Shipped', 'Delivered']) {
    assert.equal(updateStatusSchema.body.safeParse({ status }).success, true);
  }
  assert.equal(updateStatusSchema.body.safeParse({ status: 'Teleported' }).success, false);
  assert.equal(updateStatusSchema.body.safeParse({ status: 'delivered' }).success, false);
});
