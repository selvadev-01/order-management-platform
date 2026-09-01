/**
 * Redis connection factory.
 *
 * Connection errors are logged but never thrown: a service must keep serving
 * from MongoDB when the cache is unavailable (US-PROD-6 AC4). ioredis retries
 * in the background and recovers on its own.
 */
import Redis from 'ioredis';

export function createRedis(url, logger, { forQueue = false } = {}) {
  const client = new Redis(url, {
    // BullMQ requires this to be null — it uses blocking commands that must
    // not be aborted by a retry cap.
    maxRetriesPerRequest: forQueue ? null : 2,
    enableReadyCheck: true,
    retryStrategy(times) {
      const delay = Math.min(times * 200, 5000);
      if (times === 1) logger?.warn('redis connection lost — retrying');
      return delay;
    },
    lazyConnect: false,
  });

  client.on('connect', () => logger?.info('redis connected'));
  client.on('ready', () => logger?.debug('redis ready'));
  client.on('error', (err) => logger?.warn({ err: err.message }, 'redis error'));
  client.on('close', () => logger?.debug('redis connection closed'));

  return client;
}

export async function closeRedis(client, logger) {
  try {
    await client?.quit();
    logger?.debug('redis disconnected');
  } catch {
    client?.disconnect();
  }
}
