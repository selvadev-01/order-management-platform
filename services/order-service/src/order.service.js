/**
 * Order business logic: creation from cart, listing, and status transitions.
 */
import {
  notFound,
  conflict,
  forbidden,
  badRequest,
  paginated,
  clampPage,
  canTransition,
  nextStatus,
  OrderStatus,
  PaymentStatus,
  STATUS_NOTIFICATION,
  sumMinor,
} from '@oms/shared';
import { Order } from './models/order.model.js';

export class OrderService {
  constructor({ cartService, productClient, queue, logger }) {
    this.carts = cartService;
    this.products = productClient;
    this.queue = queue;
    this.logger = logger;
  }

  /**
   * Create an order from the caller's cart (US-PAY-1).
   *
   * Stock is re-validated here — the third and final check after add-to-cart
   * and checkout entry. This is the last gate before money is involved.
   *
   * The total is recomputed from live prices; any client-supplied figure is
   * ignored, which is what stops a tampered total reaching the gateway.
   */
  async createFromCart(userId, { customerInfo, deliveryAddress }, token) {
    const cart = await this.carts.view(userId, token);

    if (cart.items.length === 0) {
      throw conflict('Your cart is empty');
    }

    // Flagged lines block order creation with a message naming the product.
    if (cart.checkoutBlocked) {
      const issue = cart.issues[0];
      throw conflict(
        `"${issue.name}" is no longer available in the requested quantity`,
        cart.issues.map((i) => ({ field: 'items', message: `${i.name}: ${i.issue}` })),
      );
    }

    // Snapshot: name and unit price are frozen at this moment (US-PAY-1 AC5).
    const items = cart.items.map((line) => ({
      productId: line.productId,
      name: line.name,
      unitPrice: line.unitPrice,
      quantity: line.quantity,
      lineTotal: line.lineTotal,
    }));

    const totalAmount = sumMinor(items.map((i) => i.lineTotal));

    /**
     * Reserve stock BEFORE the order is written.
     *
     * The Product Service decrements each line conditionally, so two customers
     * racing for the last unit cannot both succeed — the check-then-write the
     * cart validation performs is not itself atomic, and this is what closes
     * that gap. A rejection surfaces as a 409 naming the product.
     */
    await this.#reserveStock(items, token);

    let order;
    try {
      order = await Order.create({
        userId,
        items,
        totalAmount,
        customerInfo,
        deliveryAddress,
        orderStatus: OrderStatus.PENDING,
        paymentStatus: PaymentStatus.PENDING,
        statusHistory: [{ status: OrderStatus.PENDING, at: new Date(), by: userId }],
      });
    } catch (err) {
      // Stock is already decremented for an order that does not exist; putting
      // it back is the only way the catalogue stays truthful.
      await this.releaseStockForItems(items, token);
      throw err;
    }

    // The cart is emptied only after the order commits, so a failed creation
    // never loses the customer's basket.
    await this.carts.clear(userId);

    this.logger?.info(
      { orderId: String(order._id), userId, totalAmount, items: items.length },
      'order created',
    );

    // Enqueued AFTER the write commits, so a job can never reference an order
    // that failed to persist. A queue failure must not fail the order
    // (US-NOTIF-1 AC4), so this never throws.
    await this.#enqueueNotification(order, 'ORDER_PLACED');

    return order.toJSON();
  }

  /** Line payload shared by the reserve and release calls. */
  static #stockLines(items) {
    return items.map((i) => ({ productId: String(i.productId), quantity: i.quantity }));
  }

  /**
   * Take stock for these lines. Throws if any line cannot be satisfied —
   * the Product Service has already rolled back the rest by then.
   */
  async #reserveStock(items, token) {
    if (!this.products) return;
    await this.products.post(
      '/api/products/stock/reserve',
      { items: OrderService.#stockLines(items) },
      { token },
    );
  }

  /**
   * Put stock back for an order that will not be fulfilled.
   *
   * Never throws: this runs on paths that are already handling a failure or
   * completing a cancellation, and a release problem must not mask the
   * original outcome. A failure here leaves stock understated, which is the
   * safe direction — it can only under-sell, never over-sell.
   */
  async releaseStockForItems(items, token) {
    if (!this.products) return;
    try {
      await this.products.post(
        '/api/products/stock/release',
        { items: OrderService.#stockLines(items) },
        { token },
      );
    } catch (err) {
      this.logger?.error({ err, lines: items.length }, 'failed to release stock');
    }
  }

  async #enqueueNotification(order, event) {
    if (!this.queue) return;
    try {
      await this.queue.add(
        event,
        { userId: String(order.userId), orderId: String(order._id), event },
        // A deterministic job id makes the enqueue idempotent: a retried or
        // duplicated trigger cannot produce a second notification for the same
        // order and event (US-NOTIF-2 AC4).
        //
        // BullMQ reserves ':' as its internal key separator and rejects it in
        // custom ids, so the parts are joined with '-'.
        { jobId: `${event}-${String(order._id)}` },
      );
      this.logger?.debug({ orderId: String(order._id), event }, 'notification queued');
    } catch (err) {
      this.logger?.error({ err, orderId: String(order._id), event }, 'failed to queue notification');
    }
  }

  /** The caller's own orders, newest first. Always scoped by userId. */
  async listForUser(userId, { page, limit }) {
    const filter = { userId };
    const total = await Order.countDocuments(filter);
    const safePage = clampPage(page, total, limit);

    const docs = await Order.find(filter)
      .sort({ createdAt: -1, _id: 1 })
      .skip((safePage - 1) * limit)
      .limit(limit)
      .lean();

    return paginated(docs.map(summarise), { page: safePage, limit, total });
  }

  /**
   * One order.
   *
   * A customer may only read their own; an admin may read any. The ownership
   * check is what makes US-PAY-5 AC4 hold.
   */
  async getById(orderId, { userId, isAdmin }) {
    const order = await Order.findById(orderId).lean();
    if (!order) throw notFound('Order not found');

    if (!isAdmin && String(order.userId) !== String(userId)) {
      throw forbidden('You do not have permission to view that order');
    }

    return detail(order);
  }

  /** All orders, admin only. Deliberately NOT scoped by userId. */
  async listAll({ page, limit, status }) {
    const filter = status ? { orderStatus: status } : {};
    const total = await Order.countDocuments(filter);
    const safePage = clampPage(page, total, limit);

    const docs = await Order.find(filter)
      .sort({ createdAt: -1, _id: 1 })
      .skip((safePage - 1) * limit)
      .limit(limit)
      .lean();

    return paginated(docs.map(adminSummary), { page: safePage, limit, total });
  }

  /**
   * Advance an order's status (US-ADMIN-8).
   *
   * Validity is decided by the shared transition map, not by trusting the
   * client to send a sensible value — skipping stages and moving backwards
   * are both rejected.
   */
  async updateStatus(orderId, targetStatus, adminId) {
    const order = await Order.findById(orderId);
    if (!order) throw notFound('Order not found');

    if (order.orderStatus === targetStatus) {
      throw conflict(`Order is already ${targetStatus}`);
    }

    if (!canTransition(order.orderStatus, targetStatus)) {
      const allowed = nextStatus(order.orderStatus);
      throw badRequest(
        allowed
          ? `Cannot move from ${order.orderStatus} to ${targetStatus}. The next status is ${allowed}.`
          : `${order.orderStatus} is the final status`,
        [{ field: 'status', message: 'Invalid transition' }],
      );
    }

    /**
     * Shipping unpaid goods is the costlier failure, so advancement past
     * Confirmed requires payment (README decisions table). Pending → Confirmed
     * stays open so an admin can acknowledge an order before payment settles.
     */
    if (
      targetStatus !== OrderStatus.CONFIRMED &&
      order.paymentStatus !== PaymentStatus.PAID
    ) {
      throw conflict(
        `Cannot move to ${targetStatus} while payment is ${order.paymentStatus}`,
        [{ field: 'paymentStatus', message: 'Payment must be completed first' }],
      );
    }

    const previous = order.orderStatus;
    order.orderStatus = targetStatus;
    order.statusHistory.push({ status: targetStatus, at: new Date(), by: adminId });
    await order.save();

    this.logger?.info(
      { orderId: String(order._id), from: previous, to: targetStatus, adminId },
      'order status changed',
    );

    const event = STATUS_NOTIFICATION[targetStatus];
    if (event) await this.#enqueueNotification(order, event);

    return detail(order.toObject());
  }

  /**
   * Mark an order paid. Called by the Payment Service after a webhook
   * verifies — never by a client (US-PAY-4 AC7).
   */
  async markPaid(orderId, { paymentId }) {
    const order = await Order.findById(orderId);
    if (!order) throw notFound('Order not found');

    // Idempotent: a redelivered webhook must not double-apply or re-notify.
    if (order.paymentStatus === PaymentStatus.PAID) {
      this.logger?.debug({ orderId }, 'order already paid — ignoring duplicate');
      return detail(order.toObject());
    }

    order.paymentStatus = PaymentStatus.PAID;
    order.paymentId = paymentId ?? order.paymentId;
    if (order.orderStatus === OrderStatus.PENDING) {
      order.orderStatus = OrderStatus.CONFIRMED;
      order.statusHistory.push({ status: OrderStatus.CONFIRMED, at: new Date() });
    }
    await order.save();

    this.logger?.info({ orderId: String(order._id) }, 'order marked paid');
    await this.#enqueueNotification(order, 'PAYMENT_SUCCESSFUL');

    return detail(order.toObject());
  }

  /**
   * Mark an order's payment failed and return its stock to the catalogue.
   *
   * The conditional filter makes this idempotent: only the first call matches
   * an order that is not already Failed, so a redelivered webhook cannot
   * release the same stock twice and inflate the catalogue.
   */
  async markPaymentFailed(orderId, token) {
    const order = await Order.findOneAndUpdate(
      { _id: orderId, paymentStatus: { $ne: PaymentStatus.FAILED } },
      { paymentStatus: PaymentStatus.FAILED, stockReleasedAt: new Date() },
      { new: true },
    );

    if (!order) {
      // Either it does not exist, or it was already failed — distinguish, so a
      // duplicate webhook is a no-op rather than a 404.
      const existing = await Order.findById(orderId);
      if (!existing) throw notFound('Order not found');
      this.logger?.debug({ orderId }, 'payment already failed — ignoring duplicate');
      return detail(existing.toObject());
    }

    // The goods were never paid for, so holding their stock only blocks other
    // customers from buying them.
    await this.releaseStockForItems(order.items, token);

    this.logger?.warn({ orderId }, 'order payment failed — stock released');
    return detail(order.toObject());
  }
}

function summarise(o) {
  return {
    id: String(o._id),
    totalAmount: o.totalAmount,
    currency: o.currency,
    orderStatus: o.orderStatus,
    paymentStatus: o.paymentStatus,
    itemCount: o.items.reduce((n, i) => n + i.quantity, 0),
    firstItem: o.items[0]?.name ?? null,
    createdAt: o.createdAt,
  };
}

function adminSummary(o) {
  return {
    ...summarise(o),
    customer: { name: o.customerInfo?.name, email: o.customerInfo?.email },
    items: o.items.map((i) => ({ name: i.name, quantity: i.quantity })),
  };
}

function detail(o) {
  return {
    id: String(o._id),
    userId: String(o.userId),
    items: o.items.map((i) => ({
      productId: String(i.productId),
      name: i.name,
      unitPrice: i.unitPrice,
      quantity: i.quantity,
      lineTotal: i.lineTotal,
    })),
    totalAmount: o.totalAmount,
    currency: o.currency,
    customerInfo: o.customerInfo,
    deliveryAddress: o.deliveryAddress,
    orderStatus: o.orderStatus,
    paymentStatus: o.paymentStatus,
    statusHistory: o.statusHistory ?? [],
    createdAt: o.createdAt,
    updatedAt: o.updatedAt,
  };
}
