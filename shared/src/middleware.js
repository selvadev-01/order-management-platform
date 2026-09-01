/**
 * Express middleware shared by every service: error handling, validation,
 * async wrapping, and 404s.
 */
import { AppError, ErrorCode, normalizeError, toResponseBody, badRequest, notFound } from './errors.js';

/**
 * Wrap an async handler so a rejected promise reaches the error middleware
 * instead of becoming an unhandled rejection (US-SYS-1 edge case).
 *
 * Usage: router.get('/x', asyncHandler(async (req, res) => { ... }))
 */
export const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

/**
 * Validate request parts against Zod schemas (US-SYS-2).
 *
 * Zod strips unknown keys by default, which is what prevents privilege
 * escalation via a `role` field in a registration body (US-AUTH-1) and price
 * tampering at checkout (US-PAY-1). The PARSED value replaces the raw one, so
 * downstream handlers only ever see validated data.
 */
export function validate(schemas) {
  return (req, _res, next) => {
    try {
      for (const part of ['body', 'query', 'params']) {
        if (!schemas[part]) continue;
        const result = schemas[part].safeParse(req[part]);
        if (!result.success) {
          return next(
            badRequest(
              'Validation failed',
              result.error.issues.map((i) => ({
                field: i.path.join('.') || part,
                message: i.message,
              })),
            ),
          );
        }
        // req.query and req.params are getter-only on Express 5; assign fields.
        if (part === 'body') req.body = result.data;
        else Object.assign(req[part], result.data);
      }
      next();
    } catch (err) {
      next(err);
    }
  };
}

/** Unmatched route → 404 through the normal error path. */
export function notFoundHandler(req, _res, next) {
  next(notFound(`Cannot ${req.method} ${req.originalUrl}`));
}

/**
 * Centralized error handler (US-SYS-1). Registered LAST in every service.
 *
 * Expected errors report their own message and status. Anything else is logged
 * in full and reported as a bare 500 — no stack, path, or driver detail
 * reaches the client outside development (AC3, AC4).
 */
export function errorHandler(logger) {
  // eslint-disable-next-line no-unused-vars -- Express identifies this by arity
  return (err, req, res, _next) => {
    let error = normalizeError(err);

    if (!error) {
      logger.error(
        { err, method: req.method, path: req.originalUrl, userId: req.user?.id },
        'unhandled error',
      );
      error = new AppError('Something went wrong', { status: 500, code: ErrorCode.INTERNAL });
      error.expected = false;
    } else if (error.status >= 500) {
      logger.error({ err: error, path: req.originalUrl }, 'server error');
    } else {
      logger.warn(
        { code: error.code, status: error.status, path: req.originalUrl, userId: req.user?.id },
        error.message,
      );
    }

    const includeStack = process.env.NODE_ENV === 'development' && !error.expected;
    res.status(error.status).json(toResponseBody(error, { includeStack }));
  };
}

/** Guards against errors thrown inside the error handler itself. */
export function lastResort(logger) {
  return (err, _req, res, _next) => {
    logger.fatal({ err }, 'error handler failed');
    if (!res.headersSent) res.status(500).json({ error: { message: 'Something went wrong' } });
  };
}
