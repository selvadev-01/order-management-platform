/**
 * Notification delivery.
 *
 * Used by both the HTTP service (for the in-app list and subscriptions) and
 * the BullMQ worker (for delivery), so one code path produces every
 * notification record.
 */
import webpush from 'web-push';
import {
  notFound,
  NotificationStatus,
  NonRetryableError,
  paginated,
  clampPage,
} from '@oms/shared';
import { Notification } from './models/notification.model.js';
import { PushSubscription } from './models/subscription.model.js';
import { PushPreference } from './models/preference.model.js';
import { renderNotification } from './templates.js';

export class NotificationService {
  constructor({ orderClient, config, logger }) {
    this.orders = orderClient;
    this.config = config;
    this.logger = logger;

    this.pushEnabled = Boolean(
      config.VAPID_PUBLIC_KEY &&
        config.VAPID_PRIVATE_KEY &&
        !config.VAPID_PUBLIC_KEY.includes('replace_'),
    );

    if (this.pushEnabled) {
      webpush.setVapidDetails(
        config.VAPID_SUBJECT,
        config.VAPID_PUBLIC_KEY,
        config.VAPID_PRIVATE_KEY,
      );
      logger.info('web push configured');
    } else {
      logger.warn('VAPID keys not configured — notifications recorded in-app only');
    }
  }

  /**
   * Process one queued job (US-NOTIF-1 AC3, US-NOTIF-2 AC2).
   *
   * Idempotent by construction: the unique index on (userId, event, orderId)
   * means a retry after a partial failure cannot create a second record, so
   * the customer is never notified twice (US-NOTIF-3 AC5).
   */
  async deliver({ userId, orderId, event }, { token }) {
    // A record that already succeeded means this job is a repeat.
    const existing = await Notification.findOne({ userId, orderId, event });
    if (existing && existing.status === NotificationStatus.SENT) {
      this.logger?.debug({ userId, orderId, event }, 'notification already sent — skipping');
      return { skipped: true, reason: 'already_sent', notificationId: String(existing._id) };
    }

    // Fetch the order for its content. A deleted order is not retryable —
    // failing fast avoids burning attempts on something that will never
    // succeed (US-NOTIF-1 edge case).
    let order = null;
    try {
      const res = await this.orders.get(`/api/orders/${orderId}`, { token });
      order = res.order;
    } catch (err) {
      if (err.status === 404) {
        throw new NonRetryableError(`Order ${orderId} no longer exists`);
      }
      throw err; // 5xx / network — retryable
    }

    const content = renderNotification(event, order);
    if (!content) {
      throw new NonRetryableError(`Unknown notification event: ${event}`);
    }

    const record =
      existing ??
      (await Notification.create({
        userId,
        orderId,
        event,
        title: content.title,
        body: content.body,
        status: NotificationStatus.PENDING,
      }));

    const subs = await PushSubscription.find({ userId, expiredAt: null });

    // No subscription is a SUCCESS, not a failure to retry: the customer
    // declined push or has not enabled it, and the in-app record still
    // exists (US-NOTIF-1 edge case, US-NOTIF-5 AC3).
    if (!this.pushEnabled || subs.length === 0) {
      record.status = NotificationStatus.SKIPPED;
      record.sentAt = new Date();
      record.channel = 'in-app';
      await record.save();
      this.logger?.info(
        { userId, event, reason: this.pushEnabled ? 'no_subscription' : 'push_disabled' },
        'notification recorded in-app only',
      );
      return { delivered: 0, status: NotificationStatus.SKIPPED, notificationId: String(record._id) };
    }

    const payload = JSON.stringify({
      title: content.title,
      body: content.body,
      url: content.url,
      event,
    });

    let delivered = 0;
    const expired = [];

    for (const sub of subs) {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth } },
          payload,
        );
        delivered += 1;
      } catch (err) {
        // 404/410 mean the subscription is permanently gone. Marking it
        // expired stops the failed set filling with undeliverable retries
        // (US-NOTIF-5 edge case).
        if (err.statusCode === 404 || err.statusCode === 410) {
          expired.push(sub._id);
          this.logger?.debug({ userId, endpoint: sub.endpoint }, 'push subscription expired');
        } else {
          this.logger?.warn({ err: err.message, userId }, 'push delivery failed');
        }
      }
    }

    if (expired.length) {
      await PushSubscription.updateMany({ _id: { $in: expired } }, { expiredAt: new Date() });
    }

    record.deliveredTo = delivered;
    record.status = delivered > 0 ? NotificationStatus.SENT : NotificationStatus.SKIPPED;
    record.sentAt = new Date();
    await record.save();

    this.logger?.info({ userId, event, delivered, expired: expired.length }, 'notification delivered');
    return { delivered, status: record.status, notificationId: String(record._id) };
  }

  /** The caller's notifications, newest first (US-NOTIF-6). */
  async listForUser(userId, { page, limit }) {
    const filter = { userId };
    const total = await Notification.countDocuments(filter);
    const safePage = clampPage(page, total, limit);

    const docs = await Notification.find(filter)
      .sort({ createdAt: -1, _id: 1 })
      .skip((safePage - 1) * limit)
      .limit(limit)
      .lean();

    return paginated(
      docs.map((n) => ({
        id: String(n._id),
        event: n.event,
        title: n.title,
        body: n.body,
        orderId: n.orderId ? String(n.orderId) : null,
        status: n.status,
        read: Boolean(n.readAt),
        createdAt: n.createdAt,
      })),
      { page: safePage, limit, total },
    );
  }

  async markRead(userId, notificationId) {
    const n = await Notification.findOneAndUpdate(
      { _id: notificationId, userId },
      { readAt: new Date() },
      { new: true },
    );
    if (!n) throw notFound('Notification not found');
    return { id: String(n._id), read: true };
  }

  /** Register a device for push (US-NOTIF-5 AC2). */
  async subscribe(userId, { endpoint, keys, userAgent }) {
    const sub = await PushSubscription.findOneAndUpdate(
      { endpoint },
      { userId, endpoint, keys, userAgent, expiredAt: null },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );

    // Subscribing is the user changing their mind, so a previous decline no
    // longer suppresses the prompt on their other devices.
    await PushPreference.findOneAndUpdate(
      { userId },
      { promptDeclined: false, declinedAt: null },
      { upsert: true, setDefaultsOnInsert: true },
    );

    this.logger?.info({ userId }, 'push subscription registered');
    return { id: String(sub._id), endpoint: sub.endpoint };
  }

  /**
   * Whether the app should prompt this user for push permission.
   *
   * The browser owns the permission itself; this answers only "have they
   * already told us no", so a declined prompt is not repeated on every login
   * or on their next device.
   */
  async shouldPrompt(userId) {
    const pref = await PushPreference.findOne({ userId }).lean();
    return { shouldPrompt: !pref?.promptDeclined };
  }

  /** Record that the user dismissed or declined the permission prompt. */
  async declinePrompt(userId) {
    await PushPreference.findOneAndUpdate(
      { userId },
      { promptDeclined: true, declinedAt: new Date() },
      { upsert: true, setDefaultsOnInsert: true },
    );
    this.logger?.info({ userId }, 'push prompt declined — will not re-ask');
    return { shouldPrompt: false };
  }

  async unsubscribe(userId, endpoint) {
    await PushSubscription.deleteOne({ userId, endpoint });
    return { unsubscribed: true };
  }
}
