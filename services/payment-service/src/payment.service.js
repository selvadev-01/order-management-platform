/**
 * Payment business logic: creation, and webhook-driven verification.
 *
 * The governing rule (docx §2, US-PAY-4 AC7): an order becomes Paid ONLY when
 * a webhook arrives and its HMAC signature verifies. The frontend's
 * payment-success callback is advisory and can never change payment state.
 */
import {
  notFound,
  conflict,
  forbidden,
  badRequest,
  PaymentStatus,
  verifyWebhookSignature,
} from '@oms/shared';
import { Payment } from './models/payment.model.js';

export class PaymentService {
  constructor({ gateway, orderClient, queue, config, logger }) {
    this.gateway = gateway;
    this.orders = orderClient;
    this.queue = queue;
    this.config = config;
    this.logger = logger;
  }

  /**
   * Create a gateway order for an existing order (US-PAY-2).
   *
   * The amount is read from the stored order, never from the request body —
   * this is the control that stops a client paying ₹1 for a ₹10,000 order.
   */
  async createPayment(orderId, { userId, token }) {
    const { order } = await this.orders.get(`/api/orders/${orderId}`, { token });

    if (String(order.userId) !== String(userId)) {
      throw forbidden('You do not have permission to pay for that order');
    }

    if (order.paymentStatus === PaymentStatus.PAID) {
      throw conflict('This order has already been paid');
    }

    if (!order.totalAmount || order.totalAmount < 1) {
      throw badRequest('Order total is invalid');
    }

    // Reuse an open attempt rather than leaving two live gateway orders that
    // could both succeed (US-PAY-2 edge case).
    const existing = await Payment.findOne({
      orderId,
      status: PaymentStatus.CREATED,
    });

    if (existing && existing.amount === order.totalAmount) {
      this.logger?.debug({ orderId, paymentId: String(existing._id) }, 'reusing open payment');
      return this.#checkoutPayload(existing, order);
    }

    const created = await this.gateway.createOrder({
      amount: order.totalAmount,
      currency: order.currency ?? 'INR',
      // The receipt is what a human reads on the gateway dashboard when
      // reconciling, so it carries the customer-facing reference. `notes` keeps
      // the internal id for programmatic correlation.
      receipt: order.orderNumber ?? `order_${orderId}`,
      notes: { orderId: String(orderId), orderNumber: order.orderNumber ?? '' },
    });

    const payment = await Payment.create({
      orderId,
      userId,
      gateway: this.gateway.name,
      gatewayOrderId: created.gatewayOrderId,
      amount: order.totalAmount,
      currency: order.currency ?? 'INR',
      status: PaymentStatus.CREATED,
    });

    this.logger?.info(
      { orderId, paymentId: String(payment._id), gatewayOrderId: created.gatewayOrderId },
      'payment created',
    );

    return this.#checkoutPayload(payment, order);
  }

  /**
   * What the browser needs to open the gateway checkout.
   *
   * Only the PUBLIC key id is included. The key secret and webhook secret
   * never leave the server (US-PAY-2 AC3).
   */
  #checkoutPayload(payment, order) {
    return {
      paymentId: String(payment._id),
      gatewayOrderId: payment.gatewayOrderId,
      amount: payment.amount,
      currency: payment.currency,
      keyId: this.config.RAZORPAY_KEY_ID,
      mock: Boolean(this.gateway.mock),
      order: {
        id: String(order.id ?? order._id),
        totalAmount: order.totalAmount,
      },
    };
  }

  /**
   * Handle a gateway webhook (US-PAY-4).
   *
   * @param {Buffer} rawBody exact bytes as received
   * @param {string} signature x-razorpay-signature header
   */
  async handleWebhook(rawBody, signature) {
    // 1. Signature first. This route has no JWT — the signature is the
    //    authentication, so nothing is parsed or trusted before it verifies.
    const valid = verifyWebhookSignature(rawBody, signature, this.config.RAZORPAY_WEBHOOK_SECRET);

    if (!valid) {
      this.logger?.error({ signaturePresent: Boolean(signature) }, 'webhook signature invalid');
      throw badRequest('Invalid webhook signature');
    }

    let payload;
    try {
      payload = JSON.parse(rawBody.toString('utf8'));
    } catch {
      throw badRequest('Malformed webhook payload');
    }

    const event = payload.event;
    const entity = payload?.payload?.payment?.entity;

    if (!entity) {
      this.logger?.warn({ event }, 'webhook has no payment entity — acknowledging');
      return { handled: false, reason: 'no_entity' };
    }

    const gatewayPaymentId = entity.id;
    const gatewayOrderId = entity.order_id;
    const amount = entity.amount;

    this.logger?.info({ event, gatewayPaymentId, gatewayOrderId }, 'webhook received and verified');

    const payment = await Payment.findOne({ gatewayOrderId });

    // Unknown but well-formed events are acknowledged with 200 so the gateway
    // stops retrying, while changing nothing (US-PAY-4 edge case).
    if (!payment) {
      this.logger?.warn({ gatewayOrderId }, 'webhook for unknown payment — acknowledging');
      return { handled: false, reason: 'unknown_payment' };
    }

    // 2. Idempotency: a redelivered event must produce the same outcome as
    //    processing it once (AC5).
    if (payment.processedEventIds.includes(gatewayPaymentId)) {
      this.logger?.info({ gatewayPaymentId }, 'duplicate webhook — already processed');
      return { handled: true, duplicate: true, paymentId: String(payment._id) };
    }

    // 3. The amount must match what was ordered. A mismatch is never marked
    //    paid, and is flagged as a possible tampering signal.
    if (amount !== payment.amount) {
      this.logger?.error(
        { expected: payment.amount, received: amount, gatewayPaymentId },
        'webhook amount mismatch — refusing to mark paid',
      );
      payment.failureReason = `Amount mismatch: expected ${payment.amount}, received ${amount}`;
      payment.processedEventIds.push(gatewayPaymentId);
      await payment.save();
      return { handled: false, reason: 'amount_mismatch' };
    }

    const success = event === 'payment.captured' || event === 'payment.authorized';

    payment.gatewayPaymentId = gatewayPaymentId;
    payment.processedEventIds.push(gatewayPaymentId);
    payment.signatureVerified = true;
    payment.status = success ? PaymentStatus.PAID : PaymentStatus.FAILED;
    if (success) payment.paidAt = new Date();
    else payment.failureReason = entity.error_description ?? 'Payment failed at gateway';
    await payment.save();

    // 4. Update the order — after the payment record commits, so the order can
    //    never be paid against a payment that failed to persist.
    try {
      await this.orders.patch(
        `/api/orders/${payment.orderId}/payment`,
        {
          paymentStatus: success ? 'Paid' : 'Failed',
          paymentId: String(payment._id),
        },
        { token: this.config.INTERNAL_TOKEN },
      );
    } catch (err) {
      // The payment record is already correct; log loudly for reconciliation
      // rather than failing the webhook, which would trigger gateway retries
      // against state that is already applied.
      this.logger?.error(
        { err, orderId: String(payment.orderId) },
        'failed to update order after verified payment — needs reconciliation',
      );
    }

    this.logger?.info(
      { paymentId: String(payment._id), orderId: String(payment.orderId), status: payment.status },
      'payment settled',
    );

    return { handled: true, status: payment.status, paymentId: String(payment._id) };
  }

  /** Payment status for an order. Ownership enforced. */
  async getForOrder(orderId, { userId, isAdmin }) {
    const payment = await Payment.findOne({ orderId }).lean();
    if (!payment) throw notFound('No payment found for that order');

    if (!isAdmin && String(payment.userId) !== String(userId)) {
      throw forbidden('You do not have permission to view that payment');
    }

    return {
      id: String(payment._id),
      orderId: String(payment.orderId),
      amount: payment.amount,
      currency: payment.currency,
      status: payment.status,
      signatureVerified: payment.signatureVerified,
      gatewayPaymentId: payment.gatewayPaymentId,
      paidAt: payment.paidAt,
      failureReason: payment.failureReason,
      createdAt: payment.createdAt,
    };
  }
}
