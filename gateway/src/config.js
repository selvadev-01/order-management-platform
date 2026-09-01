/**
 * API Gateway configuration (US-SYS-4, US-SYS-7 AC5).
 */
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import dotenv from 'dotenv';
import { loadEnv, envField, baseEnvShape } from '@oms/shared';

const here = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(here, '../../.env') });

export const config = loadEnv({
  ...baseEnvShape,
  GATEWAY_PORT: envField.port(4000),
  AUTH_SERVICE_URL: envField.url(),
  PRODUCT_SERVICE_URL: envField.url(),
  ORDER_SERVICE_URL: envField.url(),
  PAYMENT_SERVICE_URL: envField.url(),
  NOTIFICATION_SERVICE_URL: envField.url(),
  CORS_ORIGINS: envField.csv(),
  RATE_LIMIT_WINDOW_MS: envField.int(900_000),
  RATE_LIMIT_MAX: envField.int(300),
});

export const SERVICE_NAME = 'api-gateway';

/**
 * Path prefix → service. Order matters: longer, more specific prefixes are
 * matched first so `/api/users` is not swallowed by a broader rule.
 */
export const ROUTES = [
  { prefix: '/api/auth', target: config.AUTH_SERVICE_URL, name: 'auth-service' },
  { prefix: '/api/users', target: config.AUTH_SERVICE_URL, name: 'auth-service' },
  { prefix: '/api/products', target: config.PRODUCT_SERVICE_URL, name: 'product-service' },
  { prefix: '/api/categories', target: config.PRODUCT_SERVICE_URL, name: 'product-service' },
  { prefix: '/api/cart', target: config.ORDER_SERVICE_URL, name: 'order-service' },
  { prefix: '/api/orders', target: config.ORDER_SERVICE_URL, name: 'order-service' },
  { prefix: '/api/payments', target: config.PAYMENT_SERVICE_URL, name: 'payment-service' },
  { prefix: '/api/notifications', target: config.NOTIFICATION_SERVICE_URL, name: 'notification-service' },
];
