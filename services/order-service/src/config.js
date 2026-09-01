/**
 * Order Service configuration (US-SYS-7 AC5).
 */
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import dotenv from 'dotenv';
import { loadEnv, envField, baseEnvShape } from '@oms/shared';

const here = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(here, '../../../.env') });

export const config = loadEnv({
  ...baseEnvShape,
  MONGODB_URI: envField.requiredString(),
  REDIS_URL: envField.requiredString(),
  ORDER_SERVICE_PORT: envField.port(4003),
  PRODUCT_SERVICE_URL: envField.url(),
  JWT_SECRET: envField.secret(32),
  CORS_ORIGINS: envField.csv(),
  RATE_LIMIT_WINDOW_MS: envField.int(900_000),
  RATE_LIMIT_MAX: envField.int(100),
  QUEUE_ATTEMPTS: envField.int(5),
  QUEUE_BACKOFF_DELAY_MS: envField.int(1000),
});

export const SERVICE_NAME = 'order-service';
