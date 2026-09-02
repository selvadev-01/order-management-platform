/**
 * Single-process production entry point.
 *
 * WHY THIS EXISTS
 * ---------------
 * In development (`npm run dev`) each service is its own OS process, exactly as
 * the architecture in the README describes. Free hosting tiers, however, run
 * ONE command that binds ONE port, and offer no separate background-worker
 * process type — so the BullMQ worker would have nowhere to live.
 *
 * This file composes the same services into one process WITHOUT changing them:
 * each service still builds its own Express app, mounts its own routes, and
 * verifies the JWT and its own roles independently. Only the process boundary
 * moves. Nothing here is imported by the per-service entry points, so local
 * development and the service-per-process deployment are entirely unaffected.
 *
 *   dev / full deploy:  8 processes, gateway proxies over HTTP
 *   this file:          1 process, gateway mounts the same apps in-band
 *
 * The gateway's HTTP proxy is deliberately NOT used here. Proxying to
 * 127.0.0.1 would mean each request crossed the loopback twice for no benefit,
 * and would need five extra listeners inside a 512 MB instance. Instead the
 * service apps are mounted directly, which preserves the raw request body that
 * the payment webhook's HMAC verification depends on.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import mongoose from 'mongoose';
import { createLogger, requestLogger } from '@oms/shared';

const here = path.dirname(fileURLToPath(import.meta.url));

/**
 * Load .env when present, for running this file locally.
 *
 * On a hosting platform there is no .env file — the variables come from the
 * dashboard. dotenv never overwrites a variable that is already set, so the
 * platform's values always win and this call is a no-op there.
 */
dotenv.config({ path: path.resolve(here, '.env') });

const logger = createLogger('server');

/**
 * Route prefix → the service module that owns it.
 *
 * Mirrors gateway/src/config.js exactly. Order matters for the same reason it
 * does there: more specific prefixes must be matched before broader ones.
 */
const SERVICES = [
  {
    name: 'auth-service',
    prefixes: ['/api/auth', '/api/users'],
    load: () => import('./services/auth-service/src/app.factory.js'),
  },
  {
    name: 'product-service',
    prefixes: ['/api/products', '/api/categories'],
    load: () => import('./services/product-service/src/app.factory.js'),
  },
  {
    name: 'order-service',
    prefixes: ['/api/cart', '/api/orders'],
    load: () => import('./services/order-service/src/app.factory.js'),
  },
  {
    name: 'payment-service',
    prefixes: ['/api/payments'],
    load: () => import('./services/payment-service/src/app.factory.js'),
  },
  {
    name: 'notification-service',
    prefixes: ['/api/notifications'],
    load: () => import('./services/notification-service/src/app.factory.js'),
  },
];

/** Cleanups registered by each service, run in reverse on shutdown. */
const teardown = [];

async function main() {
  /**
   * One MongoDB connection for the whole process.
   *
   * Each service normally opens its own. Here they share mongoose's default
   * connection — they already all point at the same MONGODB_URI, and a free
   * Atlas cluster has a small connection cap that six independent pools would
   * waste. Models are registered per service module as before.
   */
  mongoose.set('strictQuery', true);
  await mongoose.connect(process.env.MONGODB_URI, {
    serverSelectionTimeoutMS: 5000,
    autoIndex: false,
  });
  logger.info({ db: mongoose.connection.name }, 'mongodb connected');
  teardown.push(() => mongoose.disconnect());

  const app = express();

  app.disable('x-powered-by');
  // Render/Vercel/Fly terminate TLS at a proxy; without this the rate limiter
  // would see the proxy's IP for every request and throttle all users as one.
  app.set('trust proxy', 1);

  app.use(helmet());

  const corsOrigins = (process.env.CORS_ORIGINS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  app.use(
    cors({
      origin(origin, callback) {
        // Non-browser callers (curl, the payment gateway's webhook) send no Origin.
        if (!origin) return callback(null, true);
        if (corsOrigins.includes(origin)) return callback(null, true);
        logger.warn({ origin }, 'CORS origin rejected');
        callback(null, false);
      },
      credentials: true,
    }),
  );

  app.use(
    rateLimit({
      windowMs: Number(process.env.RATE_LIMIT_WINDOW_MS ?? 900_000),
      max: Number(process.env.RATE_LIMIT_MAX ?? 300),
      standardHeaders: true,
      legacyHeaders: false,
      // The webhook is exempt for the same reason it is in the gateway: a
      // retry storm from the payment provider must not become dropped
      // payment events. The payment service applies its own limit.
      skip: (req) => req.path === '/api/payments/webhook',
      message: {
        error: { message: 'Too many requests, please try again shortly', code: 'RATE_LIMITED' },
      },
    }),
  );

  app.use(requestLogger(logger));

  // The platform assigns the port; PORT is never something we choose. Read
  // here rather than at listen() because the service clients below need it.
  const port = Number(process.env.PORT ?? 4000);

  const mounted = [];

  /**
   * Cross-service calls point back at this process.
   *
   * order-service asks product-service for stock, payment-service updates
   * order-service, and so on — through ServiceClient over HTTP. In one process
   * there is no separate host to call, so those clients are pointed at our own
   * origin and the request loops back through the same listener. The alternative
   * (importing another service's internals directly) would break the service
   * boundary the architecture is built on.
   */
  const selfUrl = `http://127.0.0.1:${port}`;

  for (const service of SERVICES) {
    const { createServiceApp } = await service.load();
    const { app: serviceApp, onShutdown } = await createServiceApp({
      // The connection above is already open on mongoose's default connection;
      // a second connect() to the same URI would throw.
      connectDatabase: false,
      productServiceUrl: selfUrl,
      orderServiceUrl: selfUrl,
    });

    if (onShutdown) teardown.push(onShutdown);

    /**
     * Mounted at root with a path filter, not `app.use(prefix, serviceApp)`.
     *
     * Express strips the mount path before the sub-app runs, so mounting on
     * the prefix would hand the service a truncated URL — the services mount
     * the full /api paths themselves. This matches how the gateway filters.
     */
    for (const prefix of service.prefixes) {
      app.use((req, res, next) => {
        if (!req.path.startsWith(prefix)) return next();
        return serviceApp(req, res, next);
      });
    }

    mounted.push({ service: service.name, prefixes: service.prefixes });
    logger.info({ service: service.name, prefixes: service.prefixes }, 'service mounted');
  }

  /**
   * The BullMQ worker, in-process.
   *
   * Started after the services so its Mongo models are already registered.
   * On a platform with a real worker process type this stays a separate
   * deployment — see workers/notification-worker.
   */
  const { startNotificationWorker } = await import('./workers/notification-worker/src/worker.js');
  const { close: closeWorker } = await startNotificationWorker({
    connectDatabase: false,
    orderServiceUrl: selfUrl,
  });
  teardown.push(closeWorker);
  logger.info('notification worker started in-process');

  app.get('/health', (_req, res) => {
    res.json({
      status: 'ok',
      mode: 'single-process',
      mongo: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
      services: mounted,
    });
  });

  app.use((req, res) => {
    res.status(404).json({
      error: { message: `Cannot ${req.method} ${req.originalUrl}`, code: 'NOT_FOUND' },
    });
  });

  // 0.0.0.0, not localhost — a container-internal bind is unreachable from
  // the platform's router and the deploy would be marked failed.
  const server = app.listen(port, '0.0.0.0', () => {
    logger.info({ port }, 'server listening');
  });

  const shutdown = (signal) => {
    logger.info({ signal }, 'shutting down');
    server.close(async () => {
      // Reverse order: the worker drains before its Redis and Mongo close.
      for (const fn of teardown.reverse()) {
        try {
          await fn();
        } catch (err) {
          logger.error({ err: err.message }, 'shutdown step failed');
        }
      }
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('unhandledRejection', (err) => logger.error({ err }, 'unhandled rejection'));
  process.on('uncaughtException', (err) => {
    logger.fatal({ err }, 'uncaught exception');
    process.exit(1);
  });
}

main().catch((err) => {
  logger.fatal({ err }, 'failed to start');
  process.exit(1);
});
