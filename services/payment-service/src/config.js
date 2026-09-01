/**
 * Payment Service configuration (US-SYS-7 AC5).
 *
 * The gateway secret and webhook secret live here and nowhere else. Neither is
 * ever sent to the browser; only RAZORPAY_KEY_ID (the public key id) is.
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
  PAYMENT_SERVICE_PORT: envField.port(4004),
  ORDER_SERVICE_URL: envField.url(),
  JWT_SECRET: envField.secret(32),
  CORS_ORIGINS: envField.csv(),
  RATE_LIMIT_WINDOW_MS: envField.int(900_000),
  RATE_LIMIT_MAX: envField.int(100),
  QUEUE_ATTEMPTS: envField.int(5),
  QUEUE_BACKOFF_DELAY_MS: envField.int(1000),
  RAZORPAY_KEY_ID: envField.requiredString(),
  RAZORPAY_KEY_SECRET: envField.requiredString(),
  RAZORPAY_WEBHOOK_SECRET: envField.requiredString(),
});

/**
 * Token used for service-to-service calls to the Order Service.
 *
 * The order payment endpoint is guarded by requireRole(ADMIN) so no customer
 * token can reach it. The Payment Service mints a short-lived service token
 * signed with the same JWT secret, rather than the endpoint being left
 * unguarded — the guard is what makes US-PAY-4 AC7 hold.
 */
export const config = {
  ...parsed,
  INTERNAL_TOKEN: jwt.sign(
    { sub: 'payment-service', role: Role.ADMIN, service: true },
    parsed.JWT_SECRET,
    { expiresIn: '12h' },
  ),
};

export const SERVICE_NAME = 'payment-service';
