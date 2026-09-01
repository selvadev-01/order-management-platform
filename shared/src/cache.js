/**
 * Redis cache-aside helper (US-PROD-6 — Redis use case #1).
 *
 *   Request → Redis → hit?  ── yes ──→ return
 *                       │
 *                       no
 *                       ↓
 *                    MongoDB → write to Redis → return
 *
 * Every operation degrades gracefully: if Redis is unreachable the caller
 * still gets its data from MongoDB (AC4). A cache outage must never take down
 * the catalogue, so no Redis failure is ever allowed to propagate.
 */
import crypto from 'node:crypto';

export class Cache {
  /**
   * @param {import('ioredis').Redis} redis
   * @param {object} opts
   * @param {number} opts.ttlSeconds default TTL
   * @param {object} opts.logger
   */
  constructor(redis, { ttlSeconds = 300, logger } = {}) {
    this.redis = redis;
    this.ttl = ttlSeconds;
    this.logger = logger;
  }

  /**
   * Cache-aside read. On any Redis error the loader still runs, so the caller
   * cannot tell the difference between a cache miss and a cache outage.
   */
  async wrap(key, loader, { ttlSeconds } = {}) {
    try {
      const hit = await this.redis.get(key);
      if (hit !== null) {
        this.logger?.debug({ key, hit: true }, 'cache hit');
        return JSON.parse(hit);
      }
    } catch (err) {
      this.logger?.warn({ err, key }, 'cache read failed — falling through to source');
    }

    this.logger?.debug({ key, hit: false }, 'cache miss');
    const value = await loader();

    // A write failure is logged and swallowed: the response is already correct.
    try {
      if (value !== undefined && value !== null) {
        await this.redis.set(key, JSON.stringify(value), 'EX', ttlSeconds ?? this.ttl);
      }
    } catch (err) {
      this.logger?.warn({ err, key }, 'cache write failed');
    }

    return value;
  }

  async del(...keys) {
    if (keys.length === 0) return;
    try {
      await this.redis.del(...keys);
      this.logger?.debug({ keys }, 'cache invalidated');
    } catch (err) {
      this.logger?.warn({ err, keys }, 'cache invalidation failed');
    }
  }

  /**
   * Invalidate by pattern, e.g. `products:list:*`.
   *
   * Uses SCAN rather than KEYS: KEYS blocks the Redis event loop for the whole
   * scan, which is fine at seed scale and harmful under real load.
   */
  async delPattern(pattern) {
    try {
      const stream = this.redis.scanStream({ match: pattern, count: 100 });
      const batch = [];
      for await (const keys of stream) {
        if (keys.length) batch.push(...keys);
      }
      if (batch.length) {
        await this.redis.del(...batch);
        this.logger?.debug({ pattern, count: batch.length }, 'cache pattern invalidated');
      }
    } catch (err) {
      this.logger?.warn({ err, pattern }, 'cache pattern invalidation failed');
    }
  }
}

/**
 * Build a stable cache key from query parameters.
 *
 * Keys are sorted before hashing so `?page=1&category=x` and `?category=x&page=1`
 * produce the same key rather than two entries for one result (US-PROD-6 edge case).
 */
export function queryKey(prefix, params = {}) {
  const normalised = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join('&');

  if (!normalised) return `${prefix}:all`;

  const hash = crypto.createHash('sha1').update(normalised).digest('hex').slice(0, 16);
  return `${prefix}:${hash}`;
}

export const cacheKeys = {
  productList: (params) => queryKey('products:list', params),
  productListPattern: () => 'products:list:*',
  product: (id) => `products:${id}`,
  categoriesAll: () => 'categories:all',
};
