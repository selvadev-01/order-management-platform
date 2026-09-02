/**
 * Notification Service entry point.
 *
 * Responsibilities (docx §5): push notifications, order notifications,
 * payment notifications.
 *
 * This process serves HTTP only. Job consumption is the worker's job
 * (`workers/notification-worker`), so delivery load never affects API latency.
 *
 * The app is built by app.factory.js, shared with the root single-process
 * entry point. This file is only the process wrapper.
 */
import { startServer, createLogger } from '@oms/shared';
import { config, SERVICE_NAME } from './config.js';
import { createServiceApp } from './app.factory.js';

const logger = createLogger(SERVICE_NAME);

async function main() {
  const { app, onShutdown } = await createServiceApp();

  startServer(app, {
    port: config.NOTIFICATION_SERVICE_PORT,
    service: SERVICE_NAME,
    logger,
    onShutdown,
  });
}

main().catch((err) => {
  logger.fatal({ err }, 'failed to start');
  process.exit(1);
});