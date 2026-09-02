/**
 * Notification worker — construction, without process ownership.
 *
 *   Order Created → BullMQ Queue → Redis → Worker → Push Notification
 *
 * Extracted from index.js so the worker can run two ways from one definition:
 * as its own process (index.js, the normal deployment) or started in-band by
 * the root single-process entry point, where a free host offers no separate
 * worker process type. The job handling is identical either way.
 *
 * Demonstrates (docx §7): worker consumption, retry with backoff, failed-job
 * retention, job status, and delayed jobs.
 */
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import { Worker, UnrecoverableError } from 'bullmq';
import {
  createLogger,
  createRedis,
  closeRedis,
  loadEnv,
  envField,
  baseEnvShape,
  ServiceClient,
  QUEUE_NAME,
  Role,
  isRetryable,
} from '@oms/shared';
import { NotificationService } from '../../../services/notification-service/src/notification.service.js';
import { Notification } from '../../../services/notification-service/src/models/notification.model.js';
import { PushSubscription } from '../../../services/notification-service/src/models/subscription.model.js';

const here = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(here, '../../../.env') });

export const SERVICE_NAME = 'notification-worker';

export const config = loadEnv({
  ...baseEnvShape,
  MONGODB_URI: envField.requiredString(),
  REDIS_URL: envField.requiredString(),
  ORDER_SERVICE_URL: envField.url(),
  JWT_SECRET: envField.secret(32),
  QUEUE_CONCURRENCY: envField.int(5),
  VAPID_PUBLIC_KEY: envField.requiredString(),
  VAPID_PRIVATE_KEY: envField.requiredString(),
  VAPID_SUBJECT: envField.requiredString(),
});

/**
 * Starts the BullMQ worker and returns it, along with a close() that drains
 * in-flight jobs and releases whatever this function opened.
 *
 * @param {object}  [opts]
 * @param {boolean} [opts.connectDatabase=true]
 *   Pass false when the caller already holds a mongoose connection to the same
 *   URI — a second connect() on the default connection would throw.
 * @param {string}  [opts.orderServiceUrl]
 *   Overrides ORDER_SERVICE_URL; the single-process entry point passes its own
 *   origin, since there is no separate order process to reach there.
 */
export async function startNotificationWorker({ connectDatabase = true, orderServiceUrl } = {}) {
  const logger = createLogger(SERVICE_NAME);

  /**
   * The worker authenticates to the Order Service as itself.
   *
   * Minted here rather than at module load so importing this file has no side
   * effects beyond config validation.
   */
  const internalToken = jwt.sign(
    { sub: 'notification-worker', role: Role.ADMIN, service: true },
    config.JWT_SECRET,
    { expiresIn: '12h' },
  );

  if (connectDatabase) {
    mongoose.set('strictQuery', true);
    await mongoose.connect(config.MONGODB_URI, {
      serverSelectionTimeoutMS: 5000,
      autoIndex: false,
    });
    logger.info({ db: mongoose.connection.name }, 'mongodb connected');
  }

  for (const model of [Notification, PushSubscription]) {
    await model.syncIndexes();
  }

  const connection = createRedis(config.REDIS_URL, logger, { forQueue: true });

  const orderClient = new ServiceClient({
    baseUrl: orderServiceUrl ?? config.ORDER_SERVICE_URL,
    name: 'order-service',
    logger,
  });

  const service = new NotificationService({ orderClient, config, logger });

  const worker = new Worker(
    QUEUE_NAME,
    async (job) => {
      const start = Date.now();
      logger.info({ jobId: job.id, name: job.name, attempt: job.attemptsMade + 1 }, 'job started');

      try {
        const result = await service.deliver(job.data, { token: internalToken });
        logger.info(
          { jobId: job.id, name: job.name, durationMs: Date.now() - start, ...result },
          'job completed',
        );
        return result;
      } catch (err) {
        /**
         * Distinguish retryable from permanent failures.
         *
         * A malformed payload or a deleted order fails identically on every
         * attempt, so consuming all five retries just delays the failed-set
         * entry and buries the real cause. An UnrecoverableError sends it
         * straight to the failed set (US-NOTIF-3 edge case).
         */
        if (!isRetryable(err)) {
          logger.error(
            { jobId: job.id, name: job.name, err: err.message },
            'job failed permanently — not retrying',
          );
          // BullMQ skips the remaining attempts only for an UnrecoverableError,
          // so the classification is carried by the error that leaves this
          // handler. Rethrown as one rather than mutating the job, which is
          // what the deprecated job.discard() did.
          throw new UnrecoverableError(err.message);
        } else {
          logger.warn(
            {
              jobId: job.id,
              attempt: job.attemptsMade + 1,
              maxAttempts: job.opts.attempts,
              err: err.message,
            },
            'job failed — will retry with backoff',
          );
        }
        throw err;
      }
    },
    {
      connection,
      concurrency: config.QUEUE_CONCURRENCY,
    },
  );

  // Lifecycle logging makes the queue mechanics demonstrable during review —
  // the docx asks for these behaviours to be shown working (US-SYS-3 AC4).
  worker.on('completed', (job) => logger.debug({ jobId: job.id }, 'worker: completed'));
  worker.on('failed', (job, err) =>
    logger.error(
      { jobId: job?.id, attemptsMade: job?.attemptsMade, err: err.message },
      'worker: job moved to failed set',
    ),
  );
  worker.on('stalled', (jobId) => logger.warn({ jobId }, 'worker: job stalled — will be reprocessed'));
  worker.on('error', (err) => logger.error({ err: err.message }, 'worker error'));

  logger.info(
    { queue: QUEUE_NAME, concurrency: config.QUEUE_CONCURRENCY },
    'notification worker ready',
  );

  return {
    worker,
    logger,
    /** Waits for in-flight jobs rather than abandoning them mid-delivery. */
    close: async () => {
      await worker.close();
      await closeRedis(connection, logger);
      if (connectDatabase) await mongoose.disconnect();
    },
  };
}