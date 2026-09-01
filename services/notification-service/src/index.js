/**
 * Notification Service entry point.
 *
 * Responsibilities (docx §5): push notifications, order notifications,
 * payment notifications.
 *
 * This process serves HTTP only. Job consumption is the worker's job
 * (`workers/notification-worker`), so delivery load never affects API latency.
 */
import mongoose from 'mongoose';
import {
  createApp,
  finalizeApp,
  startServer,
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

const logger = createLogger(SERVICE_NAME);

async function main() {
  mongoose.set('strictQuery', true);
  await mongoose.connect(config.MONGODB_URI, {
    serverSelectionTimeoutMS: 5000,
    autoIndex: false,
  });
  logger.info({ db: mongoose.connection.name }, 'mongodb connected');

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
    baseUrl: config.ORDER_SERVICE_URL,
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

  startServer(app, {
    port: config.NOTIFICATION_SERVICE_PORT,
    service: SERVICE_NAME,
    logger,
    onShutdown: async () => {
      await queue.close();
      await closeRedis(queueRedis, logger);
      await mongoose.disconnect();
    },
  });
}

main().catch((err) => {
  logger.fatal({ err }, 'failed to start');
  process.exit(1);
});
