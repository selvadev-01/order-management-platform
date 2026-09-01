# 05 — Checkout & Payment

**Source:** `Full-Stack MERN.docx` §2 (Checkout & Payment), §4 (Orders → Payment relationship), §11 (Payment signature verification)
**Owning services:** Order Service, Payment Service
**Actors:** CUSTOMER, SYSTEM

The docx flow this file implements end to end:

```
User → Checkout → Create Order → Create Payment → Payment Gateway →
Payment Success → Payment Webhook → Update Order → Queue Notification → Send Notification
```

**Gateway:** stories are written gateway-agnostic. Razorpay is assumed as the default in Technical Considerations and is swappable for Stripe or PayPal — the docx offers all three. Sandbox/test mode throughout.

---

### US-PAY-1: Complete the checkout form and create an order

**Traces to:** docx §2 — "Create a checkout page containing: Customer information, Delivery address, Order summary, Total amount, Payment option"

**User Story**
As a CUSTOMER
I want to enter my contact and delivery details alongside a summary of what I am buying
So that my order can be created and shipped to the right place

**Acceptance Criteria**
- **AC1** — Given I arrive at checkout with a valid cart, When the page loads, Then I see all five required sections: customer information, delivery address, order summary, total amount, and payment option.
- **AC2** — Given the order summary is shown, When I compare it to my cart, Then the line items and the total match exactly.
- **AC3** — Given I submit with any required field empty or malformed, When I submit, Then per-field validation errors render and no order is created.
- **AC4** — Given I submit valid details, When the request succeeds, Then an order is created with status `Pending` and payment status `Pending`, and I move to the payment step.
- **AC5** — Given an order has been created, When I inspect it, Then it holds a snapshot of the line items and prices as they were at creation — later catalogue price changes must not alter a placed order.
- **AC6** — Given I am not authenticated, When I open checkout, Then I am sent to login and returned afterwards.

**Edge Cases**
- Cart emptied in another tab before submission → order creation is refused with a message and I am returned to the cart.
- A line's stock fell below its cart quantity since I opened checkout → creation is refused naming the offending product; this is the last stock check before money is involved.
- A product was deleted between cart and submission → creation is refused and the line is flagged.
- Submit pressed twice → the button disables on first submit, and the server-side guard prevents a second order from the same cart.
- Total computed by the client disagreeing with the server → the server's figure is authoritative and the order uses it; a mismatch is logged as a possible tampering signal.

**Technical Considerations**
- `POST /api/orders` on the Order Service. Requires authentication.
- Collection `orders`: `{ userId, items: [{ productId, name, unitPrice, quantity }], totalAmount, customerInfo, deliveryAddress, orderStatus, paymentStatus, createdAt, updatedAt }`. Indexes on `userId` and `createdAt`.
- The item snapshot in AC5 is why `orders.items` denormalises name and price rather than referencing `products` alone — the opposite of the cart's design in US-CART-1, and deliberately so.
- `totalAmount` is recomputed server-side from current product prices; the client-supplied total is never trusted. Stored in integer minor units.
- Stock is re-validated here — the third and final check after add-to-cart (US-PDP-3) and checkout entry (US-CART-4).
- Whether stock is decremented at order creation or at payment confirmation is decided once and applied consistently; the choice is recorded in the README architecture notes since it determines oversell behaviour on abandoned payments.
- Request body validated by the shared validation middleware (docx §3).
- Status codes: `201` created, `400` validation failure, `401` unauthenticated, `409` stock conflict or empty cart.

**Design Notes**
- Two-column from `lg`: form left, sticky order summary right. Single column on mobile with the summary collapsed into an expandable panel above the form, so the total is visible without scrolling past every field.
- Form is grouped into clear fieldsets — Customer Information, Delivery Address, Payment — each with a `<legend>`.
- Address fields use correct `autocomplete` attributes (`street-address`, `postal-code`, `tel`, `email`) so browser autofill works, which materially reduces checkout abandonment.
- States: **form validation** (inline per field), **loading** (disabled submit with spinner), **error** (banner for API failure), **success** (advance to payment).
- On a validation failure focus moves to the first offending field and the error summary is announced via `role="alert"`.
- The total is the visually dominant figure in the summary.

---

### US-PAY-2: Create a payment against the order

**Traces to:** docx §2 — "Create Payment → Payment Gateway"

**User Story**
As a CUSTOMER
I want a payment to be initiated for my order
So that I can pay through the gateway

**Acceptance Criteria**
- **AC1** — Given an order has been created, When payment initiation runs, Then a gateway order/intent is created for exactly that order's total and currency.
- **AC2** — Given the gateway responds, When the payment record is written, Then it links to my order and carries status `Created` plus the gateway's reference id.
- **AC3** — Given payment initiation succeeds, When the client receives the response, Then it gets only what the gateway checkout needs — the public key and gateway reference — and never a secret key.
- **AC4** — Given the gateway is unreachable or rejects the request, When the response arrives, Then I see an error, my order stays `Pending`, and I am able to retry payment.
- **AC5** — Given I try to create a payment for an order that is not mine, When the server checks ownership, Then it responds `403` and creates nothing.

**Edge Cases**
- Payment initiated twice for one order → either the existing open gateway reference is reused or the prior one is superseded; the order must never end up with two live payment attempts that could both succeed.
- Order already paid → initiation is refused with `409`.
- Gateway times out after creating its side → reconciled by the webhook (US-PAY-4), which is the authority regardless of what the initiation call returned.
- Amount of zero or negative → refused before reaching the gateway.
- Currency mismatch between order and gateway configuration → refused with a clear server-side error rather than a partial charge.

**Technical Considerations**
- `POST /api/payments/create` on the Payment Service.
- Collection `payments`: `{ orderId, userId, gateway, gatewayOrderId, gatewayPaymentId, amount, currency, status, signatureVerified, createdAt, updatedAt }`. Index on `orderId` and a unique index on `gatewayPaymentId`. This is the docx's `Orders └── Payment` relationship.
- The amount sent to the gateway is read from the stored order, never from the request body — this is the control that stops a client from paying ₹1 for a ₹10,000 order.
- Gateway secret key (`RAZORPAY_KEY_SECRET` or equivalent) lives only in the Payment Service environment. Only the public key id reaches the browser, which is what AC3 enforces.
- Ownership check (AC5) compares the order's `userId` against the authenticated subject from the JWT.
- Status codes: `201` created, `400` invalid, `401` unauthenticated, `403` not the owner, `409` already paid, `502` gateway failure.

**Design Notes**
- Largely invisible: the user presses Pay and the gateway surface opens.
- State: **loading** covering the gap between pressing Pay and the gateway UI appearing — this window is otherwise a dead spot where users press twice.
- Gateway failure (AC4) is presented as recoverable, with a Retry Payment control and an explicit reassurance that the order was not lost.

---

### US-PAY-3: Pay through the gateway and return to the app

**Traces to:** docx §2 — "Payment Gateway → Payment Success"

**User Story**
As a CUSTOMER
I want to pay via the gateway's sandbox and come back to the shop
So that I know my payment went through

**Acceptance Criteria**
- **AC1** — Given a payment has been created, When I open the gateway checkout, Then it shows the correct amount and my order reference.
- **AC2** — Given I complete payment successfully in the sandbox, When I am returned to the app, Then I see a confirmation page for my order.
- **AC3** — Given I cancel or dismiss the gateway checkout, When I return, Then my order remains `Pending`, nothing is charged, and I can retry payment.
- **AC4** — Given payment fails at the gateway, When I return, Then I see the failure with a retry route and my order stays `Pending`.
- **AC5** — Given the frontend reports success, When the confirmation renders, Then it presents the order as awaiting confirmation until the backend has verified it — the UI must not assert "payment confirmed" on the client callback alone.

**Edge Cases**
- Browser closed mid-payment → the webhook (US-PAY-4) still settles the order server-side; the user sees the correct status on their next visit.
- Returning to the confirmation URL later → shows the order's current real status, not a stale success message.
- Payment succeeding at the gateway while the return redirect fails → the webhook is the reconciliation path; the user is never charged without their order updating.
- Back button pressed onto the gateway step after paying → detects the order is already paid and redirects to the confirmation.
- Network drop between success and redirect → same webhook reconciliation.

**Technical Considerations**
- Gateway checkout via the provider's client SDK (Razorpay Checkout modal, or a redirect flow for Stripe/PayPal).
- The client success handler may notify the backend, but that notification is **advisory only**. Order state changes on webhook verification (US-PAY-4). AC5 is the user-visible consequence of this rule.
- The confirmation page reads the order's real status from `GET /api/orders/:id`, so it reflects server truth rather than the callback payload.
- Cancellation is handled by the SDK's dismiss callback; no server state changes.
- Sandbox test card details are documented in the README, as the docx submission checklist requires.

**Design Notes**
- The confirmation page leads with the order number and current status, then the summary.
- States: **loading** (verifying), **success** (confirmed), **error** (failed with retry).
- While status is `Pending` verification, the page shows a "confirming your payment" state that polls or refreshes — this is exactly the AC5 distinction, and it must not look like a failure.
- The status region is `aria-live="polite"` so the transition from confirming to confirmed is announced.

---

### US-PAY-4: Verify payment server-side via webhook and signature

**Traces to:** docx §2 — "Do not rely only on the frontend payment-success response. The backend should verify the payment using the payment gateway webhook/signature mechanism"; §11 — "Payment signature verification"

**User Story**
As a SYSTEM
I want to verify every payment from the gateway's webhook and its signature
So that an order is only ever marked paid on evidence the backend independently trusts

**Acceptance Criteria**
- **AC1** — Given the gateway sends a webhook, When the signature is computed over the raw request body with the webhook secret, Then it must match the signature header or the request is rejected.
- **AC2** — Given a webhook with an invalid or absent signature, When it is processed, Then it is rejected with `400`, no order changes, and the attempt is logged.
- **AC3** — Given a valid payment-success webhook, When it is processed, Then the payment record becomes `Paid` with `signatureVerified: true`, and the order's payment status becomes `Paid` and its order status `Confirmed`.
- **AC4** — Given a valid payment-failure webhook, When it is processed, Then the payment becomes `Failed` and the order stays `Pending`, retryable.
- **AC5** — Given the same webhook is delivered more than once, When it is reprocessed, Then the outcome is identical to processing it once — no duplicate state changes and no duplicate notifications.
- **AC6** — Given an order is marked paid, When the change commits, Then a notification job is enqueued to BullMQ (see `06-notifications-jobs.md`).
- **AC7** — Given a client calls the order-update path directly claiming payment success, When the server handles it, Then the order's paid status is not changed — only a verified webhook can do that.

**Edge Cases**
- Webhook arriving before the payment record exists (gateway faster than our own write) → the handler retries or reconciles rather than dropping the event.
- Webhook amount disagreeing with the order total → rejected and flagged; the order is not marked paid.
- Webhook for an unknown order or payment id → logged and acknowledged with `200` so the gateway stops retrying, but no state changes.
- Body parsed as JSON before signature computation → breaks verification, because the signature is over the exact raw bytes. The raw body must be preserved on this route specifically.
- Gateway retrying after a timeout on our side → covered by the idempotency in AC5.
- Webhook secret rotated → both old and new secrets are accepted during a documented overlap window, or rotation is performed during a maintenance pause.

**Technical Considerations**
- `POST /api/payments/webhook` on the Payment Service. **Public route — no JWT.** The signature is the authentication, which is why AC1/AC2 carry the whole security burden here.
- This route is registered with a raw-body parser *before* the global JSON parser. This is the single most common implementation error in this flow and is called out here deliberately.
- Signature: HMAC-SHA256 over the raw body using `RAZORPAY_WEBHOOK_SECRET` (or the provider equivalent), compared against the provider's signature header using a **timing-safe** comparison, never `===`.
- Idempotency (AC5): the gateway event id is persisted and checked before processing, and the unique index on `gatewayPaymentId` is the database-level backstop.
- The order update and the job enqueue (AC6) are ordered so the order is committed before the job is queued — a job must never fire for a state that did not persist.
- Webhook secret and gateway keys come from environment variables only; none are committed (docx §11).
- Rate limiting is applied but tuned so legitimate gateway retries are not throttled.
- Status codes: `200` acknowledged (including for unknown-but-well-formed events, to stop retry storms), `400` bad signature.

**Design Notes**
- No user interface. The user-visible effect is the confirmation page in US-PAY-3 transitioning from confirming to confirmed.
- Every webhook receipt, its verification outcome, and the resulting state change are logged with the gateway event id, so the flow can be demonstrated and audited during review.

---

### US-PAY-5: View my orders and their status

**Traces to:** docx §14 — "GET /api/orders"; §4 — "User └── Orders"

**User Story**
As a CUSTOMER
I want to see the orders I have placed and where each one stands
So that I can track what I bought without contacting anyone

**Acceptance Criteria**
- **AC1** — Given I have placed orders, When I open my orders page, Then each is listed with its order id, date, total, payment status, and order status.
- **AC2** — Given I open one order, When it loads, Then I see its line items, delivery address, and payment status.
- **AC3** — Given I have placed no orders, When I open the page, Then the empty state renders with a route to the product listing.
- **AC4** — Given another user's order id, When I request it, Then the server responds `403` or `404` and reveals nothing about it.
- **AC5** — Given an admin advances my order's status, When I reload, Then the new status is reflected.

**Edge Cases**
- Order whose payment never completed → listed with payment status `Pending` and a route to retry payment.
- A product in a historical order has since been deleted → the order still renders in full, because it holds its own item snapshot (US-PAY-1 AC5).
- Many orders → paginated using the same pattern as US-PROD-4.
- Orders request fails → error state with retry, not an empty list, which would wrongly suggest no orders exist.

**Technical Considerations**
- `GET /api/orders` (mine) and `GET /api/orders/:id` (one) on the Order Service. Both require authentication.
- Every query is scoped by the authenticated `userId` from the JWT — the list is never filtered by a client-supplied user id, which is what makes AC4 hold.
- Sorted by `createdAt` descending, using the index from US-PAY-1.
- The item snapshot is what makes deleted products render correctly, so no join to `products` is needed for historical orders.
- Status codes: `200`, `401` unauthenticated, `403`/`404` for another user's order.

**Design Notes**
- List of order cards on mobile, a table from `md` up. Status is shown as a labelled badge with text, not colour alone.
- Payment status and order status are visually distinct from each other, since they are separate fields that can legitimately disagree (paid but still Processing).
- States: **loading** (skeleton rows), **empty**, **error**, **success**.
- Reuses the shared list-state components built in US-PROD-5.

---

## Coverage

| docx requirement | Covered by |
|---|---|
| §2 Customer information | US-PAY-1 AC1 |
| §2 Delivery address | US-PAY-1 AC1 |
| §2 Order summary | US-PAY-1 AC1, AC2 |
| §2 Total amount | US-PAY-1 AC1 |
| §2 Payment option | US-PAY-1 AC1 |
| §2 Create Order | US-PAY-1 |
| §2 Create Payment | US-PAY-2 |
| §2 Payment Gateway (test/sandbox) | US-PAY-3 |
| §2 Payment Webhook + signature verification | US-PAY-4 |
| §2 "Do not rely only on the frontend response" | US-PAY-4 AC7, US-PAY-3 AC5 |
| §2 Update Order | US-PAY-4 AC3 |
| §2 Queue Notification | US-PAY-4 AC6 → `06-notifications-jobs.md` |
| §4 Orders └── Payment relationship | US-PAY-2 (technical) |
| §11 Payment signature verification | US-PAY-4 AC1, AC2 |
