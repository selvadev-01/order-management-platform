/**
 * Cache-aside behaviour and key normalization (US-PROD-6).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { Cache, queryKey, cacheKeys } from '../src/cache.js';

const quiet = { debug() {}, warn() {}, info() {} };

/** Minimal in-memory stand-in for Redis. */
function fakeRedis() {
  const store = new Map();
  return {
    store,
    async get(k) { return store.has(k) ? store.get(k) : null; },
    async set(k, v) { store.set(k, v); return 'OK'; },
    async del(...keys) { keys.forEach((k) => store.delete(k)); return keys.length; },
  };
}

/** Every operation fails, as during a Redis outage. */
const deadRedis = {
  async get() { throw new Error('ECONNREFUSED'); },
  async set() { throw new Error('ECONNREFUSED'); },
  async del() { throw new Error('ECONNREFUSED'); },
  scanStream() { throw new Error('ECONNREFUSED'); },
};

test('a miss loads from source and populates the cache', async () => {
  const redis = fakeRedis();
  const cache = new Cache(redis, { logger: quiet });
  let calls = 0;

  const value = await cache.wrap('k', async () => { calls += 1; return { n: 1 }; });

  assert.deepEqual(value, { n: 1 });
  assert.equal(calls, 1);
  assert.ok(redis.store.has('k'));
});

test('a hit returns the cached value without touching the source', async () => {
  const redis = fakeRedis();
  const cache = new Cache(redis, { logger: quiet });
  let calls = 0;
  const loader = async () => { calls += 1; return { n: 1 }; };

  await cache.wrap('k', loader);
  const second = await cache.wrap('k', loader);

  assert.equal(calls, 1, 'loader should not run on a cache hit');
  assert.deepEqual(second, { n: 1 });
});

test('cached and uncached responses are identical in shape', async () => {
  const redis = fakeRedis();
  const cache = new Cache(redis, { logger: quiet });
  const payload = { items: [{ id: 'a', price: 1999 }], total: 1 };

  const fresh = await cache.wrap('k', async () => payload);
  const cached = await cache.wrap('k', async () => ({ different: true }));

  assert.deepEqual(cached, fresh);
});

/** A cache outage must never take down the catalogue (AC4). */
test('reads fall through to the source when Redis is unreachable', async () => {
  const cache = new Cache(deadRedis, { logger: quiet });
  const value = await cache.wrap('k', async () => ({ from: 'mongo' }));
  assert.deepEqual(value, { from: 'mongo' });
});

test('invalidation failures are swallowed rather than propagated', async () => {
  const cache = new Cache(deadRedis, { logger: quiet });
  await cache.del('a', 'b');
  await cache.delPattern('products:list:*');
  // Reaching here without throwing is the assertion.
  assert.ok(true);
});

test('deleting a key forces the next read to reload', async () => {
  const redis = fakeRedis();
  const cache = new Cache(redis, { logger: quiet });
  let calls = 0;
  const loader = async () => { calls += 1; return { n: calls }; };

  await cache.wrap('k', loader);
  await cache.del('k');
  const after = await cache.wrap('k', loader);

  assert.equal(calls, 2);
  assert.deepEqual(after, { n: 2 });
});

test('null results are not cached', async () => {
  const redis = fakeRedis();
  const cache = new Cache(redis, { logger: quiet });
  await cache.wrap('missing', async () => null);
  assert.equal(redis.store.has('missing'), false);
});

/**
 * Parameter order must not fragment the cache — otherwise the same query
 * occupies two entries and one invalidation misses the other.
 */
test('parameter order does not change the key', () => {
  const a = queryKey('products:list', { page: 1, limit: 5, sort: 'newest' });
  const b = queryKey('products:list', { sort: 'newest', limit: 5, page: 1 });
  assert.equal(a, b);
});

test('empty and absent values are excluded from the key', () => {
  const a = queryKey('products:list', { page: 1, search: '', category: undefined });
  const b = queryKey('products:list', { page: 1 });
  assert.equal(a, b);
});

test('different queries produce different keys', () => {
  assert.notEqual(
    queryKey('products:list', { limit: 5 }),
    queryKey('products:list', { limit: 3 }),
  );
});

test('key builders use a documented prefix scheme', () => {
  assert.equal(cacheKeys.product('abc'), 'products:abc');
  assert.equal(cacheKeys.categoriesAll(), 'categories:all');
  assert.ok(cacheKeys.productList({ page: 1 }).startsWith('products:list:'));
  // The invalidation pattern must match the keys it is meant to clear.
  assert.ok(cacheKeys.productList({ page: 1 }).startsWith(cacheKeys.productListPattern().slice(0, -1)));
});
