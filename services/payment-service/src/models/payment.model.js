/**
 * Payment model (US-PAY-2, US-SYS-6).
 *
 * The docx relationship `Orders └── Payment`: one payment record per order.
 */
import mongoose from 'mongoose';
import { PaymentStatus } from '@oms/shared';

const paymentSchema = new mongoose.Schema(
  {
    orderId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      index: true,
    },
    userId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
    gateway: { type: String, default: 'razorpay' },

    gatewayOrderId: { type: String, index: true },

    /**
     * The gateway's payment id, set once a webhook verifies.
     *
     * The uniqueness constraint is the database-level backstop for webhook
     * idempotency: even if the application dedupe check races, a second insert
     * for the same gateway payment is impossible (US-PAY-4 AC5).
     *
     * Declared as a PARTIAL index below rather than `sparse`. A sparse index
     * still indexes explicit nulls, and unpaid payments all carry
     * `gatewayPaymentId: null` until settlement — so sparse+unique made the
     * second unpaid payment collide with the first.
     */
    gatewayPaymentId: { type: String, default: null },

    /** Gateway event ids already processed — application-level dedupe. */
    processedEventIds: { type: [String], default: [] },

    // Copied from the order at creation; the client never supplies it.
    amount: { type: Number, required: true, min: 1 },
    currency: { type: String, default: 'INR' },

    status: {
      type: String,
      enum: Object.values(PaymentStatus),
      default: PaymentStatus.CREATED,
      index: true,
    },

    /** True only after an HMAC-verified webhook. Never set from a client call. */
    signatureVerified: { type: Boolean, default: false },

    failureReason: { type: String, default: null },
    paidAt: { type: Date, default: null },
  },
  {
    timestamps: true,
    toJSON: {
      transform(_doc, ret) {
        ret.id = String(ret._id);
        delete ret._id;
        delete ret.__v;
        // Internal bookkeeping is never exposed to clients.
        delete ret.processedEventIds;
        return ret;
      },
    },
  },
);

/**
 * Unique only over documents where gatewayPaymentId is an actual string, so
 * any number of unpaid payments (all null) coexist while a settled gateway
 * payment can still only ever be recorded once.
 */
paymentSchema.index(
  { gatewayPaymentId: 1 },
  {
    unique: true,
    partialFilterExpression: { gatewayPaymentId: { $type: 'string' } },
    name: 'gatewayPaymentId_unique_when_set',
  },
);

export const Payment = mongoose.model('Payment', paymentSchema);
