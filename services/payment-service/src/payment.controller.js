/**
 * Payment controllers.
 */
import { Role, badRequest, notFound } from '@oms/shared';
import { Payment } from './models/payment.model.js';

export function buildControllers({ service, gateway, config }) {
  return {
    /** POST /api/payments/create */
    async createPayment(req, res) {
      const payload = await service.createPayment(req.body.orderId, {
        userId: req.user.id,
        token: req.token,
      });
      res.status(201).json(payload);
    },

    /**
     * POST /api/payments/webhook
     *
     * Always acknowledges with 200 once the signature verifies, even for
     * events that change nothing — otherwise the gateway retries indefinitely
     * against an event we will never act on. Only a BAD SIGNATURE returns 400.
     */
    async webhook(req, res) {
      const signature = req.headers['x-razorpay-signature'];

      // req.body is a Buffer here because express.raw() ran for this path.
      const result = await service.handleWebhook(req.body, signature);

      res.status(200).json({ received: true, ...result });
    },

    /** GET /api/payments/:orderId */
    async getPayment(req, res) {
      const payment = await service.getForOrder(req.params.orderId, {
        userId: req.user.id,
        isAdmin: req.user.role === Role.ADMIN,
      });
      res.json({ payment });
    },

    /**
     * POST /api/payments/mock/settle — development only.
     *
     * Builds a webhook signed with the real webhook secret and feeds it through
     * the real handler, so signature verification, idempotency, and the order
     * update are all genuinely exercised — nothing is bypassed.
     */
    async mockSettle(req, res) {
      if (!gateway.mock) {
        throw badRequest('Mock settlement is unavailable when a real gateway is configured');
      }

      const payment = await Payment.findOne({ orderId: req.body.orderId }).sort({ createdAt: -1 });
      if (!payment) throw notFound('No payment found for that order — create one first');

      const { body, signature } = gateway.buildWebhook({
        gatewayOrderId: payment.gatewayOrderId,
        amount: payment.amount,
        event: req.body.outcome === 'failed' ? 'payment.failed' : 'payment.captured',
      });

      const result = await service.handleWebhook(Buffer.from(body, 'utf8'), signature);

      req.log?.info({ orderId: req.body.orderId, result }, 'mock webhook delivered');
      res.json({ delivered: true, ...result });
    },
  };
}
