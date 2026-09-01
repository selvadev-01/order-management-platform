/**
 * Express application factory. Every service builds its app through this, so
 * the security controls in US-SYS-7 are applied uniformly and cannot be strong
 * in one service and absent in another.
 */
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { requestLogger } from './logger.js';
import { errorHandler, lastResort, notFoundHandler } from './middleware.js';

/**
 * @param {object} opts
 * @param {string}   opts.service      name, for logs and the health endpoint
 * @param {object}   opts.logger       pino instance
 * @param {string[]} opts.corsOrigins  explicit allowlist — never a wildcard
 * @param {object}   [opts.rateLimit]  { windowMs, max }
 * @param {string[]} [opts.rawBodyPaths] paths needing the unparsed body
 */
export function createApp({ service, logger, corsOrigins, rateLimit: limits, rawBodyPaths = [] }) {
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', 1); // so the rate limiter sees the real client IP

  app.use(helmet());

  app.use(
    cors({
      origin(origin, callback) {
        // Non-browser callers (curl, server-to-server) send no Origin.
        if (!origin) return callback(null, true);
        if (corsOrigins.includes(origin)) return callback(null, true);
        logger.warn({ origin }, 'CORS origin rejected');
        callback(null, false);
      },
      credentials: true,
    }),
  );

  /**
   * Raw-body routes are registered BEFORE the JSON parser.
   *
   * The payment webhook computes its HMAC over the exact bytes received; if
   * express.json() parses and re-serialises first, verification fails. This is
   * the single most common implementation error in the payment flow
   * (US-PAY-4, US-SYS-4 edge case).
   */
  for (const path of rawBodyPaths) {
    app.use(path, express.raw({ type: '*/*', limit: '1mb' }));
  }

  app.use(express.json({ limit: '100kb' }));
  app.use(express.urlencoded({ extended: true, limit: '100kb' }));

  app.use(requestLogger(logger));

  if (limits) {
    app.use(
      rateLimit({
        windowMs: limits.windowMs,
        max: limits.max,
        standardHeaders: true,
        legacyHeaders: false,
        message: {
          error: { message: 'Too many requests, please try again shortly', code: 'RATE_LIMITED' },
        },
      }),
    );
  }

  app.get('/health', (_req, res) => res.json({ status: 'ok', service }));

  return app;
}

/** Register the tail middleware. Call AFTER mounting all routes. */
export function finalizeApp(app, logger) {
  app.use(notFoundHandler);
  app.use(errorHandler(logger));
  app.use(lastResort(logger));
  return app;
}

/** Start listening, with graceful shutdown. */
export function startServer(app, { port, service, logger, onShutdown }) {
  const server = app.listen(port, () => {
    logger.info({ port }, `${service} listening`);
  });

  const shutdown = async (signal) => {
    logger.info({ signal }, 'shutting down');
    server.close(async () => {
      try {
        await onShutdown?.();
      } catch (err) {
        logger.error({ err }, 'shutdown error');
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

  return server;
}
