/**
 * Enums shared between services and the frontend. Defined once here so the
 * Order Service and the UI cannot drift apart on status values (US-ADMIN-8).
 */

export const Role = {
  CUSTOMER: 'CUSTOMER',
  ADMIN: 'ADMIN',
};

export const OrderStatus = {
  PENDING: 'Pending',
  CONFIRMED: 'Confirmed',
  PROCESSING: 'Processing',
  SHIPPED: 'Shipped',
  DELIVERED: 'Delivered',
};

/**
 * The lifecycle the brief specifies:
 *   Pending → Confirmed → Processing → Shipped → Delivered
 *
 * Transitions are validated against this map server-side (US-ADMIN-8 AC4), so
 * skipping stages or moving backwards is rejected rather than trusted from the
 * client. Delivered is terminal.
 */
export const ORDER_STATUS_FLOW = {
  [OrderStatus.PENDING]: [OrderStatus.CONFIRMED],
  [OrderStatus.CONFIRMED]: [OrderStatus.PROCESSING],
  [OrderStatus.PROCESSING]: [OrderStatus.SHIPPED],
  [OrderStatus.SHIPPED]: [OrderStatus.DELIVERED],
  [OrderStatus.DELIVERED]: [],
};

export const ORDER_STATUS_SEQUENCE = [
  OrderStatus.PENDING,
  OrderStatus.CONFIRMED,
  OrderStatus.PROCESSING,
  OrderStatus.SHIPPED,
  OrderStatus.DELIVERED,
];

export function canTransition(from, to) {
  return (ORDER_STATUS_FLOW[from] ?? []).includes(to);
}

export function nextStatus(from) {
  return (ORDER_STATUS_FLOW[from] ?? [])[0] ?? null;
}

export const PaymentStatus = {
  PENDING: 'Pending',
  CREATED: 'Created',
  PAID: 'Paid',
  FAILED: 'Failed',
};

/** Events that produce a customer notification (docx §8). */
export const NotificationEvent = {
  ORDER_PLACED: 'ORDER_PLACED',
  PAYMENT_SUCCESSFUL: 'PAYMENT_SUCCESSFUL',
  ORDER_CONFIRMED: 'ORDER_CONFIRMED',
  ORDER_SHIPPED: 'ORDER_SHIPPED',
  ORDER_DELIVERED: 'ORDER_DELIVERED',
  /**
   * Reminder for a cart left unconverted. Unlike the others this is not
   * triggered by something that happened, but by something that did NOT happen
   * within a window — which is why it is the delayed job (docx §7).
   */
  ABANDONED_CART: 'ABANDONED_CART',
};

/** Maps an order status change to the notification it should raise. */
export const STATUS_NOTIFICATION = {
  [OrderStatus.CONFIRMED]: NotificationEvent.ORDER_CONFIRMED,
  [OrderStatus.SHIPPED]: NotificationEvent.ORDER_SHIPPED,
  [OrderStatus.DELIVERED]: NotificationEvent.ORDER_DELIVERED,
};

export const NotificationStatus = {
  PENDING: 'Pending',
  SENT: 'Sent',
  FAILED: 'Failed',
  SKIPPED: 'Skipped', // no push subscription — a success, not a retry
};

export const QUEUE_NAME = 'notifications';

/**
 * How long a cart may sit untouched before it is considered abandoned.
 *
 * Short enough to be demonstrable in a review session, long enough that a
 * customer still shopping is not nagged mid-session.
 */
export const ABANDONED_CART_DELAY_MS = 30 * 60 * 1000;

export const DEFAULT_PAGE_SIZE = 12;
export const MAX_PAGE_SIZE = 100;
