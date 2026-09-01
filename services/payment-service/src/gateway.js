/**
 * Payment gateway adapter.
 *
 * The gateway is behind this interface so Razorpay can be swapped for Stripe
 * or PayPal without touching the controllers — the docx offers all three and
 * the user stories are written gateway-agnostic.
 *
 * A mock implementation is provided for when no sandbox credentials are
 * configured, so the full order → payment → webhook flow can be exercised
 * end to end. The mock signs webhooks with the same HMAC as the real gateway,
 * so verification is genuinely tested rather than bypassed.
 */
import crypto from 'node:crypto';
import { badGateway } from '@oms/shared';

/** Real Razorpay, via its REST API. */
class RazorpayGateway {
  constructor({ keyId, keySecret, logger }) {
    this.keyId = keyId;
    this.keySecret = keySecret;
    this.logger = logger;
    this.name = 'razorpay';
    this.mock = false;
  }

  async createOrder({ amount, currency, receipt, notes }) {
    const auth = Buffer.from(`${this.keyId}:${this.keySecret}`).toString('base64');

    const res = await fetch('https://api.razorpay.com/v1/orders', {
      method: 'POST',
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/json',
      },
      // Razorpay expects the amount in minor units — which is how it is
      // already stored, so no conversion is needed or wanted here.
      body: JSON.stringify({ amount, currency, receipt, notes, payment_capture: 1 }),
    }).catch((err) => {
      this.logger?.error({ err }, 'razorpay unreachable');
      throw badGateway('Payment gateway is unavailable');
    });

    const payload = await res.json().catch(() => null);

    if (!res.ok) {
      this.logger?.error({ status: res.status, payload }, 'razorpay order creation failed');
      throw badGateway(payload?.error?.description ?? 'Payment gateway rejected the request');
    }

    return { gatewayOrderId: payload.id, amount: payload.amount, currency: payload.currency };
  }
}

/**
 * Mock gateway for local development.
 *
 * Creates deterministic ids and exposes a helper to build a correctly-signed
 * webhook, so the verification path is exercised for real.
 */
class MockGateway {
  constructor({ webhookSecret, logger }) {
    this.webhookSecret = webhookSecret;
    this.logger = logger;
    this.name = 'razorpay';
    this.mock = true;
  }

  async createOrder({ amount, currency, receipt }) {
    const gatewayOrderId = `order_mock_${crypto.randomBytes(8).toString('hex')}`;
    this.logger?.warn(
      { gatewayOrderId, receipt },
      'MOCK gateway in use — configure RAZORPAY_KEY_ID/SECRET for the real sandbox',
    );
    return { gatewayOrderId, amount, currency };
  }

  /** Build a signed webhook exactly as the real gateway would send it. */
  buildWebhook({ gatewayOrderId, gatewayPaymentId, amount, event = 'payment.captured' }) {
    const body = JSON.stringify({
      event,
      payload: {
        payment: {
          entity: {
            id: gatewayPaymentId ?? `pay_mock_${crypto.randomBytes(8).toString('hex')}`,
            order_id: gatewayOrderId,
            amount,
            currency: 'INR',
            status: event === 'payment.captured' ? 'captured' : 'failed',
          },
        },
      },
    });

    const signature = crypto
      .createHmac('sha256', this.webhookSecret)
      .update(body)
      .digest('hex');

    return { body, signature };
  }
}

/**
 * Select the gateway.
 *
 * Real credentials are used when present; otherwise the mock keeps the service
 * runnable. Production refuses to start on placeholders rather than silently
 * mocking payments.
 */
export function createGateway(config, logger) {
  const configured =
    config.RAZORPAY_KEY_ID &&
    config.RAZORPAY_KEY_SECRET &&
    !config.RAZORPAY_KEY_ID.includes('replace_me') &&
    !config.RAZORPAY_KEY_SECRET.includes('replace_');

  if (configured) {
    logger.info('razorpay gateway configured (test mode)');
    return new RazorpayGateway({
      keyId: config.RAZORPAY_KEY_ID,
      keySecret: config.RAZORPAY_KEY_SECRET,
      logger,
    });
  }

  if (config.NODE_ENV === 'production') {
    logger.fatal('gateway credentials missing — refusing to start in production');
    process.exit(1);
  }

  return new MockGateway({ webhookSecret: config.RAZORPAY_WEBHOOK_SECRET, logger });
}
