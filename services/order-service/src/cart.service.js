/**
 * Cart business logic.
 *
 * Prices and stock are resolved from the Product Service at read time, never
 * stored on the cart. Totals are computed server-side and returned with the
 * cart, so the client displays them rather than calculating money itself —
 * the two can then never disagree (US-CART-1).
 */
import { notFound, conflict, sumMinor } from '@oms/shared';
import { Cart } from './models/cart.model.js';

export class CartService {
  constructor({ productClient, logger }) {
    this.products = productClient;
    this.logger = logger;
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
    return this.view(userId, token);
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
    return this.view(userId, token);
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
    return this.view(userId, token);
  }

  async clear(userId) {
    await Cart.findOneAndUpdate({ userId }, { items: [] });
  }
}
