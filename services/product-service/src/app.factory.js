/**
 * Builds the Product Service Express app without starting a server.
 *
 * See services/auth-service/src/app.factory.js for why this split exists.
 * Owns Redis use case #1 — cache-aside for catalogue reads (docx §6).
 */
import mongoose from 'mongoose';
import {
  createApp,
  finalizeApp,
  createLogger,
  createRedis,
  closeRedis,
  Cache,
} from '@oms/shared';
import { config, SERVICE_NAME } from './config.js';
import { Product } from './models/product.model.js';
import { Category } from './models/category.model.js';
import { ProductService } from './product.service.js';
import { buildControllers } from './product.controller.js';
import { buildRoutes } from './product.routes.js';

/**
 * @param {object}  [opts]
 * @param {boolean} [opts.connectDatabase=true] see auth-service factory
 */
export async function createServiceApp({ connectDatabase = true } = {}) {
  const logger = createLogger(SERVICE_NAME);

  if (connectDatabase) {
    mongoose.set('strictQuery', true);
    await mongoose.connect(config.MONGODB_URI, {
      serverSelectionTimeoutMS: 5000,
      autoIndex: false,
    });
    logger.info({ db: mongoose.connection.name }, 'mongodb connected');
  }

  // Indexes must exist before traffic: the text index backs search, and the
  // unique slug index enforces category uniqueness.
  for (const model of [Product, Category]) {
    await model.syncIndexes();
    logger.debug({ model: model.modelName }, 'indexes synced');
  }

  const redis = createRedis(config.REDIS_URL, logger);
  const cache = new Cache(redis, { ttlSeconds: config.CACHE_TTL_SECONDS, logger });
  const service = new ProductService({ cache, logger });
  const controllers = buildControllers({ service, config });

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
      // This service's own Redis client is always ours to close; the shared
      // Mongo connection is only ours if we opened it.
      await closeRedis(redis, logger);
      if (connectDatabase) await mongoose.disconnect();
    },
  };
}