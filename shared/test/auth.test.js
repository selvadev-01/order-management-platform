/**
 * Authentication and authorization middleware (US-AUTH-5, US-AUTH-6).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import { authenticate, requireRole, optionalAuth, signToken } from '../src/auth.js';
import { normalizeError } from '../src/errors.js';
import { Role } from '../src/constants.js';

const SECRET = 'test_secret_at_least_32_characters_long';

/** Runs a middleware and reports what it passed to next(). */
function run(middleware, req) {
  return new Promise((resolve) => {
    const request = { headers: {}, ...req };
    middleware(request, {}, (err) => resolve({ err, req: request }));
  });
}

/** Middleware forwards raw JWT errors; the error handler maps them to 401. */
function statusOf(err) {
  if (!err) return null;
  return err.status ?? normalizeError(err)?.status ?? 500;
}

test('a valid token attaches the user from the verified claims', async () => {
  const token = signToken({ _id: 'u1', role: Role.CUSTOMER, email: 'a@b.c' }, SECRET, '1h');
  const { err, req } = await run(authenticate(SECRET), {
    headers: { authorization: `Bearer ${token}` },
  });

  assert.equal(err, undefined);
  assert.equal(req.user.id, 'u1');
  assert.equal(req.user.role, Role.CUSTOMER);
});

test('a missing Authorization header is a 401', async () => {
  const { err } = await run(authenticate(SECRET), {});
  assert.equal(statusOf(err), 401);
});

test('a header without the Bearer prefix is a 401, not a crash', async () => {
  const token = signToken({ _id: 'u1', role: Role.CUSTOMER }, SECRET, '1h');
  const { err } = await run(authenticate(SECRET), { headers: { authorization: token } });
  assert.equal(statusOf(err), 401);
});

test('a token signed with another secret is rejected', async () => {
  const forged = jwt.sign({ sub: 'u1', role: Role.ADMIN }, 'a_completely_different_secret_value');
  const { err } = await run(authenticate(SECRET), {
    headers: { authorization: `Bearer ${forged}` },
  });
  assert.equal(statusOf(err), 401);
});

test('an expired token is rejected', async () => {
  const expired = jwt.sign({ sub: 'u1', role: Role.CUSTOMER }, SECRET, { expiresIn: -60 });
  const { err } = await run(authenticate(SECRET), {
    headers: { authorization: `Bearer ${expired}` },
  });
  assert.equal(statusOf(err), 401);
});

test('a malformed token is rejected', async () => {
  const { err } = await run(authenticate(SECRET), {
    headers: { authorization: 'Bearer not.a.jwt' },
  });
  assert.equal(statusOf(err), 401);
});

test('the required role is allowed through', async () => {
  const { err } = await run(requireRole(Role.ADMIN), { user: { id: 'u1', role: Role.ADMIN } });
  assert.equal(err, undefined);
});

/** The check that keeps customers out of admin endpoints. */
test('a customer is refused an admin route with 403, distinct from 401', async () => {
  const { err } = await run(requireRole(Role.ADMIN), {
    user: { id: 'u1', role: Role.CUSTOMER },
    log: { warn() {} },
  });
  assert.equal(statusOf(err), 403);
});

test('an unknown role is denied by default', async () => {
  const { err } = await run(requireRole(Role.ADMIN), {
    user: { id: 'u1', role: 'SUPERUSER' },
    log: { warn() {} },
  });
  assert.equal(statusOf(err), 403);
});

test('requireRole without a session is a 401', async () => {
  const { err } = await run(requireRole(Role.ADMIN), {});
  assert.equal(statusOf(err), 401);
});

/**
 * Role comes from the signed token, never from the request body — otherwise
 * any caller could self-promote.
 */
test('a role in the request body cannot override the token claim', async () => {
  const token = signToken({ _id: 'u1', role: Role.CUSTOMER, email: 'a@b.c' }, SECRET, '1h');
  const { req } = await run(authenticate(SECRET), {
    headers: { authorization: `Bearer ${token}` },
    body: { role: Role.ADMIN },
  });
  assert.equal(req.user.role, Role.CUSTOMER);

  const { err } = await run(requireRole(Role.ADMIN), { ...req, log: { warn() {} } });
  assert.equal(statusOf(err), 403);
});

test('optionalAuth passes through without a token', async () => {
  const { err, req } = await run(optionalAuth(SECRET), {});
  assert.equal(err, undefined);
  assert.equal(req.user, undefined);
});

test('optionalAuth ignores a bad token instead of failing', async () => {
  const { err, req } = await run(optionalAuth(SECRET), {
    headers: { authorization: 'Bearer garbage' },
  });
  assert.equal(err, undefined);
  assert.equal(req.user, undefined);
});

test('signed tokens carry sub, role and email', () => {
  const token = signToken({ _id: 'u9', role: Role.ADMIN, email: 'admin@x.io' }, SECRET, '1h');
  const decoded = jwt.verify(token, SECRET);
  assert.equal(decoded.sub, 'u9');
  assert.equal(decoded.role, Role.ADMIN);
  assert.equal(decoded.email, 'admin@x.io');
});
