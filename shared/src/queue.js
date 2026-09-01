/**
 * BullMQ queue setup (docx §7, US-NOTIF-1..3, US-NOTIF-7).
 *
 * Redis use case #2 — the queue's backing store. Use case #1 is caching.
 *
 * Shared so producers (Order, Payment services) and the worker agree on queue
 * name, retry policy, and retention without duplicating configuration.
 */
import { Queue } from 'bullmq';
import { QUEUE_NAME } from './constants.js';

/**
 * Default job options.
 *
 * Failed jobs are RETAINED so they can be inspected — the docx asks for failed
 * jobs to be demonstrable, which requires them to still exist (US-NOTIF-3 AC4).
 * Completed jobs are kept in a bounded window so job status has something to
 * read without growing Redis without limit.
 */
export function defaultJobOptions({ attempts = 5, backoffDelay = 1000 } = {}) {
  return {
    attempts,
    backoff: { type: 'exponential', delay: backoffDelay },
    removeOnComplete: { age: 3600, count: 500 },
    removeOnFail: false,
  };
}

export function createQueue(connection, { attempts, backoffDelay, logger } = {}) {
  const queue = new Queue(QUEUE_NAME, {
    connection,
    defaultJobOptions: defaultJobOptions({ attempts, backoffDelay }),
  });

  queue.on('error', (err) => logger?.warn({ err: err.message }, 'queue error'));
  logger?.info({ queue: QUEUE_NAME }, 'queue ready');

  return queue;
}

/**
 * Distinguishes errors worth retrying from ones that never will be.
 *
 * A malformed payload or a missing user will fail identically on every
 * attempt, so consuming all retries on it just delays the failed-set entry and
 * hides the real cause (US-NOTIF-3 edge case).
 */
export class NonRetryableError extends Error {
  constructor(message) {
    super(message);
    this.name = 'NonRetryableError';
    this.retryable = false;
  }
}

export function isRetryable(err) {
  if (err?.retryable === false) return false;
  // Client-class responses will not succeed on retry; server and network ones may.
  if (typeof err?.status === 'number' && err.status >= 400 && err.status < 500) return false;
  return true;
}

export async function queueCounts(queue) {
  const counts = await queue.getJobCounts(
    'waiting',
    'active',
    'completed',
    'failed',
    'delayed',
    'paused',
  );
  return counts;
}
