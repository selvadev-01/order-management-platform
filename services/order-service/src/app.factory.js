/**
 * Builds the Order Service Express app without starting a server.
 *
 * See services/auth-service/src/app.factory.js for why this split exists.
 * Produces BullMQ jobs on order creation and status change (docx §7).
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
import { Cart } from './models/cart.model.js';
import { Order } from './models/order.model.js';
import { CartService } from './cart.service.js';
import { OrderService } from './order.service.js';
import { buildControllers } from './order.controller.js';
import { buildRoutes } from './order.routes.js';

/**
 * @param {object}  [opts]
 * @param {boolean} [opts.connectDatabase=true] see auth-service factory
 * @param {string}  [opts.productServiceUrl]
 *   Overrides PRODUCT_SERVICE_URL. The single-process entry point passes its
 *   own origin, since there is no separate product process to reach there.
 */
export async function createServiceApp({ connectDatabase = true, productServiceUrl } = {}) {
  const logger = createLogger(SERVICE_NAME);

  if (connectDatabase) {
    mongoose.set('strictQuery', true);
    await mongoose.connect(config.MONGODB_URI, {
      serverSelectionTimeoutMS: 5000,
      autoIndex: false,
    });
    logger.info({ db: mongoose.connection.name }, 'mongodb connected');
  }

  // The unique index on carts.userId enforces one cart per user, so it must
  // exist before traffic arrives.
  for (const model of [Cart, Order]) {
    await model.syncIndexes();
    logger.debug({ model: model.modelName }, 'indexes synced');
  }

  // BullMQ requires maxRetriesPerRequest: null on its connection.
  const queueRedis = createRedis(config.REDIS_URL, logger, { forQueue: true });
  const queue = createQueue(queueRedis, {
    attempts: config.QUEUE_ATTEMPTS,
    backoffDelay: config.QUEUE_BACKOFF_DELAY_MS,
    logger,
  });

  // Cross-service reads go through a defined interface, never a direct
  // collection read (US-SYS-5 AC3).
  const productClient = new ServiceClient({
    baseUrl: productServiceUrl ?? config.PRODUCT_SERVICE_URL,
    name: 'product-service',
    logger,
  });

  const cartService = new CartService({ productClient, queue, logger });
  const orderService = new OrderService({ cartService, productClient, queue, logger });
  const controllers = buildControllers({ cartService, orderService });

  const app = createApp({
    service: SERVICE_NAME,
    logger,
    corsOrigins: config.CORS_ORIGINS,
    rateLimit: { windowMs: config.RATE_LIMIT_WINDOW_MS, max: config.RATE_LIMIT_MAX },
  });

  app.use('/api', buildRoutes({ controllers, config }));
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