/**
 * Auth Service entry point.
 *
 * Responsibilities (docx §5): registration, login, JWT authentication,
 * user management.
 */
import { createApp, finalizeApp, startServer, createLogger } from '@oms/shared';
import { config, SERVICE_NAME } from './config.js';
import { connectDb, disconnectDb, syncIndexes } from './db.js';
import { User } from './models/user.model.js';
import { buildRoutes } from './auth.routes.js';

const logger = createLogger(SERVICE_NAME);

async function main() {
  await connectDb(config.MONGODB_URI, logger);
  await syncIndexes([User], logger);

  const app = createApp({
    service: SERVICE_NAME,
    logger,
    corsOrigins: config.CORS_ORIGINS,
    // Per-route credential limits are applied in the router; no blanket
    // service limiter, so token verification stays cheap for other services.
  });

  app.use('/api', buildRoutes());
  finalizeApp(app, logger);

  startServer(app, {
    port: config.AUTH_SERVICE_PORT,
    service: SERVICE_NAME,
    logger,
    onShutdown: disconnectDb,
  });
}

main().catch((err) => {
  logger.fatal({ err }, 'failed to start');
  process.exit(1);
});
