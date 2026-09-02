/**
 * Order Service entry point.
 *
 * Responsibilities (docx §5): cart, orders, order status.
 * Produces BullMQ jobs on order creation and status change (docx §7).
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
    port: config.ORDER_SERVICE_PORT,
    service: SERVICE_NAME,
    logger,
    onShutdown,
  });
}

main().catch((err) => {
  logger.fatal({ err }, 'failed to start');
  process.exit(1);
});