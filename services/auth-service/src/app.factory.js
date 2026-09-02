/**
 * Builds the Auth Service Express app without starting a server.
 *
 * Extracted from index.js so the service can be run two ways from one
 * definition: as its own process (index.js, the normal deployment) or mounted
 * into the single-process entry point at the repo root, where a free host
 * gives us only one port. The app itself is identical either way — same
 * routes, same JWT verification, same role checks.
 */
import { createApp, finalizeApp, createLogger } from '@oms/shared';
import { config, SERVICE_NAME } from './config.js';
import { connectDb, disconnectDb, syncIndexes } from './db.js';
import { User } from './models/user.model.js';
import { buildRoutes } from './auth.routes.js';

/**
 * @param {object}  [opts]
 * @param {boolean} [opts.connectDatabase=true]
 *   Pass false when the caller already holds a mongoose connection to the same
 *   URI, as the single-process entry point does — a second connect() on the
 *   default connection would throw.
 * @returns {Promise<{ app: import('express').Express, onShutdown: () => Promise<void> }>}
 */
export async function createServiceApp({ connectDatabase = true } = {}) {
  const logger = createLogger(SERVICE_NAME);

  if (connectDatabase) {
    await connectDb(config.MONGODB_URI, logger);
  }

  // Indexes are synced regardless of who opened the connection: the unique
  // email index is what prevents duplicate registrations.
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

  return {
    app,
    logger,
    // Only tear down the connection if this factory opened it.
    onShutdown: connectDatabase ? disconnectDb : async () => {},
  };
}
