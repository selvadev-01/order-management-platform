/**
 * Authentication and authorization middleware (US-AUTH-5, US-AUTH-6).
 *
 * Every service applies these itself. The gateway routes traffic; it is not
 * the security boundary — a request reaching a service directly is still
 * checked here (US-SYS-4, US-SYS-5).
 */
import jwt from 'jsonwebtoken';
import { unauthenticated, forbidden } from './errors.js';

/**
 * Verify the bearer token and attach the user to the request.
 *
 * The role is read from the VERIFIED token claim, never from the request body
 * or any client-supplied field — this is what makes US-AUTH-6 hold.
 */
export function authenticate(secret) {
  return (req, _res, next) => {
    const header = req.headers.authorization;

    if (!header || !header.startsWith('Bearer ')) {
      return next(unauthenticated('Authentication required'));
    }

    const token = header.slice('Bearer '.length).trim();
    if (!token) return next(unauthenticated('Authentication required'));

    try {
      // clockTolerance absorbs small skew between services (US-AUTH-2 edge case).
      const payload = jwt.verify(token, secret, { clockTolerance: 30 });
      req.user = { id: payload.sub, role: payload.role, email: payload.email };
      req.token = token;
      next();
    } catch (err) {
      next(err); // normalizeError maps JWT errors to 401
    }
  };
}

/**
 * Require one of the given roles. Runs AFTER authenticate.
 *
 * Denials are logged with the user and route, since repeated 403s are a
 * meaningful signal (US-AUTH-6, US-SYS-3 AC4).
 *
 * Roles are allowlisted, so an unknown role value is denied by default.
 */
export function requireRole(...roles) {
  return (req, _res, next) => {
    if (!req.user) return next(unauthenticated('Authentication required'));

    if (!roles.includes(req.user.role)) {
      req.log?.warn(
        { userId: req.user.id, role: req.user.role, required: roles, path: req.originalUrl },
        'authorization denied',
      );
      return next(forbidden('You do not have permission to do that'));
    }

    next();
  };
}

/**
 * Attach the user when a token is present, but do not require one.
 * For endpoints that are public yet behave differently when signed in.
 */
export function optionalAuth(secret) {
  return (req, _res, next) => {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) return next();
    try {
      const payload = jwt.verify(header.slice(7).trim(), secret, { clockTolerance: 30 });
      req.user = { id: payload.sub, role: payload.role, email: payload.email };
    } catch {
      // A bad token on an optional route is simply ignored.
    }
    next();
  };
}

export function signToken(user, secret, expiresIn) {
  return jwt.sign(
    { sub: String(user._id ?? user.id), role: user.role, email: user.email },
    secret,
    { expiresIn },
  );
}
