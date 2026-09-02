/**
 * Cart and order controllers.
 *
 * Every cart and order query is scoped by the authenticated user id taken from
 * the verified JWT — never from a client-supplied field.
 */
import { Role } from '@oms/shared';

export function buildControllers({ cartService, orderService }) {
  return {
    // --- Cart (US-CART-1..4) ---------------------------------------------
    async getCart(req, res) {
      res.json(await cartService.view(req.user.id, req.token));
    },

    async addToCart(req, res) {
      const { productId, quantity } = req.body;
      const cart = await cartService.addItem(req.user.id, productId, quantity, req.token);
      res.status(201).json(cart);
    },

    async setQuantity(req, res) {
      const cart = await cartService.setQuantity(
        req.user.id,
        req.params.productId,
        req.body.quantity,
        req.token,
      );
      res.json(cart);
    },

    async removeFromCart(req, res) {
      const cart = await cartService.removeItem(req.user.id, req.params.productId, req.token);
      res.json(cart);
    },

    // --- Orders (US-PAY-1, US-PAY-5) --------------------------------------
    async createOrder(req, res) {
      const order = await orderService.createFromCart(req.user.id, req.body, req.token);
      res.status(201).json({ order });
    },

    async listMyOrders(req, res) {
      res.json(await orderService.listForUser(req.user.id, req.query));
    },

    async getOrder(req, res) {
      const order = await orderService.getById(req.params.id, {
        userId: req.user.id,
        isAdmin: req.user.role === Role.ADMIN,
      });
      res.json({ order });
    },

    // --- Admin (US-ADMIN-6..8) --------------------------------------------
    async listAllOrders(req, res) {
      res.json(await orderService.listAll(req.query));
    },

    async updateStatus(req, res) {
      const order = await orderService.updateStatus(req.params.id, req.body.status, req.user.id);
      res.json({ order });
    },

    /**
     * Internal — called by the Payment Service after a webhook verifies.
     *
     * Guarded by requireRole(ADMIN) at the route, so a customer token cannot
     * reach it and self-declare payment (US-PAY-4 AC7).
     */
    async markPayment(req, res) {
      const { paymentStatus, paymentId } = req.body;
      // The caller's token is forwarded so the stock release can reach the
      // Product Service as an authenticated request.
      const token = req.headers.authorization?.replace(/^Bearer /i, '');
      const order =
        paymentStatus === 'Paid'
          ? await orderService.markPaid(req.params.id, { paymentId })
          : await orderService.markPaymentFailed(req.params.id, token);
      res.json({ order });
    },
  };
}
