/**
 * Notification worker entry point.
 *
 *   Order Created → BullMQ Queue → Redis → Worker → Push Notification
 *
 * A separate process from the Notification Service, so delivery load never
 * affects API latency and the worker can be scaled or restarted on its own.
 *
 * The worker itself is built by worker.js, shared with the root single-process
 * entry point. This file is only the process wrapper.
 */
import { createLogger } from '@oms/shared';
import { startNotificationWorker, SERVICE_NAME } from './worker.js';

const logger = createLogger(SERVICE_NAME);

async function main() {
  const { close } = await startNotificationWorker();

  const shutdown = async (signal) => {
    logger.info({ signal }, 'shutting down worker');
    await close();
    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  logger.fatal({ err }, 'worker failed to start');
  process.exit(1);
});