/**
 * Notification routes.
 *
 * Every list query is scoped to the authenticated user, so one customer can
 * never read another's notifications (US-NOTIF-6 AC4).
 */
import { Router } from 'express';
import { z } from 'zod';
import {
  asyncHandler,
  validate,
  authenticate,
  requireRole,
  Role,
  paginationQuery,
  queueCounts,
} from '@oms/shared';

const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, 'Malformed identifier');

const subscribeSchema = {
  body: z.object({
    endpoint: z.string().url('Endpoint must be a valid URL'),
    keys: z.object({
      p256dh: z.string().min(1),
      auth: z.string().min(1),
    }),
    userAgent: z.string().max(300).optional(),
  }),
};

export function buildRoutes({ controllers, config, queue }) {
  const router = Router();
  const requireAuth = authenticate(config.JWT_SECRET);

  router.get(
    '/notifications',
    requireAuth,
    validate({ query: paginationQuery }),
    asyncHandler(controllers.list),
  );

  router.patch(
    '/notifications/:id/read',
    requireAuth,
    validate({ params: z.object({ id: objectId }) }),
    asyncHandler(controllers.markRead),
  );

  router.post(
    '/notifications/subscribe',
    requireAuth,
    validate(subscribeSchema),
    asyncHandler(controllers.subscribe),
  );

  router.post(
    '/notifications/unsubscribe',
    requireAuth,
    validate({ body: z.object({ endpoint: z.string().url() }) }),
    asyncHandler(controllers.unsubscribe),
  );

  /**
   * Whether to show the permission prompt to this user (US-NOTIF-5).
   *
   * Server-held so a decline follows the person rather than the browser
   * profile, and is not undone by clearing site data.
   */
  router.get(
    '/notifications/push-preference',
    requireAuth,
    asyncHandler(controllers.shouldPrompt),
  );

  /** Record that the user declined the prompt, so it is not shown again. */
  router.post(
    '/notifications/push-preference/decline',
    requireAuth,
    asyncHandler(controllers.declinePrompt),
  );

  /** The public VAPID key the browser needs to subscribe. Public by design. */
  router.get('/notifications/vapid-key', (_req, res) => {
    res.json({ publicKey: config.VAPID_PUBLIC_KEY, enabled: controllers.pushEnabled() });
  });

  /**
   * Queue status (US-NOTIF-4).
   *
   * Admin-only: queue internals leak operational detail and must not be
   * public (AC4).
   */
  router.get(
    '/notifications/queue/status',
    requireAuth,
    requireRole(Role.ADMIN),
    asyncHandler(async (_req, res) => {
      const counts = await queueCounts(queue);
      const [waiting, failed, delayed] = await Promise.all([
        queue.getJobs(['waiting'], 0, 10),
        queue.getJobs(['failed'], 0, 10),
        queue.getJobs(['delayed'], 0, 10),
      ]);

      res.json({
        queue: queue.name,
        counts,
        waiting: waiting.map(summariseJob),
        // Failed jobs carry their reason so the failure is inspectable (AC4).
        failed: failed.map((j) => ({
          ...summariseJob(j),
          attemptsMade: j.attemptsMade,
          failedReason: j.failedReason,
        })),
        delayed: delayed.map((j) => ({
          ...summariseJob(j),
          delayUntil: j.opts?.delay ? new Date(j.timestamp + j.opts.delay) : null,
        })),
      });
    }),
  );

  /** One job's state by id (US-NOTIF-4 AC2). */
  router.get(
    '/notifications/queue/jobs/:jobId',
    requireAuth,
    requireRole(Role.ADMIN),
    asyncHandler(async (req, res) => {
      const job = await queue.getJob(req.params.jobId);
      if (!job) return res.status(404).json({ error: { message: 'Job not found or evicted' } });

      res.json({
        id: job.id,
        name: job.name,
        state: await job.getState(),
        attemptsMade: job.attemptsMade,
        maxAttempts: job.opts.attempts,
        failedReason: job.failedReason ?? null,
        data: job.data,
      });
    }),
  );

  return router;
}

function summariseJob(job) {
  return { id: job.id, name: job.name, data: job.data, timestamp: job.timestamp };
}
