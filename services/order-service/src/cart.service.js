/**
 * Cart business logic.
 *
 * Prices and stock are resolved from the Product Service at read time, never
 * stored on the cart. Totals are computed server-side and returned with the
 * cart, so the client displays them rather than calculating money itself —
 * the two can then never disagree (US-CART-1).
 */
import {
  notFound,
  conflict,
  sumMinor,
  NotificationEvent,
  ABANDONED_CART_DELAY_MS,
} from '@oms/shared';
import { Cart } from './models/cart.model.js';

export class CartService {
  constructor({ productClient, queue, logger }) {
    this.products = productClient;
    this.queue = queue;
    this.logger = logger;
  }

  /**
   * Abandoned-cart reminder — the delayed background job (docx §7).
   *
   * Scheduled on every cart mutation with a fixed job id, so each change
   * replaces the pending reminder rather than queueing another: the timer
   * measures inactivity, not the number of edits. Removing the job when the
   * cart empties or converts is what stops a reminder for a cart that no
   * longer needs one.
   */
  async scheduleAbandonedCartReminder(userId, itemCount) {
    if (!this.queue) return;

    const jobId = `${NotificationEvent.ABANDONED_CART}-${userId}`;
    try {
      // A delayed job is only replaceable once the old one is gone — BullMQ
      // ignores an add() whose id already exists.
      const pending = await this.queue.getJob(jobId);
      if (pending) await pending.remove();

      // An empty cart has nothing to be reminded about.
      if (itemCount === 0) {
        this.logger?.debug({ userId }, 'abandoned-cart reminder cancelled — cart empty');
        return;
      }

      await this.queue.add(
        NotificationEvent.ABANDONED_CART,
        {
          userId: String(userId),
          event: NotificationEvent.ABANDONED_CART,
          // Snapshotted because by delivery time the cart may have changed;
          // the reminder describes what was left behind when it was scheduled.
          cart: { itemCount },
        },
        { jobId, delay: ABANDONED_CART_DELAY_MS },
      );

      this.logger?.debug(
        { userId, itemCount, delayMs: ABANDONED_CART_DELAY_MS },
        'abandoned-cart reminder scheduled',
      );
    } catch (err) {
      // A queue failure must never fail the cart operation itself.
      this.logger?.error({ err, userId }, 'failed to schedule abandoned-cart reminder');
    }
  }

  /** Cancel a pending reminder — the cart converted to an order. */
  async cancelAbandonedCartReminder(userId) {
    await this.scheduleAbandonedCartReminder(userId, 0);
  }

  async #getOrCreate(userId) {
    const cart = await Cart.findOne({ userId });
    if (cart) return cart;
    return Cart.create({ userId, items: [] });
  }

  /** Fetch one product's live price and stock from the Product Service. */
  async #fetchProduct(productId, token) {
    return this.products.get(`/api/products/${productId}/stock`, { token });
  }

  /**
   * Resolve a cart into its display form.
   *
   * Each line is checked against live catalogue data and flagged when it can
   * no longer be purchased — deleted product, or quantity above current stock.
   * A flagged line is excluded from the total and blocks checkout until the
   * customer resolves it (US-CART-1 edge cases).
   */
  async view(userId, token) {
    const cart = await this.#getOrCreate(userId);

    const lines = await Promise.all(
      cart.items.map(async (item) => {
        const productId = String(item.productId);
        try {
          const product = await this.#fetchProduct(productId, token);
          const overStock = item.quantity > product.stock;
          return {
            productId,
            name: product.name,
            image: product.image ?? null,
            unitPrice: product.price,
            quantity: item.quantity,
            lineTotal: product.price * item.quantity,
            availableStock: product.stock,
            available: !overStock && product.stock > 0,
            issue: overStock
              ? product.stock === 0
                ? 'OUT_OF_STOCK'
                : 'INSUFFICIENT_STOCK'
              : null,
          };
        } catch (err) {
          // A 404 means the product was deleted: the line survives but is
          // flagged, rather than vanishing silently from the customer's cart.
          if (err.status === 404) {
            return {
              productId,
              name: 'Unavailable product',
              // No image for a product that no longer exists — the UI falls
              // back to its placeholder rather than showing a broken one.
              image: null,
              unitPrice: 0,
              quantity: item.quantity,
              lineTotal: 0,
              availableStock: 0,
              available: false,
              issue: 'UNAVAILABLE',
            };
          }
          throw err;
        }
      }),
    );

    // Only purchasable lines contribute to the total.
    const total = sumMinor(lines.filter((l) => l.available).map((l) => l.lineTotal));

    return {
      items: lines,
      itemCount: lines.reduce((n, l) => n + l.quantity, 0),
      subtotal: total,
      total,
      currency: 'INR',
      // Drives the checkout button state (US-CART-4 AC3).
      checkoutBlocked: lines.length === 0 || lines.some((l) => !l.available),
      issues: lines.filter((l) => !l.available).map((l) => ({ productId: l.productId, name: l.name, issue: l.issue })),
    };
  }

  /**
   * Add to cart, merging with any existing line.
   *
   * Stock is re-checked against the live catalogue here; the client's own
   * clamping is never trusted (US-PDP-3 AC1, US-PDP-4 AC3).
   */
  async addItem(userId, productId, quantity, token) {
    const product = await this.#fetchProduct(productId, token);

    if (product.stock === 0) {
      throw conflict('This product is out of stock', [
        { field: 'productId', message: 'Out of stock' },
      ]);
    }

    const cart = await this.#getOrCreate(userId);
    const existing = cart.items.find((i) => String(i.productId) === String(productId));
    const combined = (existing?.quantity ?? 0) + quantity;

    // The combined quantity is what matters, not just this request's amount —
    // otherwise repeated small adds could exceed stock (US-PDP-3 edge case).
    if (combined > product.stock) {
      throw conflict(
        `Only ${product.stock} in stock${existing ? `, and your cart already has ${existing.quantity}` : ''}`,
        [{ field: 'quantity', message: `Maximum available: ${product.stock}` }],
      );
    }

    cart.addItem(productId, quantity);
    await cart.save();

    this.logger?.info({ userId, productId, quantity: combined }, 'cart item added');
    return this.#viewAndScheduleReminder(userId, token);
  }

  /**
   * Resolve the cart and (re)schedule its abandonment reminder.
   *
   * Every mutation funnels through here so no path can change the cart without
   * the pending reminder being brought back in step with it.
   */
  async #viewAndScheduleReminder(userId, token) {
    const view = await this.view(userId, token);
    await this.scheduleAbandonedCartReminder(userId, view.itemCount);
    return view;
  }

  /** Set an existing line's quantity, re-validating against live stock. */
  async setQuantity(userId, productId, quantity, token) {
    const cart = await Cart.findOne({ userId });
    if (!cart) throw notFound('Cart not found');

    const line = cart.items.find((i) => String(i.productId) === String(productId));
    if (!line) throw notFound('That product is not in your cart');

    const product = await this.#fetchProduct(productId, token);
    if (quantity > product.stock) {
      throw conflict(`Only ${product.stock} in stock`, [
        { field: 'quantity', message: `Maximum available: ${product.stock}` },
      ]);
    }

    cart.setQuantity(productId, quantity);
    await cart.save();

    this.logger?.info({ userId, productId, quantity }, 'cart quantity updated');
    return this.#viewAndScheduleReminder(userId, token);
  }

  /**
   * Remove a line. Idempotent — removing an absent line succeeds, since the
   * desired end state already holds (US-CART-2 edge case).
   */
  async removeItem(userId, productId, token) {
    const cart = await Cart.findOne({ userId });
    if (cart) {
      const removed = cart.removeItem(productId);
      if (removed) {
        await cart.save();
        this.logger?.info({ userId, productId }, 'cart item removed');
      }
    }
    return this.#viewAndScheduleReminder(userId, token);
  }

  async clear(userId) {
    await Cart.findOneAndUpdate({ userId }, { items: [] });
    // The cart is now empty — nothing to be reminded about.
    await this.cancelAbandonedCartReminder(userId);
  }
}
