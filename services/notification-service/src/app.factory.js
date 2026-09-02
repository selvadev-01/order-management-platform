/**
 * Builds the Notification Service Express app without starting a server.
 *
 * See services/auth-service/src/app.factory.js for why this split exists.
 *
 * This app serves HTTP only. Job consumption is the worker's job
 * (workers/notification-worker), so delivery load never affects API latency —
 * true even when both are mounted in the same process by the root entry point.
 */
import mongoose from 'mongoose';
import {
  createApp,
  finalizeApp,
  createLogger,
  createRedis,
  closeRedis,
  createQueue,
  ServiceClient,
} from '@oms/shared';
import { config, SERVICE_NAME } from './config.js';
import { Notification } from './models/notification.model.js';
import { PushSubscription } from './models/subscription.model.js';
import { PushPreference } from './models/preference.model.js';
import { NotificationService } from './notification.service.js';
import { buildControllers } from './notification.controller.js';
import { buildRoutes } from './notification.routes.js';

/**
 * @param {object}  [opts]
 * @param {boolean} [opts.connectDatabase=true] see auth-service factory
 * @param {string}  [opts.orderServiceUrl]
 *   Overrides ORDER_SERVICE_URL; the single-process entry point passes its own
 *   origin, since there is no separate order process to reach there.
 */
export async function createServiceApp({ connectDatabase = true, orderServiceUrl } = {}) {
  const logger = createLogger(SERVICE_NAME);

  if (connectDatabase) {
    mongoose.set('strictQuery', true);
    await mongoose.connect(config.MONGODB_URI, {
      serverSelectionTimeoutMS: 5000,
      autoIndex: false,
    });
    logger.info({ db: mongoose.connection.name }, 'mongodb connected');
  }

  // The unique (userId, event, orderId) index is what makes delivery
  // idempotent, so it must exist before any job runs.
  for (const model of [Notification, PushSubscription, PushPreference]) {
    await model.syncIndexes();
    logger.debug({ model: model.modelName }, 'indexes synced');
  }

  const queueRedis = createRedis(config.REDIS_URL, logger, { forQueue: true });
  const queue = createQueue(queueRedis, {
    attempts: config.QUEUE_ATTEMPTS,
    backoffDelay: config.QUEUE_BACKOFF_DELAY_MS,
    logger,
  });

  const orderClient = new ServiceClient({
    baseUrl: orderServiceUrl ?? config.ORDER_SERVICE_URL,
    name: 'order-service',
    logger,
  });

  const service = new NotificationService({ orderClient, config, logger });
  const controllers = buildControllers({ service });

  const app = createApp({
    service: SERVICE_NAME,
    logger,
    corsOrigins: config.CORS_ORIGINS,
    rateLimit: { windowMs: config.RATE_LIMIT_WINDOW_MS, max: config.RATE_LIMIT_MAX },
  });

  app.use('/api', buildRoutes({ controllers, config, queue }));
  finalizeApp(app, logger);

  return {
    app,
    logger,
    onShutdown: async () => {
      await queue.close();
      await closeRedis(queueRedis, logger);
      if (connectDatabase) await mongoose.disconnect();
    },
  };
}