/**
 * Structured logging (US-SYS-3).
 *
 * Redaction is configured centrally so a new call site cannot leak a secret by
 * logging a whole request body — the failure mode US-SYS-3 AC3 exists to stop.
 */
import pino from 'pino';

const REDACT_PATHS = [
  'password',
  'newPassword',
  'confirmPassword',
  'passwordHash',
  'token',
  'accessToken',
  'jwt',
  'authorization',
  'req.headers.authorization',
  'req.headers.cookie',
  'req.body.password',
  'signature',
  'razorpay_signature',
  '*.password',
  '*.passwordHash',
  '*.token',
];

export function createLogger(service) {
  return pino({
    name: service,
    level: process.env.LOG_LEVEL ?? 'info',
    redact: { paths: REDACT_PATHS, censor: '[redacted]' },
    transport:
      process.env.NODE_ENV === 'development'
        ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss' } }
        : undefined,
  });
}

/**
 * Request logging: method, path, status, duration (US-SYS-3 AC1).
 * Attaches a child logger to the request so handlers log with context.
 */
export function requestLogger(logger) {
  return (req, res, next) => {
    const start = process.hrtime.bigint();
    req.log = logger;

    res.on('finish', () => {
      const durationMs = Number(process.hrtime.bigint() - start) / 1e6;
      const level = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info';
      logger[level](
        {
          method: req.method,
          path: req.originalUrl,
          status: res.statusCode,
          durationMs: Math.round(durationMs * 10) / 10,
          userId: req.user?.id,
        },
        'request',
      );
    });

    next();
  };
}
