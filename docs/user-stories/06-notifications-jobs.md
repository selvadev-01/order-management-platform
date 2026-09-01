# 06 — Background Jobs & Push Notifications

**Source:** `Full-Stack MERN.docx` §6 (Redis as BullMQ backend), §7 (BullMQ), §8 (Push Notifications)
**Owning services:** Order Service / Payment Service (producers), Notification Service + workers (consumers)
**Actors:** CUSTOMER, SYSTEM

The docx flow this file implements:

```
Order Placed → BullMQ → Notification Worker → Push Notification → Customer
```

**A note on the SYSTEM actor:** §7 asks the candidate to *demonstrate* queue creation, workers, retries, failed jobs, job status, and delayed jobs. Several of these are engineering-visibility requirements with no human actor, so they are written as `SYSTEM` stories. They are included because they trace directly to explicit docx lines; omitting them would lose that traceability.

---

### US-NOTIF-1: Queue a notification when an order is placed

**Traces to:** docx §7 — "Order Notification Job: Order Created → BullMQ Queue → Redis → Worker → Push Notification"; §8 — "Order placed successfully"

**User Story**
As a CUSTOMER
I want to be notified as soon as my order is placed
So that I know it was received without waiting on a screen

**Acceptance Criteria**
- **AC1** — Given an order is created successfully, When the write commits, Then a job is added to the notification queue carrying the order id and event type.
- **AC2** — Given the job is enqueued, When the API responds, Then the response is not delayed by notification delivery — queueing is fire-and-forget from the request's perspective.
- **AC3** — Given the worker picks up the job, When it processes, Then a push notification is delivered to that customer and a `notifications` record is written.
- **AC4** — Given enqueueing fails, When the failure occurs, Then the order still succeeds and the failure is logged — a notification problem must never fail an order.
- **AC5** — Given the notification is delivered, When I inspect the record, Then it holds the user, event type, order reference, delivery status, and timestamp.

**Edge Cases**
- Redis down at enqueue time → the order still commits (AC4); the failure is logged for manual reconciliation.
- Worker offline when the job is queued → the job waits in Redis and is processed when the worker starts; nothing is lost.
- User has no push subscription → the job completes as "skipped, no subscription", which is a success, not a failure to retry.
- Order deleted before the worker runs → the job exits cleanly without erroring.

**Technical Considerations**
- This is **Redis use case #2** as required by docx §6 — BullMQ's backing store. Use case #1 is caching (US-PROD-6).
- Queue `notifications` on the Order Service side, consumed by the notification worker in `workers/notification-worker/`.
- Job payload is minimal — `{ userId, orderId, event }`. The worker re-reads current data rather than trusting a snapshot in the job, which is what makes the deleted-order edge case safe.
- Enqueue happens **after** the order write commits, so a job can never reference an order that failed to persist.
- The enqueue call is wrapped so its failure cannot propagate into the order transaction (AC4).
- Collection `notifications`: `{ userId, orderId, event, channel, status, sentAt, error, createdAt }`. Index on `userId` and `createdAt`.
- This is BullMQ job **#1 of the two** the docx requires.

**Design Notes**
- No synchronous UI. The user sees their order confirmation immediately; the notification arrives independently.
- The in-app notification surface is covered by US-NOTIF-6.

---

### US-NOTIF-2: Queue a payment-confirmation notification

**Traces to:** docx §7 — "Additional Job: Payment confirmation"; §8 — "Payment successful"

**User Story**
As a CUSTOMER
I want to be notified when my payment is confirmed
So that I know the money went through and my order is progressing

**Acceptance Criteria**
- **AC1** — Given a payment webhook verifies successfully, When the order is marked paid, Then a payment-confirmation job is enqueued.
- **AC2** — Given the worker processes the job, When it runs, Then the customer receives a payment-successful notification and a record is written.
- **AC3** — Given a payment fails, When the failure webhook is processed, Then no success notification is sent.
- **AC4** — Given a duplicate webhook is received, When it is handled idempotently (US-PAY-4 AC5), Then only one notification is sent, not two.

**Edge Cases**
- Payment confirmed for an order whose owner was deleted → the job exits cleanly.
- Webhook retried by the gateway after our timeout → deduplicated upstream by the webhook idempotency check, so this job never fires twice.
- Notification service unreachable → covered by the retry policy in US-NOTIF-3.

**Technical Considerations**
- Enqueued from the webhook handler (US-PAY-4 AC6), after the order state commits.
- This is BullMQ job **#2**, satisfying the docx's "at least two jobs" requirement alongside US-NOTIF-1.
- Shares the `notifications` queue with a different `event` discriminator, so one worker handles both job types through a switch on event — simpler than two parallel workers for two closely-related jobs.
- Job id is derived from the gateway event id, so BullMQ itself refuses a duplicate job — a second layer beneath the webhook-level dedupe, which is what makes AC4 robust.

**Design Notes**
- No synchronous UI. Delivery is via push (US-NOTIF-5) and the in-app list (US-NOTIF-6).

---

### US-NOTIF-3: Retry failed jobs with backoff

**Traces to:** docx §7 — "The candidate should demonstrate: Retry mechanism, Failed jobs"

**User Story**
As a SYSTEM
I want failed notification jobs retried automatically with backoff
So that a transient outage does not silently lose a customer's notification

**Acceptance Criteria**
- **AC1** — Given a job fails with a transient error, When it fails, Then it is retried up to the configured maximum attempts.
- **AC2** — Given a job is retried, When the delay before each retry is measured, Then it grows exponentially rather than retrying immediately.
- **AC3** — Given a job exhausts all attempts, When the final attempt fails, Then it moves to the failed set with its error recorded, and is not retried further.
- **AC4** — Given a job fails permanently, When I inspect the failed set, Then I can see the job data and the reason it failed.
- **AC5** — Given a job succeeds on a retry, When it completes, Then exactly one notification was delivered, not one per attempt.

**Edge Cases**
- A permanently invalid job (e.g. malformed payload) → failing fast without consuming all retries is preferable; non-retryable errors are distinguished from transient ones.
- Every attempt failing → the job rests in the failed set for inspection rather than disappearing.
- A retry succeeding after a partial side effect on an earlier attempt → the handler is written to be idempotent, which is what AC5 depends on.
- Worker crashing mid-job → BullMQ's stalled-job detection returns it to the queue.

**Technical Considerations**
- Job options: `attempts: 3–5` with `backoff: { type: 'exponential', delay: 1000 }`.
- Failed jobs are retained (`removeOnFail: false`) so AC4 is inspectable — the docx explicitly asks for failed-job handling to be demonstrable.
- Completed jobs are retained in a bounded window so job status (US-NOTIF-4) has something to read without growing Redis unboundedly.
- The worker distinguishes retryable errors (network, timeout, 5xx) from non-retryable ones (validation, missing user), keeping the fail-fast edge case honest.
- Handler idempotency is achieved by checking for an existing delivered `notifications` record before sending.

**Design Notes**
- No customer-facing UI. Observability is via logs and the job-status surface in US-NOTIF-4.

---

### US-NOTIF-4: Inspect job status

**Traces to:** docx §7 — "The candidate should demonstrate: Job status, Queue creation, Job creation, Worker"

**User Story**
As a SYSTEM
I want job state to be observable
So that queue behaviour can be verified rather than assumed

**Acceptance Criteria**
- **AC1** — Given jobs have been processed, When queue state is inspected, Then counts are available for waiting, active, completed, failed, and delayed.
- **AC2** — Given a specific job id, When it is looked up, Then its state, attempt count, and any failure reason are retrievable.
- **AC3** — Given a job moves between states, When it transitions, Then the transition is logged with the job id and event type.
- **AC4** — Given the job-status surface is exposed over HTTP, When a non-admin requests it, Then access is refused.

**Edge Cases**
- Redis unavailable when status is requested → returns a clear error rather than reporting zero counts, which would falsely imply an idle, healthy queue.
- Job already evicted by the retention policy → reported as unknown rather than as failed.
- Very large failed set → results are paginated or capped.

**Technical Considerations**
- BullMQ's `getJobCounts()` and `getJob(id)`.
- Exposed either as an admin-only route (`GET /api/notifications/queue/status`, guarded by the `ADMIN` middleware from US-AUTH-6) or as a documented CLI script. Either satisfies the docx; the choice is recorded in the README.
- AC4 matters because queue internals leak operational detail and must not be public.
- Structured logging on job lifecycle events (docx §3, "Logging") is what makes the flow demonstrable during assessment review.

**Design Notes**
- If surfaced in the admin dashboard, a simple counts panel suffices — the docx explicitly says not to focus on visual complexity.
- States: **loading**, **error**, **success**.

---

### US-NOTIF-5: Deliver push notifications for order events

**Traces to:** docx §8 — "Order placed successfully, Payment successful, Order confirmed, Order shipped, Order delivered"

**User Story**
As a CUSTOMER
I want push notifications for the milestones of my order
So that I stay informed without checking the site

**Acceptance Criteria**
- **AC1** — Given I have granted notification permission, When any of the five events occurs on my order, Then I receive a push notification naming the event and my order.
- **AC2** — Given I have not been asked yet, When I first reach a point where notifications are relevant, Then I am prompted for permission with an explanation of why.
- **AC3** — Given I deny permission, When events occur, Then the app continues to work normally and notifications are recorded in-app instead (US-NOTIF-6).
- **AC4** — Given I click a notification, When it opens, Then I land on the relevant order.
- **AC5** — Given delivery fails, When the worker handles the failure, Then it is recorded on the notification record and retried per US-NOTIF-3.

**Edge Cases**
- Permission granted then later revoked in browser settings → the subscription becomes invalid; the worker marks it expired and stops retrying against it.
- Same user on several devices → each subscription receives the notification.
- Browser without push support → the app degrades to in-app notifications only, without errors.
- Subscription rejected as expired by the push service → removed from the user record so it is not retried indefinitely.
- Notification arriving while the user is already on the order page → still delivered; deduplication is not required.

**Technical Considerations**
- Web Push (VAPID) with a service worker is the assumed technology; the docx permits any suitable service, so this is swappable and the choice is documented in the README.
- Push subscriptions are stored per user, supporting several devices per user.
- VAPID keys come from environment variables and are never committed (docx §11).
- The five events map to the status transitions in `08-admin-orders.md` (Confirmed, Shipped, Delivered) plus order placement (US-NOTIF-1) and payment success (US-NOTIF-2), so every named event has a producer.
- All delivery happens in the worker, never in a request handler, keeping API latency independent of the push service.
- Expired-subscription cleanup is what stops the failed set filling with permanently undeliverable jobs.

**Design Notes**
- The permission prompt is preceded by an in-app explanation rather than firing the browser prompt cold on page load — a cold prompt is usually denied, and a denial is hard to reverse.
- Notification copy is short and states the order reference plainly.
- AC3 is important for accessibility and for users who decline: the app must be fully usable without notifications.

---

### US-NOTIF-6: View notifications in the app

**Traces to:** docx §3 — "/api/notifications"; §8 — push notification events

**User Story**
As a CUSTOMER
I want to see my notifications inside the app
So that I do not lose track of an update I missed or dismissed

**Acceptance Criteria**
- **AC1** — Given notifications have been generated for me, When I open the notifications view, Then they are listed newest first with event type, order reference, and time.
- **AC2** — Given I have no notifications, When I open the view, Then the empty state renders.
- **AC3** — Given I select a notification, When it opens, Then I go to the related order.
- **AC4** — Given another user's notifications exist, When I request notifications, Then only my own are returned.

**Edge Cases**
- Notification referencing a deleted order → renders with its stored text but without a working link.
- Long list → paginated using the same pattern as US-PROD-4.
- Fetch failure → error state with retry.

**Technical Considerations**
- `GET /api/notifications` on the Notification Service. Requires authentication; scoped to the authenticated `userId` from the JWT, which is what makes AC4 hold.
- Reads the `notifications` collection written by the worker in US-NOTIF-1 AC3 — the same records, so in-app and push never disagree about what happened.
- Sorted by `createdAt` descending, using the index from US-NOTIF-1.
- Status codes: `200`, `401` unauthenticated.

**Design Notes**
- Reachable from the header. A simple list, since the docx de-emphasises visual complexity.
- States: **loading**, **empty**, **error**, **success** — reusing the shared components from US-PROD-5.
- Each entry is a link with an accessible name covering both the event and the order.

---

### US-NOTIF-7: Schedule a delayed job

**Traces to:** docx §7 — "The candidate should demonstrate: Delayed jobs"

**User Story**
As a SYSTEM
I want to schedule a job to run after a delay
So that time-based follow-ups are handled by the queue rather than by ad-hoc timers

**Acceptance Criteria**
- **AC1** — Given a job is added with a delay, When it is enqueued, Then it sits in the delayed set and is not processed immediately.
- **AC2** — Given the delay elapses, When the scheduler promotes it, Then the worker processes it normally.
- **AC3** — Given a delayed job is pending, When queue counts are inspected (US-NOTIF-4), Then it appears in the delayed count.
- **AC4** — Given the condition that motivated the job no longer holds when it runs, When the worker processes it, Then it exits without sending anything.

**Edge Cases**
- Service restarted before the delay elapses → the job survives in Redis and still fires, because the delay lives in Redis rather than in a process-local timer.
- Delay of zero → behaves as an immediate job.
- Job's precondition resolved before firing → handled by AC4's check rather than by trying to cancel the job.

**Technical Considerations**
- BullMQ `{ delay: <ms> }` on job creation.
- Applied to a follow-up drawn from the docx's own suggestion list — an order-status follow-up notification is the natural fit, since it reuses the existing queue, worker, and notification record with no new concepts.
- The worker re-checks current state before acting (AC4), consistent with the minimal-payload principle in US-NOTIF-1.
- Chosen deliberately over a `setTimeout`, which would not survive a restart — this is the point the docx is testing.

**Design Notes**
- No dedicated UI. Observable through the delayed count in US-NOTIF-4 and the eventual notification.

---

## Coverage

| docx requirement | Covered by |
|---|---|
| §6 Redis as BullMQ backend (use case 2) | US-NOTIF-1 (technical) |
| §7 Order Notification Job (job 1) | US-NOTIF-1 |
| §7 Additional job — payment confirmation (job 2) | US-NOTIF-2 |
| §7 Queue creation | US-NOTIF-1, US-NOTIF-4 |
| §7 Job creation | US-NOTIF-1, US-NOTIF-2 |
| §7 Worker | US-NOTIF-1 AC3, US-NOTIF-4 |
| §7 Retry mechanism | US-NOTIF-3 AC1, AC2 |
| §7 Failed jobs | US-NOTIF-3 AC3, AC4 |
| §7 Job status | US-NOTIF-4 |
| §7 Delayed jobs | US-NOTIF-7 |
| §8 Order placed successfully | US-NOTIF-1 |
| §8 Payment successful | US-NOTIF-2 |
| §8 Order confirmed / shipped / delivered | US-NOTIF-5, driven by `08-admin-orders.md` |
