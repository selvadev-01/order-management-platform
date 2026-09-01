# User Stories & Acceptance Criteria

Backlog for the **Mini E-Commerce / Order Management Platform**.

**Source of truth:** `Full-Stack MERN.docx` (Full-Stack MERN Developer — Technical Assessment), restated in [CLAUDE.md](../../CLAUDE.md).

Every story carries a `**Traces to:**` line citing the docx section and quoting the requirement phrase it implements. **No story exists without such a citation** — this is the mechanism enforcing the document's instruction not to add scope beyond it.

---

## Files

| # | File | Covers | Stories |
|---|---|---|---|
| 01 | [01-auth.md](01-auth.md) | Login / Register, JWT, protected routes, roles | US-AUTH-1 … 6 |
| 02 | [02-product-listing.md](02-product-listing.md) | Listing, search, filter, pagination, states, Redis cache | US-PROD-1 … 6 |
| 03 | [03-product-details.md](03-product-details.md) | Details page, quantity selector, add to cart | US-PDP-1 … 4 |
| 04 | [04-shopping-cart.md](04-shopping-cart.md) | Cart view, remove, quantity, totals, checkout entry | US-CART-1 … 4 |
| 05 | [05-checkout-payment.md](05-checkout-payment.md) | Checkout, order creation, gateway, webhook verification | US-PAY-1 … 5 |
| 06 | [06-notifications-jobs.md](06-notifications-jobs.md) | BullMQ jobs, retries, job status, push notifications | US-NOTIF-1 … 7 |
| 07 | [07-admin-products.md](07-admin-products.md) | Admin product CRUD and stock | US-ADMIN-1 … 5 |
| 08 | [08-admin-orders.md](08-admin-orders.md) | Admin order list, detail, status lifecycle | US-ADMIN-6 … 8 |
| 09 | [09-cross-cutting.md](09-cross-cutting.md) | Backend, architecture, data model, security, UI states | US-SYS-1 … 8 |

**48 stories, 230 acceptance criteria.** Actors: `GUEST`, `CUSTOMER`, `ADMIN`, `SYSTEM`.

The data model these stories imply — collections, relationships, indexes and status
lifecycles — is drawn in [../erd.md](../erd.md).

---

## Story format

Each story follows the same five-part structure:

1. **User Story** — As a / I want to / So that
2. **Acceptance Criteria** — Given / When / Then, one per distinct observable behaviour
3. **Edge Cases**
4. **Technical Considerations** — service, endpoint, collection, index, queue, guard, status codes
5. **Design Notes** — layout, responsive behaviour, required UI states, accessibility

---

## Traceability matrix

Every requirement section of the docx, and where it is covered.

| docx § | Requirement | Covered by |
|---|---|---|
| §1.1 | Register / Login / Logout / validation errors / session | US-AUTH-1, 2, 3, 4 |
| §1.1 | JWT-based authentication | US-AUTH-2, US-AUTH-5 |
| §1.2 | Display image, name, description, price, stock, category | US-PROD-1 |
| §1.2 | Search | US-PROD-2 |
| §1.2 | Category filtering | US-PROD-3 |
| §1.2 | Pagination | US-PROD-4 |
| §1.2 | Loading / empty / error states | US-PROD-5 |
| §1.3 | Images, name, description, price, available stock | US-PDP-1 |
| §1.3 | Quantity selector | US-PDP-2 |
| §1.3 | Add to cart | US-PDP-3 |
| §1.4 | Add / remove products | US-PDP-3, US-CART-2 |
| §1.4 | Increase / decrease quantity | US-CART-3 |
| §1.4 | Subtotal / total | US-CART-1 |
| §1.4 | Proceed to checkout | US-CART-4 |
| §2 | Customer info, address, summary, total, payment option | US-PAY-1 |
| §2 | Create Order | US-PAY-1 |
| §2 | Create Payment → Gateway (sandbox) | US-PAY-2, US-PAY-3 |
| §2 | Payment Webhook + signature verification | US-PAY-4 |
| §2 | "Do not rely only on the frontend response" | US-PAY-4 AC7, US-PAY-3 AC5 |
| §2 | Update Order → Queue Notification | US-PAY-4 AC3, AC6 |
| §3 | Request validation | US-SYS-2 |
| §3 | Authentication middleware | US-AUTH-5 |
| §3 | Authorization middleware | US-AUTH-6 |
| §3 | Centralized error handling / status codes | US-SYS-1 |
| §3 | Logging | US-SYS-3 |
| §3 | Environment variables / API security | US-SYS-7 |
| §4 | Seven collections, schemas, indexes, relationships | US-SYS-6 |
| §5 | API Gateway | US-SYS-4 |
| §5 | Five minimum services | US-SYS-5 |
| §6 | Redis caching (use case 1) | US-PROD-6 |
| §6 | Redis as BullMQ backend (use case 2) | US-NOTIF-1 |
| §7 | Order notification job (job 1) | US-NOTIF-1 |
| §7 | Additional job — payment confirmation (job 2) | US-NOTIF-2 |
| §7 | Queue creation / job creation / worker | US-NOTIF-1, 2, 4 |
| §7 | Retry mechanism / failed jobs | US-NOTIF-3 |
| §7 | Job status | US-NOTIF-4 |
| §7 | Delayed jobs | US-NOTIF-7 |
| §8 | Push notifications for the five named events | US-NOTIF-5, US-NOTIF-6 |
| §9 | Admin products: create / edit / delete / update stock | US-ADMIN-1 … 5 |
| §9 | Admin orders: view seven fields | US-ADMIN-6, US-ADMIN-7 |
| §9 | Admin orders: Pending → Confirmed → Processing → Shipped → Delivered | US-ADMIN-8 |
| §10 | Six required UI states | US-SYS-8, US-PROD-5 |
| §10 | Responsive, mobile-friendly, accessible | US-SYS-8 AC6, AC7 |
| §11 | Password hashing | US-AUTH-1 AC5 |
| §11 | JWT authentication | US-AUTH-2 |
| §11 | Protected routes | US-AUTH-5 |
| §11 | Role-based authorization (CUSTOMER, ADMIN) | US-AUTH-6 |
| §11 | Environment variables / no secrets in Git | US-SYS-7 AC3, AC4 |
| §11 | Input validation | US-SYS-2 |
| §11 | Payment signature verification | US-PAY-4 AC1, AC2 |
| §11 | Basic rate limiting | US-SYS-7 AC1 |
| §11 | CORS configuration | US-SYS-7 AC2 |

### Deliberately not written as stories

These docx sections are project-delivery requirements rather than application behaviour. They are tracked here so their omission from the backlog is explicit, not accidental:

| docx § | Requirement | Where it is satisfied |
|---|---|---|
| §12 | Suggested project structure | Repository layout; referenced in US-SYS-5 |
| §14 | README (overview, architecture diagram, technologies, installation, env vars, API docs) | Root `README.md` |
| §16 | Git requirements — meaningful commits | Commit practice throughout |
| — | Assessment duration, submission checklist | Project management |

---

## Decisions recorded in these stories

Points where the docx leaves a genuine choice. Each is decided once here and should be restated in the root README:

| Decision | Choice | Story |
|---|---|---|
| Payment gateway | Razorpay assumed; stories are gateway-agnostic and Stripe/PayPal are equally valid | `05-checkout-payment.md` |
| Push technology | Web Push (VAPID) + service worker; docx permits any suitable service | US-NOTIF-5 |
| Product deletion | Soft delete recommended, so carts and order history stay coherent | US-ADMIN-4 |
| Stock decrement point | Order creation vs. payment confirmation — decided once, applied consistently | US-PAY-1 |
| Status advance while unpaid | Recommended: block advancement past `Confirmed` until payment is `Paid` | US-ADMIN-8 |
| Job status surface | Admin-only route or documented CLI script | US-NOTIF-4 |

---

## Cross-cutting rules worth noting before implementation

These recur across many stories and are each specified once:

- **The server is the authority.** Client-side clamping, disabled buttons, and hidden navigation are conveniences. Stock (US-PDP-3, US-PAY-1), authorization (US-AUTH-6), totals (US-CART-1), and payment state (US-PAY-4) are all enforced server-side.
- **Carts reference, orders snapshot.** Carts store `productId` + `quantity` so prices stay live; orders store item snapshots so history is immutable. This is why a deleted product breaks neither (US-CART-1, US-PAY-1 AC5).
- **Payment state changes only on a verified webhook.** The frontend success callback is advisory (US-PAY-4 AC7).
- **Enqueue after commit.** A job is never queued for a state that failed to persist, and a notification failure never fails the operation that triggered it (US-NOTIF-1 AC4).
- **Cache invalidation is the write path's job.** Every admin write invalidates the keys it affects (US-PROD-6 AC3, `07-admin-products.md`).
- **Shared UI state components.** Loading, empty, and error states are built once and reused by every list screen (US-SYS-8).
