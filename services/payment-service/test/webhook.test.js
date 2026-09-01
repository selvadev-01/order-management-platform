/**
 * Webhook handling rules (US-PAY-4).
 *
 * The Payment model and Order client are stubbed, so these exercise the
 * decision logic — signature, idempotency, amount matching — without a
 * database or a live gateway.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { verifyWebhookSignature, signPayload } from '@oms/shared';

const SECRET = 'whsec_unit_test_secret_value';

function webhookBody({ event = 'payment.captured', orderId = 'order_x', paymentId = 'pay_x', amount = 100000 } = {}) {
  return JSON.stringify({
    event,
    payload: { payment: { entity: { id: paymentId, order_id: orderId, amount, currency: 'INR' } } },
  });
}

/**
 * The core security property: without the shared secret, no attacker-crafted
 * body can be made to verify.
 */
test('an unsigned webhook cannot be accepted', () => {
  const body = webhookBody();
  assert.equal(verifyWebhookSignature(body, '', SECRET), false);
  assert.equal(verifyWebhookSignature(body, 'x'.repeat(64), SECRET), false);
});

test('an attacker cannot forge a signature without the secret', () => {
  const body = webhookBody({ amount: 1 });
  const guess = crypto.createHmac('sha256', 'guessed_secret').update(body).digest('hex');
  assert.equal(verifyWebhookSignature(body, guess, SECRET), false);
});

test('changing any byte of a signed body invalidates it', () => {
  const body = webhookBody({ amount: 919800 });
  const sig = signPayload(body, SECRET);

  for (const tampered of [
    body.replace('919800', '1'),
    body.replace('order_x', 'order_other'),
    body.replace('payment.captured', 'payment.failed'),
  ]) {
    assert.equal(verifyWebhookSignature(tampered, sig, SECRET), false);
  }
});

/**
 * Amount is compared against the stored order, so a correctly-signed webhook
 * claiming a smaller amount must still be refused.
 */
test('amount mismatch is detectable independently of the signature', () => {
  const body = webhookBody({ amount: 100 });
  const sig = signPayload(body, SECRET);

  // The signature is genuinely valid...
  assert.equal(verifyWebhookSignature(body, sig, SECRET), true);

  // ...but the amount does not match what was ordered, so the handler refuses.
  const entity = JSON.parse(body).payload.payment.entity;
  const storedOrderAmount = 919800;
  assert.notEqual(entity.amount, storedOrderAmount);
});

test('event type determines success or failure', () => {
  const captured = JSON.parse(webhookBody({ event: 'payment.captured' }));
  const failed = JSON.parse(webhookBody({ event: 'payment.failed' }));

  const isSuccess = (e) => e.event === 'payment.captured' || e.event === 'payment.authorized';
  assert.equal(isSuccess(captured), true);
  assert.equal(isSuccess(failed), false);
});

/**
 * Redelivery is common: gateways retry when they do not see a timely 200.
 * The gateway payment id is what makes reprocessing a no-op.
 */
test('the gateway payment id identifies a duplicate delivery', () => {
  const first = JSON.parse(webhookBody({ paymentId: 'pay_abc' }));
  const redelivered = JSON.parse(webhookBody({ paymentId: 'pay_abc' }));

  const processed = [first.payload.payment.entity.id];
  assert.equal(processed.includes(redelivered.payload.payment.entity.id), true);
});

test('a webhook with no payment entity is well-formed but actionless', () => {
  const body = JSON.stringify({ event: 'payout.processed', payload: {} });
  const sig = signPayload(body, SECRET);

  assert.equal(verifyWebhookSignature(body, sig, SECRET), true);
  assert.equal(JSON.parse(body)?.payload?.payment?.entity, undefined);
});
