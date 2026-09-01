/**
 * Application error types and the single error response shape used by every
 * service. Implements US-SYS-1 (centralized error handling, correct status
 * codes, no internals leaked to clients).
 */

export const ErrorCode = {
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  RATE_LIMITED: 'RATE_LIMITED',
  INTERNAL: 'INTERNAL',
  BAD_GATEWAY: 'BAD_GATEWAY',
};

/**
 * An error the server raises deliberately, carrying the status code and
 * machine-readable code the client should receive.
 *
 * Anything that is NOT an AppError is treated as unexpected: it is logged in
 * full and reported to the client as a bare 500 with no detail.
 */
export class AppError extends Error {
  constructor(message, { status = 500, code = ErrorCode.INTERNAL, details } = {}) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.details = details;
    this.expected = true;
    Error.captureStackTrace?.(this, AppError);
  }
}

export const badRequest = (message, details) =>
  new AppError(message, { status: 400, code: ErrorCode.VALIDATION_ERROR, details });

export const unauthenticated = (message = 'Authentication required') =>
  new AppError(message, { status: 401, code: ErrorCode.UNAUTHENTICATED });

export const forbidden = (message = 'You do not have permission to do that') =>
  new AppError(message, { status: 403, code: ErrorCode.FORBIDDEN });

export const notFound = (message = 'Not found') =>
  new AppError(message, { status: 404, code: ErrorCode.NOT_FOUND });

export const conflict = (message, details) =>
  new AppError(message, { status: 409, code: ErrorCode.CONFLICT, details });

export const badGateway = (message = 'Upstream service unavailable') =>
  new AppError(message, { status: 502, code: ErrorCode.BAD_GATEWAY });

/**
 * Translate driver- and library-level errors into AppErrors so controllers do
 * not each have to recognise them.
 *
 * Covers the cases called out in US-SYS-1's edge cases: Mongoose cast errors
 * become 400 rather than 500, and duplicate-key errors become 409 (which is
 * what US-AUTH-1's simultaneous-registration case depends on).
 */
export function normalizeError(err) {
  if (err instanceof AppError) return err;

  // Mongo duplicate key
  if (err?.code === 11000) {
    const field = Object.keys(err.keyPattern ?? err.keyValue ?? {})[0];
    return conflict(
      field ? `That ${field} is already in use` : 'That value is already in use',
      field ? [{ field, message: 'Already in use' }] : undefined,
    );
  }

  // Mongoose bad ObjectId
  if (err?.name === 'CastError') {
    return badRequest('Malformed identifier');
  }

  // Mongoose schema validation
  if (err?.name === 'ValidationError' && err.errors) {
    return badRequest(
      'Validation failed',
      Object.entries(err.errors).map(([field, e]) => ({ field, message: e.message })),
    );
  }

  // JWT failures
  if (err?.name === 'JsonWebTokenError' || err?.name === 'TokenExpiredError') {
    return unauthenticated('Invalid or expired token');
  }

  return null; // unexpected — caller decides how to report it
}

/** Build the wire format. Never include a stack outside development. */
export function toResponseBody(err, { includeStack = false } = {}) {
  const body = {
    error: {
      message: err.expected ? err.message : 'Something went wrong',
      code: err.code ?? ErrorCode.INTERNAL,
    },
  };
  if (err.details) body.error.details = err.details;
  if (includeStack && err.stack) body.error.stack = err.stack;
  return body;
}
