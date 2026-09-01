/**
 * Payment webhook signature verification (US-PAY-4 AC1/AC2, docx §11).
 *
 * The security boundary of the payment flow: the webhook carries no JWT, so
 * the signature is the only thing standing between a stranger and marking an
 * arbitrary order paid.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  verifyWebhookSignature,
  verifyPaymentSignature,
  timingSafeCompare,
  signPayload,
} from '../src/signature.js';

const SECRET = 'whsec_test_secret_value_123456';
const BODY = JSON.stringify({
  event: 'payment.captured',
  payload: { payment: { entity: { id: 'pay_1', order_id: 'order_1', amount: 919800 } } },
});

test('a correctly signed webhook verifies', () => {
  assert.equal(verifyWebhookSignature(BODY, signPayload(BODY, SECRET), SECRET), true);
});

test('a signature from a different secret is rejected', () => {
  const forged = signPayload(BODY, 'whsec_attacker_secret_value');
  assert.equal(verifyWebhookSignature(BODY, forged, SECRET), false);
});

test('tampering with the amount invalidates the signature', () => {
  const good = signPayload(BODY, SECRET);
  const tampered = BODY.replace('919800', '100');
  assert.equal(verifyWebhookSignature(tampered, good, SECRET), false);
});

test('missing signature, secret or body is rejected rather than throwing', () => {
  const good = signPayload(BODY, SECRET);
  assert.equal(verifyWebhookSignature(BODY, '', SECRET), false);
  assert.equal(verifyWebhookSignature(BODY, undefined, SECRET), false);
  assert.equal(verifyWebhookSignature(BODY, good, undefined), false);
  assert.equal(verifyWebhookSignature(null, good, SECRET), false);
});

test('garbage signatures are rejected', () => {
  assert.equal(verifyWebhookSignature(BODY, 'deadbeef', SECRET), false);
});

/**
 * The reason the webhook route needs a raw-body parser registered before
 * express.json(). Re-serialising changes the bytes and breaks the HMAC — the
 * most common way this integration silently fails.
 */
test('re-formatting the body breaks verification (raw bytes matter)', () => {
  const good = signPayload(BODY, SECRET);
  const reformatted = JSON.stringify(JSON.parse(BODY), null, 2);
  assert.equal(verifyWebhookSignature(reformatted, good, SECRET), false);
});

test('byte-identical re-serialisation still verifies', () => {
  const good = signPayload(BODY, SECRET);
  assert.equal(verifyWebhookSignature(JSON.stringify(JSON.parse(BODY)), good, SECRET), true);
});

test('Buffer and string inputs behave identically', () => {
  const good = signPayload(BODY, SECRET);
  assert.equal(verifyWebhookSignature(Buffer.from(BODY, 'utf8'), good, SECRET), true);
});

test('timing-safe compare handles equal, differing and mismatched lengths', () => {
  assert.equal(timingSafeCompare('abc123', 'abc123'), true);
  assert.equal(timingSafeCompare('abc123', 'abc124'), false);
  assert.equal(timingSafeCompare('abc', 'abcdef'), false);
  assert.equal(timingSafeCompare(null, undefined), false);
});

test('checkout callback signature is order-sensitive', () => {
  const sig = signPayload('order_1|pay_1', SECRET);
  assert.equal(
    verifyPaymentSignature({ orderId: 'order_1', paymentId: 'pay_1', signature: sig }, SECRET),
    true,
  );
  // Swapping the ids must not verify.
  assert.equal(
    verifyPaymentSignature({ orderId: 'pay_1', paymentId: 'order_1', signature: sig }, SECRET),
    false,
  );
});
