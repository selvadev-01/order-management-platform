/**
 * Payment gateway signature verification (US-PAY-4 AC1/AC2, docx §11).
 *
 * This is the security boundary of the whole payment flow. The webhook route
 * carries no JWT — the signature IS the authentication. If this is wrong,
 * anyone who can reach the endpoint can mark any order paid.
 *
 * Two rules that are easy to get wrong and are enforced here:
 *
 *   1. The HMAC is computed over the RAW request bytes. Parsing the body to
 *      JSON and re-serialising changes key order and whitespace, producing a
 *      different digest and failing every legitimate webhook.
 *
 *   2. The comparison is timing-safe. A plain `===` returns early on the first
 *      differing byte, leaking the correct signature one character at a time.
 */
import crypto from 'node:crypto';

/**
 * Constant-time comparison of two hex digests.
 *
 * `timingSafeEqual` throws on length mismatch, which would itself be a timing
 * signal, so lengths are checked first and a mismatch simply returns false.
 */
export function timingSafeCompare(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Verify a Razorpay webhook signature.
 *
 * @param {Buffer|string} rawBody exact bytes as received — never a re-serialised object
 * @param {string} signature     value of the x-razorpay-signature header
 * @param {string} secret        RAZORPAY_WEBHOOK_SECRET
 */
export function verifyWebhookSignature(rawBody, signature, secret) {
  if (!rawBody || !signature || !secret) return false;

  const payload = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(String(rawBody), 'utf8');

  const expected = crypto.createHmac('sha256', secret).update(payload).digest('hex');

  return timingSafeCompare(expected, signature);
}

/**
 * Verify the signature returned by Razorpay Checkout on the client.
 *
 * Signed over `order_id|payment_id`. This is a useful sanity check, but it is
 * NOT what marks an order paid — only the webhook does that (US-PAY-4 AC7).
 * A client can always lie about having called it.
 */
export function verifyPaymentSignature({ orderId, paymentId, signature }, secret) {
  if (!orderId || !paymentId || !signature || !secret) return false;

  const expected = crypto
    .createHmac('sha256', secret)
    .update(`${orderId}|${paymentId}`)
    .digest('hex');

  return timingSafeCompare(expected, signature);
}

/** Test helper: produce a valid signature for a payload. */
export function signPayload(rawBody, secret) {
  const payload = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(String(rawBody), 'utf8');
  return crypto.createHmac('sha256', secret).update(payload).digest('hex');
}
