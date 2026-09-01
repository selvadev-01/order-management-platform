/**
 * Notification Service configuration (US-SYS-7 AC5).
 */
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import dotenv from 'dotenv';
import jwt from 'jsonwebtoken';
import { loadEnv, envField, baseEnvShape, Role } from '@oms/shared';

const here = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(here, '../../../.env') });

const parsed = loadEnv({
  ...baseEnvShape,
  MONGODB_URI: envField.requiredString(),
  REDIS_URL: envField.requiredString(),
  NOTIFICATION_SERVICE_PORT: envField.port(4005),
  ORDER_SERVICE_URL: envField.url(),
  JWT_SECRET: envField.secret(32),
  CORS_ORIGINS: envField.csv(),
  RATE_LIMIT_WINDOW_MS: envField.int(900_000),
  RATE_LIMIT_MAX: envField.int(100),
  QUEUE_ATTEMPTS: envField.int(5),
  QUEUE_BACKOFF_DELAY_MS: envField.int(1000),
  VAPID_PUBLIC_KEY: envField.requiredString(),
  VAPID_PRIVATE_KEY: envField.requiredString(),
  VAPID_SUBJECT: envField.requiredString(),
});

/**
 * Service token for reading orders when building notification content. The
 * order endpoints are guarded, so the worker authenticates like any caller
 * rather than the guard being relaxed for it.
 */
export const config = {
  ...parsed,
  INTERNAL_TOKEN: jwt.sign(
    { sub: 'notification-service', role: Role.ADMIN, service: true },
    parsed.JWT_SECRET,
    { expiresIn: '12h' },
  ),
};

export const SERVICE_NAME = 'notification-service';
