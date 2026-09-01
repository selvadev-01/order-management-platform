/**
 * Notification content for the five events the docx names (§8).
 *
 * Kept as data rather than scattered strings so the worker and any future
 * channel (email, SMS) render the same wording.
 */
import { NotificationEvent, formatMoney } from '@oms/shared';

const TEMPLATES = {
  [NotificationEvent.ORDER_PLACED]: (o) => ({
    title: 'Order placed successfully',
    body: `Your order for ${formatMoney(o.totalAmount)} has been received and is awaiting payment.`,
  }),
  [NotificationEvent.PAYMENT_SUCCESSFUL]: (o) => ({
    title: 'Payment successful',
    body: `We have received your payment of ${formatMoney(o.totalAmount)}. Your order is confirmed.`,
  }),
  [NotificationEvent.ORDER_CONFIRMED]: () => ({
    title: 'Order confirmed',
    body: 'Your order has been confirmed and is being prepared.',
  }),
  [NotificationEvent.ORDER_SHIPPED]: () => ({
    title: 'Order shipped',
    body: 'Your order is on its way.',
  }),
  [NotificationEvent.ORDER_DELIVERED]: () => ({
    title: 'Order delivered',
    body: 'Your order has been delivered. Thank you for shopping with us.',
  }),
};

export function renderNotification(event, order) {
  const template = TEMPLATES[event];
  if (!template) return null;

  const { title, body } = template(order ?? {});
  return {
    title,
    body,
    // Clicking the notification opens the relevant order (US-NOTIF-5 AC4).
    url: order?.id ? `/orders/${order.id}` : '/orders',
  };
}

export const SUPPORTED_EVENTS = Object.keys(TEMPLATES);
