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
  /**
   * Cart-based rather than order-based: at this point no order exists, so the
   * subject is the cart's own contents.
   */
  [NotificationEvent.ABANDONED_CART]: (c) => ({
    title: 'You left something behind',
    body:
      c.itemCount === 1
        ? 'You still have an item waiting in your cart.'
        : `You still have ${c.itemCount} items waiting in your cart.`,
  }),
};

/** Events whose subject is the cart, not an order. */
const CART_EVENTS = new Set([NotificationEvent.ABANDONED_CART]);

export function isCartEvent(event) {
  return CART_EVENTS.has(event);
}

/**
 * @param {string} event
 * @param {object} subject the order, or the cart for cart events
 */
export function renderNotification(event, subject) {
  const template = TEMPLATES[event];
  if (!template) return null;

  const { title, body } = template(subject ?? {});
  return {
    title,
    body,
    // Clicking the notification opens the relevant page (US-NOTIF-5 AC4):
    // the cart for a cart event, otherwise the order.
    url: isCartEvent(event) ? '/cart' : subject?.id ? `/orders/${subject.id}` : '/orders',
  };
}

export const SUPPORTED_EVENTS = Object.keys(TEMPLATES);
