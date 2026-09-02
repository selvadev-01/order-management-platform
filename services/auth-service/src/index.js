/**
 * Auth Service entry point.
 *
 * Responsibilities (docx §5): registration, login, JWT authentication,
 * user management.
 *
 * The app itself is built by app.factory.js, which the root single-process
 * entry point also uses. This file is only the process wrapper: own database
 * connection, own port, own shutdown.
 */
import { startServer, createLogger } from '@oms/shared';
import { config, SERVICE_NAME } from './config.js';
import { createServiceApp } from './app.factory.js';

const logger = createLogger(SERVICE_NAME);

async function main() {
  const { app, onShutdown } = await createServiceApp();

  startServer(app, {
    port: config.AUTH_SERVICE_PORT,
    service: SERVICE_NAME,
    logger,
    onShutdown,
  });
}

main().catch((err) => {
  logger.fatal({ err }, 'failed to start');
  process.exit(1);
});
