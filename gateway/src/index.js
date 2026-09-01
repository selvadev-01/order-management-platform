/**
 * API Gateway.
 *
 *   React App → API Gateway → [Auth | Product | Order | Payment | Notification]
 *
 * Routes client traffic by path prefix so the frontend talks to one origin and
 * never needs to know the service topology (US-SYS-4).
 *
 * The gateway is NOT the security boundary. Each service still verifies the
 * JWT and enforces its own roles, so a request reaching a service directly is
 * checked exactly the same way (US-SYS-5).
 */
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { createProxyMiddleware } from 'http-proxy-middleware';
import { createLogger, requestLogger } from '@oms/shared';
import { config, SERVICE_NAME, ROUTES } from './config.js';

const logger = createLogger(SERVICE_NAME);
const app = express();

app.disable('x-powered-by');
app.set('trust proxy', 1);

app.use(helmet());

app.use(
  cors({
    origin(origin, callback) {
      if (!origin) return callback(null, true);
      if (config.CORS_ORIGINS.includes(origin)) return callback(null, true);
      logger.warn({ origin }, 'CORS origin rejected');
      callback(null, false);
    },
    credentials: true,
  }),
);

app.use(
  rateLimit({
    windowMs: config.RATE_LIMIT_WINDOW_MS,
    max: config.RATE_LIMIT_MAX,
    standardHeaders: true,
    legacyHeaders: false,
    /**
     * The webhook is exempt from the gateway limiter.
     *
     * A gateway retry storm from the payment provider must not be throttled
     * into dropped payment events; the Payment Service applies its own limit
     * (US-PAY-4 technical notes).
     */
    skip: (req) => req.path === '/api/payments/webhook',
    message: { error: { message: 'Too many requests, please try again shortly', code: 'RATE_LIMITED' } },
  }),
);

app.use(requestLogger(logger));

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: SERVICE_NAME, routes: ROUTES.map((r) => r.prefix) });
});

/** Aggregate health of everything behind the gateway. */
app.get('/health/services', async (_req, res) => {
  const targets = [...new Map(ROUTES.map((r) => [r.name, r.target])).entries()];

  const results = await Promise.all(
    targets.map(async ([name, target]) => {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 2000);
        const upstream = await fetch(`${target}/health`, { signal: controller.signal });
        clearTimeout(timer);
        return { service: name, status: upstream.ok ? 'ok' : 'unhealthy' };
      } catch {
        return { service: name, status: 'unreachable' };
      }
    }),
  );

  const allOk = results.every((r) => r.status === 'ok');
  res.status(allOk ? 200 : 503).json({ status: allOk ? 'ok' : 'degraded', services: results });
});

/**
 * Proxies.
 *
 * NOTE: no body parser is registered anywhere in this process. The proxy
 * streams the request body through untouched, which is what keeps the payment
 * webhook's HMAC signature valid — parsing and re-serialising here would break
 * every legitimate webhook (US-SYS-4 edge case, US-PAY-4).
 */
for (const route of ROUTES) {
  /**
   * Mounted at root with a path filter rather than `app.use(prefix, ...)`.
   *
   * Mounting on a prefix makes Express strip it before the proxy runs, so the
   * upstream would receive a truncated path. Filtering here keeps the original
   * URL intact, which is what the services expect since they mount the same
   * /api paths.
   */
  app.use(
    createProxyMiddleware(
      (pathname) => pathname.startsWith(route.prefix),
      {
        target: route.target,
        changeOrigin: true,
        proxyTimeout: 10_000,
        timeout: 10_000,
        logLevel: 'silent',
        onError(err, req, res) {
          // A downstream outage returns a clear error rather than hanging
          // (US-SYS-4 AC3). Other services keep serving.
          logger.error(
            { err: err.message, service: route.name, path: req.originalUrl },
            'proxy error',
          );
          if (!res.headersSent) {
            res.status(502).json({
              error: { message: `${route.name} is unavailable`, code: 'BAD_GATEWAY' },
            });
          }
        },
      },
    ),
  );
}

app.use((req, res) => {
  res.status(404).json({
    error: { message: `Cannot ${req.method} ${req.originalUrl}`, code: 'NOT_FOUND' },
  });
});

const server = app.listen(config.GATEWAY_PORT, () => {
  logger.info({ port: config.GATEWAY_PORT }, 'api gateway listening');
  for (const r of ROUTES) logger.debug({ prefix: r.prefix, target: r.target }, 'route registered');
});

const shutdown = (signal) => {
  logger.info({ signal }, 'shutting down gateway');
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10_000).unref();
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('unhandledRejection', (err) => logger.error({ err }, 'unhandled rejection'));
