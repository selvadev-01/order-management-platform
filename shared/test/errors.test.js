/**
 * Error normalization and the wire format (US-SYS-1).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AppError,
  ErrorCode,
  badRequest,
  unauthenticated,
  forbidden,
  notFound,
  conflict,
  normalizeError,
  toResponseBody,
} from '../src/errors.js';

test('helpers carry the right status codes', () => {
  assert.equal(badRequest('x').status, 400);
  assert.equal(unauthenticated().status, 401);
  assert.equal(forbidden().status, 403);
  assert.equal(notFound().status, 404);
  assert.equal(conflict('x').status, 409);
});

test('duplicate key becomes 409 naming the field', () => {
  const err = normalizeError({ code: 11000, keyPattern: { email: 1 } });
  assert.equal(err.status, 409);
  assert.equal(err.details[0].field, 'email');
});

test('malformed ObjectId becomes 400, not 500', () => {
  assert.equal(normalizeError({ name: 'CastError' }).status, 400);
});

test('mongoose validation error becomes 400 with per-field detail', () => {
  const err = normalizeError({
    name: 'ValidationError',
    errors: { price: { message: 'Price must be positive' } },
  });
  assert.equal(err.status, 400);
  assert.deepEqual(err.details, [{ field: 'price', message: 'Price must be positive' }]);
});

test('JWT failures become 401', () => {
  assert.equal(normalizeError({ name: 'JsonWebTokenError' }).status, 401);
  assert.equal(normalizeError({ name: 'TokenExpiredError' }).status, 401);
});

test('an unrecognised error returns null so the caller reports a bare 500', () => {
  assert.equal(normalizeError(new Error('boom')), null);
});

test('unexpected errors never leak their message to the client', () => {
  const leaky = Object.assign(new Error('connect ECONNREFUSED 10.0.0.5:27017'), {
    expected: false,
  });
  const body = toResponseBody(leaky);
  assert.equal(body.error.message, 'Something went wrong');
  assert.ok(!JSON.stringify(body).includes('10.0.0.5'));
});

test('expected errors do surface their message', () => {
  assert.equal(toResponseBody(badRequest('Email is invalid')).error.message, 'Email is invalid');
});

test('stack traces are omitted by default', () => {
  assert.equal(toResponseBody(new AppError('x', { status: 400 })).error.stack, undefined);
});

test('AppError defaults to a 500 INTERNAL', () => {
  const e = new AppError('x');
  assert.equal(e.status, 500);
  assert.equal(e.code, ErrorCode.INTERNAL);
});
