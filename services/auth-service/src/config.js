/**
 * Auth Service configuration.
 *
 * Loads .env from the repository root (one shared file for local development)
 * and validates it. A missing or malformed variable stops the process here
 * with a readable message rather than surfacing as a runtime failure later
 * (US-SYS-7 AC5).
 */
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import dotenv from 'dotenv';
import { z } from 'zod';
import { loadEnv, envField, baseEnvShape } from '@oms/shared';

const here = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(here, '../../../.env') });

export const config = loadEnv({
  ...baseEnvShape,
  MONGODB_URI: envField.requiredString(),
  AUTH_SERVICE_PORT: envField.port(4001),
  JWT_SECRET: envField.secret(32),
  JWT_EXPIRES_IN: z.string().default('7d'),
  BCRYPT_SALT_ROUNDS: z.coerce.number().int().min(10).max(15).default(12),
  CORS_ORIGINS: envField.csv(),
  RATE_LIMIT_WINDOW_MS: envField.int(900_000),
  AUTH_RATE_LIMIT_MAX: envField.int(10),
});

export const SERVICE_NAME = 'auth-service';
