/**
 * Notification controllers.
 */
export function buildControllers({ service }) {
  return {
    pushEnabled: () => service.pushEnabled,

    async list(req, res) {
      res.json(await service.listForUser(req.user.id, req.query));
    },

    async markRead(req, res) {
      res.json(await service.markRead(req.user.id, req.params.id));
    },

    async subscribe(req, res) {
      const sub = await service.subscribe(req.user.id, req.body);
      res.status(201).json(sub);
    },

    async unsubscribe(req, res) {
      res.json(await service.unsubscribe(req.user.id, req.body.endpoint));
    },

    async shouldPrompt(req, res) {
      res.json(await service.shouldPrompt(req.user.id));
    },

    async declinePrompt(req, res) {
      res.json(await service.declinePrompt(req.user.id));
    },
  };
}
