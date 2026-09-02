/**
 * Notification model (US-NOTIF-1 AC5, US-NOTIF-6, US-SYS-6).
 *
 * One record per delivered (or attempted) notification. The in-app list reads
 * these same records, so push and in-app can never disagree about what
 * happened.
 */
import mongoose from 'mongoose';
import { NotificationEvent, NotificationStatus } from '@oms/shared';

const notificationSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
    orderId: { type: mongoose.Schema.Types.ObjectId, default: null },
    /**
     * Idempotency key for notifications that have no order to key on.
     * Null for order-based events, which use orderId instead.
     */
    dedupeKey: { type: String, default: null },
    event: {
      type: String,
      enum: Object.values(NotificationEvent),
      required: true,
    },
    title: { type: String, required: true },
    body: { type: String, required: true },
    channel: { type: String, enum: ['push', 'in-app'], default: 'push' },
    status: {
      type: String,
      enum: Object.values(NotificationStatus),
      default: NotificationStatus.PENDING,
      index: true,
    },
    /** How many push subscriptions actually received it. */
    deliveredTo: { type: Number, default: 0 },
    sentAt: { type: Date, default: null },
    error: { type: String, default: null },
    readAt: { type: Date, default: null },
  },
  {
    timestamps: true,
    toJSON: {
      transform(_doc, ret) {
        ret.id = String(ret._id);
        delete ret._id;
        delete ret.__v;
        return ret;
      },
    },
  },
);

// Serves the notification list and its sort in one index (US-NOTIF-6).
notificationSchema.index({ userId: 1, createdAt: -1 });

/**
 * One notification per user per event per order.
 *
 * This is the database-level guarantee behind handler idempotency: even if a
 * job is retried after a partial failure, a second record cannot be created,
 * so the customer cannot be notified twice (US-NOTIF-3 AC5).
 */
notificationSchema.index(
  { userId: 1, event: 1, orderId: 1 },
  { unique: true, partialFilterExpression: { orderId: { $type: 'objectId' } } },
);

/**
 * Cart events have no order to key on, so they are deduplicated per user per
 * day instead: a customer who abandons a cart repeatedly is reminded once a
 * day, not once per abandonment (US-NOTIF-2 AC4).
 */
notificationSchema.index(
  { userId: 1, event: 1, dedupeKey: 1 },
  { unique: true, partialFilterExpression: { dedupeKey: { $type: 'string' } } },
);

export const Notification = mongoose.model('Notification', notificationSchema);
