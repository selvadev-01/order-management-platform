/**
 * Web Push subscription (US-NOTIF-5).
 *
 * Stored separately from `users` rather than as an array on the user document:
 * one person may have several devices, and an unbounded array on a hot
 * document is the wrong shape. Not in the docx's suggested collection list —
 * it is an implementation detail of the push requirement (docx §8), not added
 * scope.
 */
import mongoose from 'mongoose';

const subscriptionSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
    // The push service's unique URL for this device.
    endpoint: { type: String, required: true, unique: true },
    keys: {
      p256dh: { type: String, required: true },
      auth: { type: String, required: true },
    },
    userAgent: { type: String, default: null },
    /** Set when the push service reports the subscription is gone (404/410). */
    expiredAt: { type: Date, default: null },
  },
  { timestamps: true },
);

export const PushSubscription = mongoose.model('PushSubscription', subscriptionSchema);
