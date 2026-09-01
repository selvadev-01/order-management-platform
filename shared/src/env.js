/**
 * Environment loading and validation (US-SYS-7 AC5).
 *
 * A service fails fast at startup with a clear message when a required
 * variable is missing, rather than starting in a broken state and failing
 * later on a request.
 */
import { z } from 'zod';

/**
 * @param {Record<string, import('zod').ZodTypeAny>} shape
 * @returns parsed, typed environment
 */
export function loadEnv(shape) {
  const schema = z.object(shape);
  const result = schema.safeParse(process.env);

  if (!result.success) {
    const missing = result.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    // Written to stderr directly: the logger may not exist yet at this point.
    console.error(
      `\nInvalid or missing environment variables:\n${missing}\n\n` +
        `Copy .env.example to .env and fill in the values.\n`,
    );
    process.exit(1);
  }

  return result.data;
}

/** Building blocks reused by each service's schema. */
export const envField = {
  port: (fallback) => z.coerce.number().int().positive().default(fallback),
  url: () => z.string().url(),
  requiredString: (min = 1) => z.string().min(min),
  secret: (min = 16) =>
    z.string().min(min, `must be at least ${min} characters — generate a strong random value`),
  nodeEnv: () => z.enum(['development', 'test', 'production']).default('development'),
  logLevel: () => z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  csv: () =>
    z
      .string()
      .default('')
      .transform((v) => v.split(',').map((s) => s.trim()).filter(Boolean)),
  int: (fallback) => z.coerce.number().int().default(fallback),
};

/** Common variables every service needs. */
export const baseEnvShape = {
  NODE_ENV: envField.nodeEnv(),
  LOG_LEVEL: envField.logLevel(),
};
