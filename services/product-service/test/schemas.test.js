/**
 * Product request validation (US-SYS-2, US-ADMIN-1..3).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  listProductsSchema,
  createProductSchema,
  updateProductSchema,
  updateStockSchema,
} from '../src/product.schemas.js';

const VALID_ID = '507f1f77bcf86cd799439011';

const validProduct = {
  name: 'Test Product',
  description: 'A description',
  price: 24950,
  stock: 5,
  category: VALID_ID,
};

// --- Listing query ----------------------------------------------------------

test('an empty query applies safe defaults', () => {
  const q = listProductsSchema.query.parse({});
  assert.equal(q.page, 1);
  assert.equal(q.limit, 12);
  assert.equal(q.sort, 'newest');
});

test('page and limit are coerced from strings', () => {
  const q = listProductsSchema.query.parse({ page: '2', limit: '5' });
  assert.equal(q.page, 2);
  assert.equal(q.limit, 5);
});

test('non-numeric, negative and oversized paging values are rejected', () => {
  assert.equal(listProductsSchema.query.safeParse({ page: 'abc' }).success, false);
  assert.equal(listProductsSchema.query.safeParse({ page: -3 }).success, false);
  assert.equal(listProductsSchema.query.safeParse({ limit: 5000 }).success, false);
});

/**
 * The search term is typed as a string, so a Mongo operator object cannot
 * reach the query builder.
 */
test('operator objects in search are rejected', () => {
  assert.equal(listProductsSchema.query.safeParse({ search: { $ne: null } }).success, false);
});

test('an operator written as text is accepted but stays literal text', () => {
  const q = listProductsSchema.query.parse({ search: '{"$ne":null}' });
  assert.equal(typeof q.search, 'string');
});

test('an over-long search term is rejected', () => {
  assert.equal(listProductsSchema.query.safeParse({ search: 'x'.repeat(200) }).success, false);
});

test('a malformed category id is rejected', () => {
  assert.equal(listProductsSchema.query.safeParse({ category: 'nope' }).success, false);
});

// --- Create -----------------------------------------------------------------

test('a valid product passes with images defaulted', () => {
  const parsed = createProductSchema.body.parse(validProduct);
  assert.deepEqual(parsed.images, []);
});

test('zero and negative prices are rejected', () => {
  for (const price of [0, -1]) {
    assert.equal(createProductSchema.body.safeParse({ ...validProduct, price }).success, false);
  }
});

test('fractional prices are rejected — money is integer minor units', () => {
  assert.equal(createProductSchema.body.safeParse({ ...validProduct, price: 249.5 }).success, false);
});

/** Zero stock is valid and means out of stock; negative never is. */
test('stock accepts zero but rejects negatives and fractions', () => {
  assert.equal(createProductSchema.body.safeParse({ ...validProduct, stock: 0 }).success, true);
  assert.equal(createProductSchema.body.safeParse({ ...validProduct, stock: -1 }).success, false);
  assert.equal(createProductSchema.body.safeParse({ ...validProduct, stock: 1.5 }).success, false);
});

test('an empty description is rejected', () => {
  assert.equal(createProductSchema.body.safeParse({ ...validProduct, description: '' }).success, false);
});

test('image entries must be valid URLs', () => {
  assert.equal(
    createProductSchema.body.safeParse({ ...validProduct, images: ['not-a-url'] }).success,
    false,
  );
  assert.equal(
    createProductSchema.body.safeParse({ ...validProduct, images: ['https://x.io/a.png'] }).success,
    true,
  );
});

test('unexpected fields are stripped', () => {
  const parsed = createProductSchema.body.parse({ ...validProduct, isDeleted: true, _id: 'x' });
  assert.equal(parsed.isDeleted, undefined);
  assert.equal(parsed._id, undefined);
});

// --- Update -----------------------------------------------------------------

test('a partial update is allowed', () => {
  const parsed = updateProductSchema.body.parse({ price: 19900 });
  assert.equal(parsed.price, 19900);
});

test('an empty update body is rejected', () => {
  assert.equal(updateProductSchema.body.safeParse({}).success, false);
});

test('stock updates enforce the same bounds', () => {
  assert.equal(updateStockSchema.body.safeParse({ stock: 0 }).success, true);
  assert.equal(updateStockSchema.body.safeParse({ stock: -5 }).success, false);
  assert.equal(updateStockSchema.body.safeParse({ stock: 'many' }).success, false);
});
