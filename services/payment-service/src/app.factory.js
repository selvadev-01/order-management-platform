/**
 * Builds the Payment Service Express app without starting a server.
 *
 * See services/auth-service/src/app.factory.js for why this split exists.
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
import { Payment } from './models/payment.model.js';
import { createGateway } from './gateway.js';
import { PaymentService } from './payment.service.js';
import { buildControllers } from './payment.controller.js';
import { buildRoutes } from './payment.routes.js';

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

  // The unique index on gatewayPaymentId is the idempotency backstop, so it
  // must exist before any webhook can arrive.
  await Payment.syncIndexes();
  logger.debug({ model: 'Payment' }, 'indexes synced');

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

  const gateway = createGateway(config, logger);
  const service = new PaymentService({ gateway, orderClient, queue, config, logger });
  const controllers = buildControllers({ service, gateway, config });

  const app = createApp({
    service: SERVICE_NAME,
    logger,
    corsOrigins: config.CORS_ORIGINS,
    rateLimit: { windowMs: config.RATE_LIMIT_WINDOW_MS, max: config.RATE_LIMIT_MAX },
    /**
     * The webhook needs its unparsed body for HMAC verification. Registering
     * this path with express.raw() BEFORE the global JSON parser is the single
     * most important line in this service — parsing first silently breaks
     * every legitimate webhook signature.
     *
     * This still holds when mounted into the single-process entry point: that
     * file deliberately registers no body parser of its own, so the raw bytes
     * reach this app untouched.
     */
    rawBodyPaths: ['/api/payments/webhook'],
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