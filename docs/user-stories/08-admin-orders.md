# 08 — Admin: Order Management

**Source:** `Full-Stack MERN.docx` §9 (Admin Dashboard — Orders)
**Owning service:** Order Service
**Actors:** ADMIN

Every story here requires the `ADMIN` role (US-AUTH-6, `01-auth.md`).

The status lifecycle the docx specifies:

```
Pending → Confirmed → Processing → Shipped → Delivered
```

---

### US-ADMIN-6: View all orders

**Traces to:** docx §9 — "Orders: View: Order ID, Customer, Products, Amount, Payment status, Order status, Created date"

**User Story**
As an ADMIN
I want to see every order with its key details
So that I can monitor and fulfil what customers have bought

**Acceptance Criteria**
- **AC1** — Given orders exist, When I open the admin orders list, Then each row shows all seven required fields: order id, customer, products, amount, payment status, order status, and created date.
- **AC2** — Given no orders exist, When I open the list, Then the empty state renders.
- **AC3** — Given the list fails to load, When it settles, Then the error state renders with retry.
- **AC4** — Given many orders exist, When I browse, Then the list is paginated, newest first.
- **AC5** — Given I am not an admin, When I open the route or call the endpoint, Then I am refused — a customer must never see other customers' orders.

**Edge Cases**
- An order with many line items → the products column summarises (e.g. first item plus a count) with the full list on the detail view, rather than making rows unreadably tall.
- Customer account deleted after ordering → the order still renders using its stored customer information snapshot.
- Payment status and order status legitimately disagreeing (paid but still Processing) → both are shown as separate fields, never merged into one status.
- Order whose payment never completed → visible with payment status `Pending`, since these need attention.

**Technical Considerations**
- `GET /api/orders/admin` (or `GET /api/orders` with an admin scope, chosen once and documented). Requires `ADMIN`.
- The crucial difference from US-PAY-5: that query is scoped to the caller's `userId`; this one is not. The role guard is therefore the only thing preventing a full data leak, which is what makes AC5 the highest-risk criterion in this file.
- Customer information comes from the order's own `customerInfo` snapshot (US-PAY-1), so the deleted-customer edge case needs no join.
- Sorted by `createdAt` descending using the index from US-PAY-1. Pagination follows the US-PROD-4 contract.
- Status codes: `200`, `401` unauthenticated, `403` not an admin.

**Design Notes**
- A table from `lg` up, stacked cards below — seven columns cannot be shown legibly on a phone, so the mobile layout prioritises order id, status, amount, and date.
- Both status fields are labelled badges with text, never colour alone, and are visually distinguishable from each other.
- Dates are formatted through one shared date utility, consistently across the app.
- States: **loading**, **empty**, **error**, **success** — reusing the shared components from US-PROD-5.
- Amounts use the same currency formatter as the storefront (US-PROD-1), so admin and customer figures cannot disagree.

---

### US-ADMIN-7: View a single order's full detail

**Traces to:** docx §9 — "Orders: View: ... Products ..."

**User Story**
As an ADMIN
I want to open one order and see everything about it
So that I can fulfil it correctly and answer questions about it

**Acceptance Criteria**
- **AC1** — Given an order exists, When I open it, Then I see its full line items with quantities and unit prices, the total, customer information, delivery address, both statuses, and the created date.
- **AC2** — Given the order has a payment, When I view it, Then the payment status and gateway reference are shown.
- **AC3** — Given an order id that does not exist, When I request it, Then the response is `404`.
- **AC4** — Given I am viewing the order, When I look at the controls, Then the status update control (US-ADMIN-8) is available.

**Edge Cases**
- A product in the order has since been deleted → the line still renders from the order's snapshot (US-PAY-1 AC5).
- Order with no payment record (never attempted) → the payment section states that plainly rather than rendering blank.
- Malformed order id → `400` or `404`, never a `500` from a cast error.

**Technical Considerations**
- `GET /api/orders/:id` with admin scope, bypassing the ownership check that constrains US-PAY-5 AC4. Requires `ADMIN`.
- The payment detail is read from the `payments` collection via `orderId` (US-PAY-2), which is the docx's `Orders └── Payment` relationship in use.
- The gateway reference is shown for support purposes; no gateway secrets are ever included in the response.
- Status codes: `200`, `400` malformed id, `401`, `403`, `404`.

**Design Notes**
- A clear hierarchy: order id and statuses at the top, then line items, then customer and address, then payment.
- The delivery address is presented in a copy-friendly block, since it will be used for shipping.
- States: **loading**, **error**, **success**.
- The status control is prominent, as it is the main reason an admin opens this screen.

---

### US-ADMIN-8: Advance an order's status

**Traces to:** docx §9 — "Orders: Update: Pending → Confirmed → Processing → Shipped → Delivered"

**User Story**
As an ADMIN
I want to move an order through its fulfilment stages
So that the customer can see progress and be notified

**Acceptance Criteria**
- **AC1** — Given an order at any status before `Delivered`, When I advance it, Then it moves to the next status in the sequence and the change persists.
- **AC2** — Given an order's status changes, When the change commits, Then a notification job is enqueued for that customer (`06-notifications-jobs.md`).
- **AC3** — Given an order is `Delivered`, When I look at the controls, Then no further advance is offered, since it is the terminal status.
- **AC4** — Given I attempt an invalid transition via the API (skipping stages or moving backwards), When the server validates it, Then it is rejected and the status is unchanged.
- **AC5** — Given the customer views the order, When the status has changed, Then they see the new status (US-PAY-5 AC5).
- **AC6** — Given I am not an admin, When I call the status endpoint directly, Then the response is `403` and nothing changes.

**Edge Cases**
- Advancing an order whose payment is still `Pending` → either blocked, or permitted with an explicit warning. The docx does not specify; **recommendation: block advancement past `Confirmed` until payment is `Paid`**, since shipping unpaid goods is the costlier failure. The rule is documented in the README.
- Two admins advancing the same order simultaneously → the transition validation makes the second a rejected invalid transition rather than a double advance.
- Advance pressed twice quickly → the control disables during the request; the server-side validation is the real guard.
- Status update succeeding but the notification enqueue failing → the status change stands and the failure is logged, matching US-NOTIF-1 AC4.
- Order cancelled or refunded → **out of scope**; the docx defines no such status and none is invented here.

**Technical Considerations**
- `PATCH /api/orders/:id/status` with `{ status }`. Requires `ADMIN`.
- Transition validity is enforced by an explicit allowed-transitions map on the server (`Pending → Confirmed → Processing → Shipped → Delivered`), not by trusting the client to send only sensible values. This is what AC4 rests on, and it is why the enum lives in one shared module.
- The status enum is defined once and shared between the Order Service and the frontend, so the two cannot drift.
- The notification job is enqueued **after** the status write commits (AC2), consistent with the ordering rule in US-NOTIF-1 and US-PAY-4 AC6.
- The three customer-facing transitions here — Confirmed, Shipped, Delivered — are three of the five push events named in docx §8 and handled by US-NOTIF-5.
- Every status change is logged with the admin's user id, the order id, and the before/after values (docx §3, "Logging").
- Status codes: `200` updated, `400` invalid transition, `401`, `403`, `404`.

**Design Notes**
- A single primary action showing the next status by name ("Mark as Shipped") is clearer than a free dropdown of all statuses, and it makes invalid transitions largely unreachable in the UI.
- The current status is shown as a stepper so the position in the lifecycle is visible at a glance.
- States: **loading** (disabled control with spinner), **error** (inline, near the control), **success** (the stepper advances, announced via `aria-live`).
- The stepper conveys the current stage with text and position, not colour alone.

---

## Coverage

| docx requirement | Covered by |
|---|---|
| §9 View Order ID, Customer, Products, Amount, Payment status, Order status, Created date | US-ADMIN-6 AC1 |
| §9 (order detail with full product lines) | US-ADMIN-7 |
| §9 Update: Pending → Confirmed → Processing → Shipped → Delivered | US-ADMIN-8 |
| §8 Order confirmed / shipped / delivered notifications | US-ADMIN-8 AC2 → US-NOTIF-5 |
| §4 Orders └── Payment relationship | US-ADMIN-7 AC2 |
| §11 Role-based authorization | US-AUTH-6 (`01-auth.md`), asserted per story |
