# Order Management Platform

A production-style Mini E-Commerce / Order Management Platform built on the MERN stack with a microservice backend, Redis caching, BullMQ background jobs, sandbox payment-gateway integration, and push notifications.

Customers browse products, add them to a cart, place an order, pay through a payment gateway, and receive notifications as the order progresses. Administrators manage the catalogue and move orders through their fulfilment lifecycle.

> **Status:** feature-complete. All services, the notification worker, and the React frontend are implemented and running.

---

## Table of contents

- [Project overview](#project-overview)
- [Architecture](#architecture)
- [Technologies](#technologies)
- [Project structure](#project-structure)
- [Admin portal](#admin-portal)
- [Installation](#installation)
- [Environment variables](#environment-variables)
- [Testing](#testing)
- [API documentation](#api-documentation)
- [Data model](#data-model)
- [Redis usage](#redis-usage)
- [Background jobs](#background-jobs)
- [Payment flow](#payment-flow)
- [Security](#security)
- [Test credentials](#test-credentials)
- [Payment sandbox](#payment-sandbox)
- [Documentation](#documentation)

---

## Project overview

The platform is split into a React customer application and five backend services behind an API gateway.

**Customers** register and sign in, browse a searchable and filterable product catalogue, view product details, manage a cart, check out with delivery details, pay through a gateway sandbox, and track their orders. They receive push notifications when an order is placed, when payment succeeds, and as the order is confirmed, shipped, and delivered.

**Administrators** work in a separate admin portal at `/admin`, with its own sidebar shell rather than the storefront header. It has five sections: a dashboard of operational figures, product management (create, edit, delete, inline restock), category management, order management with the fulfilment pipeline `Pending → Confirmed → Processing → Shipped → Delivered`, and a BullMQ queue monitor showing waiting, failed, and delayed jobs.

Two principles shape the backend:

1. **The server is the authority.** Client-side clamping, disabled controls, and hidden navigation are conveniences. Stock, authorization, totals, and payment state are enforced server-side.
2. **Payment state changes only on a verified webhook.** The frontend's payment-success callback is advisory; an order is marked paid only after the gateway's webhook signature is independently verified.

The full behavioural specification — 48 user stories with acceptance criteria — is in [`docs/user-stories/`](docs/user-stories/).

---

## Architecture

```
                            React App (Vite + Tailwind)
                                       │
                                       ▼
                                 API Gateway
                                       │
              ┌────────────────┬───────┴────────┬────────────────┐
              ▼                ▼                ▼                ▼
        Auth Service    Product Service   Order Service   Payment Service
              │                │                │                │
              └────────────────┴────────┬───────┴────────────────┘
                                        │
                          ┌─────────────┴─────────────┐
                          ▼                           ▼
                       MongoDB                      Redis
                                                      │
                                          ┌───────────┴───────────┐
                                          ▼                       ▼
                                    Cache (products,        BullMQ queues
                                     categories)                  │
                                                                  ▼
                                                         Notification Worker
                                                                  │
                                                                  ▼
                                                         Notification Service
                                                                  │
                                                                  ▼
                                                          Push Notification
```

### Services

| Service | Responsibility | Default port |
|---|---|---|
| **API Gateway** | Routes client traffic to services by path prefix; CORS boundary | 4000 |
| **Auth Service** | Registration, login, JWT issuance, user management | 4001 |
| **Product Service** | Products, categories, search, stock | 4002 |
| **Order Service** | Cart, orders, order status | 4003 |
| **Payment Service** | Payment creation, verification, webhook handling, payment status | 4004 |
| **Notification Service** | Push notifications, order and payment notifications | 4005 |
| **Notification Worker** | Consumes BullMQ jobs and delivers notifications | — |

Each service is a separate application with its own entry point, dependencies, and environment configuration, and each enforces its own authentication and authorization. The gateway routes traffic; it is not the sole security boundary. Services communicate over defined HTTP interfaces or the shared queue — never by reading another service's collections directly.

---

## Technologies

| Layer | Technology |
|---|---|
| Frontend | React.js, Tailwind CSS, Vite, React Router |
| Backend | Node.js, Express.js |
| Database | MongoDB (Mongoose) |
| Cache & queue backend | Redis |
| Background jobs | BullMQ |
| Payment gateway | Razorpay (sandbox/test mode) |
| Push notifications | Web Push (VAPID) + service worker |
| Authentication | JWT, bcrypt password hashing |
| Security | helmet, cors, express-rate-limit |
| Logging | Pino (structured) |
| Validation | Schema validation middleware on every route |

---

## Project structure

```
order-management-platform/
├── frontend/                    # React + Tailwind storefront and admin portal
│   └── src/
│       ├── components/          # Shared UI, incl. loading/empty/error states
│       │   └── admin/           # Admin design system: shell, table, form field,
│       │                        #   primitives, SVG icon set
│       ├── pages/               # Storefront pages
│       │   └── admin/           # Dashboard, Products, Categories, Orders, Queue
│       ├── hooks/               # Shared data-fetching state machine
│       ├── services/            # API client
│       └── utils/               # Currency and date formatters
├── gateway/                     # API gateway
├── services/                    # each with src/ and test/
│   ├── auth-service/
│   ├── product-service/
│   ├── order-service/
│   ├── payment-service/
│   └── notification-service/
├── workers/
│   └── notification-worker/
├── shared/                      # Error shape, status enums, validation, signatures
│   ├── src/
│   └── test/                    # 62 unit tests
├── docs/
│   ├── erd.md                   # Data model: collections, relationships, indexes
│   └── user-stories/            # 48 user stories with acceptance criteria
├── .env.example
└── README.md
```

Shared code — the error response shape, order status enum, and validation helpers — lives in `shared/` rather than being copy-pasted, so the services cannot drift apart.

---

## Admin portal

The admin portal lives at `/admin` inside the same React application, but under its own shell: a persistent dark sidebar (an off-canvas drawer below `lg`) instead of the storefront's top bar, denser spacing, and no cart. It is guarded by `RequireAdmin` on the layout route, so every child route inherits the check — and every endpoint it calls independently enforces `ADMIN` server-side.

| Route | Screen | Data source |
| --- | --- | --- |
| `/admin` | Dashboard — settled revenue, order counts, low stock, recent orders | `GET /api/orders/admin`, `GET /api/products/admin/all` |
| `/admin/products` | Create, edit, delete, inline restock | `/api/products*`, `/api/categories` |
| `/admin/categories` | List and create categories, with product and stock counts | `/api/categories`, `/api/products/admin/all` |
| `/admin/orders` | Seven required columns; advance the fulfilment pipeline | `GET /api/orders/admin`, `PATCH /api/orders/:id/status` |
| `/admin/queue` | BullMQ counts and waiting / failed / delayed jobs | `GET /api/notifications/queue/status` |

The portal added no backend endpoints — every screen is built on APIs that already existed.

### Design tokens

Colour is fully tokenised. No component names a palette step (`slate-600`, `amber-100`); components name a **role** (`text-content-muted`, `bg-warning-soft`). There are two layers, defined in [`frontend/src/styles/tokens.css`](frontend/src/styles/tokens.css):

```
--palette-*   raw values      (referenced only by the semantic layer)
     ↓
--color-*     semantic roles  (the only layer components may use)
     ↓
Tailwind utilities            bg-surface, text-content, border-line, bg-danger-soft
```

The indirection is what makes theming possible: a theme re-points semantic roles at different primitives without touching a component. Values are stored as bare `R G B` channels rather than hex so Tailwind's opacity modifiers still work (`bg-scrim/60`).

| Role group | Tokens |
| --- | --- |
| Surfaces | `canvas`, `surface`, `surface-sunken`, `surface-hover`, `surface-active`, `surface-inverse*` |
| Text | `content`, `content-secondary`, `content-muted`, `content-subtle`, `content-inverse`, `content-on-inverse*` |
| Lines | `line`, `line-strong`, `line-subtle`, `line-inverse` |
| Action | `primary`, `primary-hover`, `primary-soft`, `primary-text`, `on-primary` |
| Status | `danger*`, `warning*`, `success*`, `info*`, `neutral-*` |
| Fulfilment stages | `stage-shipped-*`, `stage-processing-*`, `stage-confirmed-*` |
| Misc | `ring`, `scrim` |

[`frontend/src/utils/status.js`](frontend/src/utils/status.js) owns the status → tone decision — the single place that knows "Paid is success, Shipped is its own stage". It replaced three separate hand-written colour maps (the formatter, the admin `StatCard` tones, the queue job dots) that each restated the same judgement.

Status pills resolve to one component class (`badge-success`) rather than a pair of utilities, so a background and its text colour can never be mismatched at the call site. Because that name is composed at runtime, the seven tone classes are listed in `safelist` in [`tailwind.config.js`](frontend/tailwind.config.js) — without it Tailwind purges them and badges render colourless. Adding a tone means three coordinated edits, noted in the `Tone` enum's comment.

Re-theming is a one-line change: point `--palette-brand-600` at another value and every primary button, active nav item, link, and focus ring follows.

### Reusable component system

The portal is built from one small vocabulary in `frontend/src/components/admin/`, so a screen composes primitives rather than restating markup:

| Module | Provides | Replaces |
| --- | --- | --- |
| `DataTable.jsx` | Responsive table: columns declared once, rendered as a `<table>` on desktop and regrouped into cards below the breakpoint. Owns the loading, empty, and error branches. | Each screen hand-writing a table *and* a parallel mobile card stack *and* its own state branches — four copies per screen, synced by hand |
| `Primitives.jsx` | `Panel`, `PageHeader`, `Toolbar`, `SearchInput`, `FilterChips`, `StatCard`, `Modal`, `ConfirmDialog`, `Pagination` | Per-screen pagers, filter rows, and dialogs |
| `Field.jsx` | One field wrapper for input / textarea / select, wiring `<label for>`, `aria-invalid`, and `aria-describedby` for hint and error | Label + input + error + ARIA retyped per input |
| `Icons.jsx` | Stroke-consistent inline SVG icon set (24px grid, 1.5px stroke) | Emoji glyphs, which render differently per platform and cannot be themed |
| `AdminLayout.jsx` | Sidebar shell, adaptive drawer, skip link, focus and scroll handling | — |

`Modal` owns the behaviour most easily got wrong and most often duplicated: focus moves in on open and returns to the trigger on close, Tab is trapped, Escape and backdrop-click dismiss, and the page behind cannot scroll. `ConfirmDialog` is built on it, so the one destructive path cannot drift from the rest.

The portal reuses the existing `useFetch` state machine, `api` client, `States.jsx` (loading / empty / error), and `format.js` unchanged — it did not fork them.

---

## Installation

### Prerequisites

- Node.js 20+
- MongoDB 6+ running locally, or a connection string
- Redis 7+ running locally, or a connection string

### Setup

```bash
# 1. Clone
git clone <repository-url>
cd order-management-platform

# 2. Install dependencies for all services and the frontend
npm install

# 3. Create environment files from the template
cp .env.example .env

# 4. Seed the database with categories, products, and test users
npm run seed

# 5. Start everything in development
npm run dev
```

`npm run dev` starts the gateway, all five services, the notification worker, and the frontend together.

The frontend is served at `http://localhost:5173` and the API gateway at `http://localhost:4000`.

### Useful scripts

| Script | Purpose |
|---|---|
| `npm run dev` | Start all services, worker, and frontend |
| `npm run seed` | Seed categories, products, and test users |
| `npm run lint` | Lint all workspaces |
| `npm test` | Run all tests across every workspace |

### Product images

Each product document stores its image URLs in the `images` array, so the catalogue the API serves is entirely database-driven. The files themselves are static assets committed under `frontend/public/products/`, served by the frontend as `/products/<slug>.webp` — the role a CDN or object store would play in production.

The seeded photos come from the [DummyJSON](https://dummyjson.com) demo product catalogue: real product photography on plain backgrounds, published for use in demos and prototypes. The seeded catalogue is deliberately built around items that have genuinely matching photos, since a storefront showing an unrelated stock photo reads as broken.

Re-seeding after changing the product list is safe: products no longer in the catalogue are soft-deleted and categories no longer referenced are removed, so no orphaned rows or empty filter chips are left behind.

To point the catalogue at a CDN instead, set `SEED_IMAGE_BASE_URL` (and `SEED_IMAGE_EXT` if the extension differs) before seeding — the seed writes the resulting URLs into the same field, and no application code changes:

```bash
SEED_IMAGE_BASE_URL=https://cdn.example.com/products npm run seed
```

### Verifying the stack is up

```bash
curl http://localhost:4000/health/services
```

Reports the health of all five services behind the gateway, so a single call confirms the whole backend.

### Receiving webhooks locally

Razorpay cannot reach `localhost`. Tunnel the **API gateway** so webhooks follow the same path as real traffic:

```bash
ngrok http 4000
```

Then register `https://<id>.ngrok-free.app/api/payments/webhook` in the Razorpay dashboard. Full walkthrough in [Payment sandbox](#payment-sandbox).

## Testing

```bash
npm test
```

Runs every workspace's suite with Node's built-in test runner — no test framework dependency.

| Workspace | Tests | Covers |
|---|---|---|
| `shared` | 62 | Error normalisation, webhook signatures, status transitions, money arithmetic, pagination, cache-aside, auth middleware |
| `product-service` | 17 | Product and query validation, injection resistance, price/stock bounds |
| `order-service` | 26 | Cart and checkout validation, empty-cart and flagged-line guards, abandoned-cart scheduling, stock reservation and release |
| `payment-service` | 7 | Signature forgery resistance, tamper detection, amount mismatch, idempotency |
| **Total** | **112** | |

Run one workspace on its own:

```bash
npm test --workspace shared
```

These are unit and contract tests over pure logic — they need no MongoDB, Redis, or running services. The security-critical paths they cover:

- **Webhook signatures** — forged, tampered, wrong-secret and re-serialised bodies are all rejected. One test asserts that re-formatting a body *breaks* verification, which is what proves the raw-body requirement is real rather than incidental.
- **Authorization** — a `role` in a request body cannot override the signed token claim; customers get `403` on admin routes, distinct from `401`.
- **Money** — integer minor units, with an explicit assertion that float arithmetic would drift.
- **Status transitions** — skipping stages and moving backwards are both rejected; `Delivered` is terminal.
- **Injection** — Mongo operator objects are rejected where strings are expected.

End-to-end flows (real payments, queue processing, cache invalidation) were verified manually against the running stack; see [Payment sandbox](#payment-sandbox) for reproducing the payment path.

---

## Environment variables

Copy [`.env.example`](.env.example) to `.env` and fill in the values. **Never commit `.env`** — `.gitignore` already excludes it while permitting `.env.example`.

| Variable | Description |
|---|---|
| `NODE_ENV` | `development` or `production` |
| `LOG_LEVEL` | Pino log level |
| `MONGODB_URI` | MongoDB connection string |
| `REDIS_URL` | Redis connection string |
| `JWT_SECRET` | Secret for signing JWTs |
| `JWT_EXPIRES_IN` | Token lifetime, e.g. `7d` |
| `BCRYPT_SALT_ROUNDS` | bcrypt cost factor |
| `GATEWAY_PORT` | API gateway port |
| `AUTH_SERVICE_PORT` | Auth Service port |
| `PRODUCT_SERVICE_PORT` | Product Service port |
| `ORDER_SERVICE_PORT` | Order Service port |
| `PAYMENT_SERVICE_PORT` | Payment Service port |
| `NOTIFICATION_SERVICE_PORT` | Notification Service port |
| `AUTH_SERVICE_URL` | Internal URL of the Auth Service |
| `PRODUCT_SERVICE_URL` | Internal URL of the Product Service |
| `ORDER_SERVICE_URL` | Internal URL of the Order Service |
| `PAYMENT_SERVICE_URL` | Internal URL of the Payment Service |
| `NOTIFICATION_SERVICE_URL` | Internal URL of the Notification Service |
| `CORS_ORIGINS` | Comma-separated allowlist of browser origins |
| `RATE_LIMIT_WINDOW_MS` | Rate limit window |
| `RATE_LIMIT_MAX` | Requests permitted per window |
| `AUTH_RATE_LIMIT_MAX` | Tighter limit for login and register |
| `RAZORPAY_KEY_ID` | Gateway public key id (safe to expose to the browser) |
| `RAZORPAY_KEY_SECRET` | Gateway secret key — **server only** |
| `RAZORPAY_WEBHOOK_SECRET` | Webhook signing secret — **server only** |
| `VAPID_PUBLIC_KEY` | Web Push public key |
| `VAPID_PRIVATE_KEY` | Web Push private key — **server only** |
| `VAPID_SUBJECT` | Contact URI for Web Push, e.g. `mailto:...` |
| `CACHE_TTL_SECONDS` | Product list and detail cache TTL |
| `CATEGORY_CACHE_TTL_SECONDS` | Category cache TTL — longer, as categories rarely change |
| `QUEUE_ATTEMPTS` | BullMQ retry attempts per job |
| `QUEUE_BACKOFF_DELAY_MS` | Base delay for exponential backoff |
| `QUEUE_CONCURRENCY` | Jobs the notification worker handles in parallel |
| `SEED_ADMIN_EMAIL` | Seeded admin account email (local only) |
| `SEED_ADMIN_PASSWORD` | Seeded admin account password (local only) |
| `SEED_CUSTOMER_EMAIL` | Seeded customer account email (local only) |
| `SEED_CUSTOMER_PASSWORD` | Seeded customer account password (local only) |
| `VITE_API_BASE_URL` | Gateway URL the frontend calls. Leave as-is for local development; see the note below when testing across devices |
| `VITE_RAZORPAY_KEY_ID` | Gateway public key id for the checkout widget |
| `VITE_VAPID_PUBLIC_KEY` | Web Push public key for the browser subscription |

> Variables prefixed `VITE_` are embedded in the client bundle and are **public**. Never place a secret behind that prefix.

Each service validates its required variables at startup and fails fast with a clear message if one is missing.

---

## API documentation

All routes are reached through the gateway at `http://localhost:4000`.

Authentication uses a bearer token: `Authorization: Bearer <jwt>`.

### Auth — `/api/auth`

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `POST` | `/api/auth/register` | — | Register; returns a JWT. Role is always `CUSTOMER` |
| `POST` | `/api/auth/login` | — | Log in; returns a JWT |
| `GET` | `/api/auth/verify` | Bearer | Validate a token and return its claims |
| `GET` | `/api/users/me` | Bearer | Current user profile |

### Products — `/api/products`

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `GET` | `/api/products` | — | List products. Query: `search`, `category`, `page`, `limit` |
| `GET` | `/api/products/:id` | — | Product detail |
| `POST` | `/api/products` | ADMIN | Create a product |
| `PUT` | `/api/products/:id` | ADMIN | Update a product |
| `PATCH` | `/api/products/:id/stock` | ADMIN | Update stock only |
| `DELETE` | `/api/products/:id` | ADMIN | Delete a product (soft delete) |
| `GET` | `/api/products/admin/all` | ADMIN | All products including soft-deleted |
| `GET` | `/api/products/:id/stock` | Internal | Live price and stock for one product |
| `POST` | `/api/products/stock/reserve` | Internal | Atomically decrement stock for order lines; 409 if insufficient |
| `POST` | `/api/products/stock/release` | Internal | Return stock for an order that will not be fulfilled |

### Categories — `/api/categories`

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `GET` | `/api/categories` | — | List categories |
| `POST` | `/api/categories` | ADMIN | Create a category |

### Cart — `/api/cart`

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `GET` | `/api/cart` | Bearer | Current user's cart with computed totals |
| `POST` | `/api/cart` | Bearer | Add an item `{ productId, quantity }`; merges with an existing line |
| `PATCH` | `/api/cart/:productId` | Bearer | Set a line's quantity |
| `DELETE` | `/api/cart/:productId` | Bearer | Remove a line |

### Orders — `/api/orders`

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `POST` | `/api/orders` | Bearer | Create an order from the cart |
| `GET` | `/api/orders` | Bearer | The caller's orders, newest first |
| `GET` | `/api/orders/:id` | Bearer | One order (ownership enforced) |
| `GET` | `/api/orders/admin` | ADMIN | All orders |
| `PATCH` | `/api/orders/:id/status` | ADMIN | Advance the order status |
| `PATCH` | `/api/orders/:id/payment` | Internal | Mark an order paid or failed; called by the Payment Service after a webhook verifies |

### Payments — `/api/payments`

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `POST` | `/api/payments/create` | Bearer | Create a gateway order for an existing order |
| `POST` | `/api/payments/webhook` | Signature | Gateway webhook. **Verified by HMAC signature, not JWT** |
| `GET` | `/api/payments/:orderId` | Bearer | Payment status for an order |

### Notifications — `/api/notifications`

| Method | Endpoint | Auth | Description |
|---|---|---|---|
| `GET` | `/api/notifications` | Bearer | The caller's notifications |
| `PATCH` | `/api/notifications/:id/read` | Bearer | Mark one notification read |
| `POST` | `/api/notifications/subscribe` | Bearer | Register a Web Push subscription |
| `POST` | `/api/notifications/unsubscribe` | Bearer | Remove this device's subscription |
| `GET` | `/api/notifications/vapid-key` | Public | VAPID public key the browser subscribes with |
| `GET` | `/api/notifications/push-preference` | Bearer | Whether to show the permission prompt |
| `POST` | `/api/notifications/push-preference/decline` | Bearer | Record a declined prompt so it is not repeated |
| `GET` | `/api/notifications/queue/status` | ADMIN | BullMQ queue counts and job states |
| `GET` | `/api/notifications/queue/jobs/:jobId` | ADMIN | One job's state by id |

### Status codes

| Code | Meaning |
|---|---|
| `200` / `201` | Success |
| `400` | Validation failure or malformed request |
| `401` | Missing or invalid token |
| `403` | Authenticated but not permitted |
| `404` | Not found |
| `409` | Conflict — insufficient stock, duplicate email, invalid status transition |
| `429` | Rate limited |
| `500` | Unexpected server error |

Errors share one response shape across all services:

```json
{
  "error": {
    "message": "Human-readable message",
    "code": "VALIDATION_ERROR",
    "details": [{ "field": "email", "message": "Must be a valid email address" }]
  }
}
```

Stack traces are included in development only, never in production.

---

## Data model

Seven collections, with the relationship the brief specifies:

```
User
├── Cart          (one per user)
└── Orders        (many)
    └── Payment   (one per order)
```

| Collection | Key fields | Indexes |
|---|---|---|
| `users` | name, email, passwordHash, role | `email` (unique) |
| `products` | name, description, price, stock, category, images[] | `category`, `name` (text), `createdAt` |
| `categories` | name, slug | `slug` (unique) |
| `carts` | userId, items[{ productId, quantity }] | `userId` (unique) |
| `orders` | userId, items[snapshot], totalAmount, customerInfo, deliveryAddress, orderStatus, paymentStatus | `userId + createdAt`, `orderStatus` |
| `payments` | orderId, gatewayOrderId, gatewayPaymentId, amount, status, signatureVerified | `orderId`, `gatewayPaymentId` (unique) |
| `notifications` | userId, orderId, event, channel, status, sentAt | `userId + createdAt` |

### Carts reference, orders snapshot

A deliberate asymmetry:

- **Carts store `productId` and `quantity` only.** Price and availability are resolved live, so a cart always reflects the current catalogue.
- **Orders store an item snapshot** — name, unit price, and quantity as they were at purchase. A placed order is immutable history and must not change when an admin edits or deletes a product.

This is why deleting a product breaks neither the cart (the line is flagged unavailable) nor past orders (they render from their own snapshot).

Money is stored in integer minor units throughout and formatted only for display, so no float rounding can reach a total.

---

## Redis usage

Redis serves two distinct purposes, as the brief requires.

### 1. Cache-aside for catalogue reads

```
Request → Redis → hit?  ── yes ──→ return
                    │
                    no
                    ↓
                 MongoDB → write to Redis → return
```

Keys: `products:list:<query-hash>`, `products:<id>`, `categories:all`. Query parameters are normalised before hashing, so `?page=1&category=x` and `?category=x&page=1` share a key.

Admin writes invalidate the keys they affect, so a catalogue change is visible immediately rather than at TTL expiry. Every Redis call degrades gracefully: if Redis is unreachable the request falls through to MongoDB and still succeeds.

Search results are deliberately **not** cached — the key space is unbounded and the hit rate would be poor.

### 2. BullMQ backing store

Redis is the queue backend for all background jobs described below.

---

## Background jobs

Four BullMQ jobs on the `notifications` queue, consumed by the notification worker.

| Job | Trigger | Scheduling | Result |
|---|---|---|---|
| **Order notification** | Order created | Immediate | Push: order placed successfully |
| **Payment confirmation** | Payment webhook verified | Immediate | Push: payment successful |
| **Order status notification** | Admin advances the order | Immediate | Push: confirmed / shipped / delivered |
| **Abandoned cart** | Cart modified and not checked out | **Delayed 30 min** | Push: items still waiting in the cart |

```
Order Created  → BullMQ Queue → Redis → Worker → Push Notification → Customer
Cart Modified  → BullMQ Queue (delay 30m) → Redis → Worker → Push Notification → Customer
```

**Mechanics demonstrated:** queue creation, job creation, worker consumption, retry with exponential backoff (5 attempts), failed-job retention for inspection, job status via queue counts, and delayed jobs.

Three rules govern the producers:

- Jobs are enqueued **after** the triggering write commits, so a job can never reference a state that failed to persist.
- An enqueue failure never fails the operation that triggered it — a notification problem must not fail an order, and a queue outage must not fail a cart update.
- Job handlers are idempotent, so a retry cannot deliver the same notification twice.

### The delayed job

The abandoned-cart reminder is scheduled with a fixed job id per user, so each cart change **replaces** the pending reminder rather than queueing another — the delay measures inactivity, not the number of edits. The job is removed when the cart empties or converts to an order, so a customer who checks out is never reminded about the cart they just bought.

Because the delay lives in Redis rather than a process-local timer, a scheduled reminder survives a service restart. Pending reminders are visible in the admin queue monitor at `/admin/queue` under *delayed*.

Order-based notifications deduplicate on `(userId, event, orderId)`. The abandoned-cart reminder has no order, so it deduplicates on `(userId, event, dedupeKey)` where the key is the calendar date — a customer who repeatedly abandons a cart is reminded once a day, not once per abandonment.

---

## Payment flow

```
User → Checkout → Create Order → Create Payment → Payment Gateway →
Payment Success → Payment Webhook → Update Order → Queue Notification → Send Notification
```

The frontend's payment-success callback is **advisory only**. An order becomes `Paid` solely when the gateway's webhook arrives and its signature verifies. Until then the confirmation page shows a "confirming your payment" state rather than asserting success.

Webhook verification:

1. The webhook route is registered with a **raw body parser before the global JSON parser** — the signature is computed over exact bytes, and parsing first breaks verification.
2. HMAC-SHA256 is computed over the raw body using `RAZORPAY_WEBHOOK_SECRET`.
3. It is compared against the gateway's signature header using a **timing-safe** comparison.
4. A mismatch returns `400` and changes nothing.
5. The gateway event id is persisted and checked, making redelivery idempotent; the unique index on `payments.gatewayPaymentId` is the database-level backstop.

The amount charged is always read from the stored order, never from the request body, so a client cannot pay ₹1 for a ₹10,000 order.

---

## Security

| Control | Implementation |
|---|---|
| Password hashing | bcrypt, cost factor from environment |
| Authentication | JWT bearer tokens, finite expiry |
| Protected routes | Route guards on the frontend, auth middleware on every protected endpoint |
| Role-based authorization | `CUSTOMER` and `ADMIN`; role read from the verified JWT claim, never from the request body |
| Input validation | Schema validation middleware on every route; unexpected fields stripped |
| Payment verification | HMAC signature over the raw webhook body, timing-safe comparison |
| Rate limiting | `express-rate-limit` on authentication and other sensitive routes |
| CORS | Explicit origin allowlist from configuration — no wildcard |
| Security headers | helmet |
| Secrets | Environment variables only; `.env` excluded from Git |

Two rules worth stating plainly:

- **Hiding a control is not a control.** Admin navigation is hidden from customers *and* every admin endpoint independently enforces the role. The server check is the real one.
- **Field stripping prevents privilege escalation.** A `role` field in a registration body is discarded, and a client-supplied total at checkout is ignored in favour of a server-computed figure.

---

## Test credentials

Created by `npm run seed`. Passwords come from `SEED_ADMIN_PASSWORD` and `SEED_CUSTOMER_PASSWORD` in your `.env` — they are never hard-coded in the repository.

| Role | Email | Password |
|---|---|---|
| Customer | `customer@example.com` | value of `SEED_CUSTOMER_PASSWORD` |
| Admin | `admin@example.com` | value of `SEED_ADMIN_PASSWORD` |

The seed also creates 4 categories and 15 products, two of which have zero stock so the out-of-stock states can be exercised without editing data.

Seed credentials are for local development and the assessment sandbox only.

---

## Payment sandbox

The integration runs in Razorpay **test mode**. No real money moves.

### 1. Credentials

1. Create a free Razorpay account and switch the dashboard to **Test Mode**.
2. Settings → API Keys → Generate Test Key.
3. Put them in `.env`:
   ```
   RAZORPAY_KEY_ID=rzp_test_xxxxxxxxxxxxxx
   RAZORPAY_KEY_SECRET=xxxxxxxxxxxxxxxxxxxxxxxx
   VITE_RAZORPAY_KEY_ID=rzp_test_xxxxxxxxxxxxxx
   ```

`RAZORPAY_KEY_ID` is public and reaches the browser. `RAZORPAY_KEY_SECRET` is server-side only and must never appear in a `VITE_` variable.

Without credentials the Payment Service falls back to a **mock gateway** in development, which signs webhooks with the same HMAC so the verification path is still genuinely exercised. It refuses to start in production.

### 2. Webhook endpoint

Razorpay must reach your machine, which `localhost` does not expose. Tunnel the **API gateway** (port 4000), not the Payment Service directly, so the request follows the same path a real one would:

```bash
ngrok http 4000
```

In the dashboard: Settings → Webhooks → Add New Webhook.

| Field | Value |
|---|---|
| Webhook URL | `https://<your-ngrok-id>.ngrok-free.app/api/payments/webhook` |
| Secret | any strong random string — put the same value in `RAZORPAY_WEBHOOK_SECRET` |
| Active events | `payment.captured`, `payment.failed` |

The webhook secret is **separate from the API key secret** and is generated when you create the webhook.

Restart the Payment Service after changing `.env`.

### 3. Test payment

| Method | Details |
|---|---|
| Card | `4111 1111 1111 1111`, any future expiry, any CVV, any name |
| UPI | `success@razorpay` (or `failure@razorpay` to test the failure path) |
| Netbanking | Any listed bank, then choose Success or Failure |

Flow: add to cart → checkout → Pay → complete in the modal. The confirmation page shows **"Confirming your payment…"** while it polls, then flips to Paid once the webhook has been received and its signature verified.

### Verifying without a tunnel

The signature path can be exercised locally by sending a correctly-signed webhook yourself:

```bash
SECRET="<your RAZORPAY_WEBHOOK_SECRET>"
GW="<gatewayOrderId from POST /api/payments/create>"

BODY=$(node -pe "JSON.stringify({event:'payment.captured',payload:{payment:{entity:{id:'pay_test_1',order_id:'$GW',amount:459900,currency:'INR'}}}})")
SIG=$(node -pe "require('crypto').createHmac('sha256','$SECRET').update(process.argv[1]).digest('hex')" "$BODY")

curl -X POST http://localhost:4000/api/payments/webhook \
  -H 'Content-Type: application/json' \
  -H "x-razorpay-signature: $SIG" \
  -d "$BODY"
```

Sending the same request twice returns `"duplicate": true` and changes nothing — the idempotency guarantee. Altering any byte of `BODY` without re-signing returns `400`.

### Troubleshooting

| Symptom | Cause |
|---|---|
| Webhook returns `400` with a valid-looking signature | A body parser ran before the raw-body parser. The route must receive unmodified bytes; the gateway registers no body parser for this reason. |
| Order stays Pending after paying | The webhook never arrived — check the tunnel is running and the dashboard URL matches its current address. ngrok free URLs change on restart. |
| `Payment gateway is unavailable` | Wrong or missing `RAZORPAY_KEY_SECRET`. |
| Confirmation page polls then stops | Bounded at ~30s. The order is safe and payment can be retried from **My orders**. |

The gateway is swappable — the brief permits Stripe or PayPal equally, and the payment stories are written gateway-agnostic. Only [`gateway.js`](services/payment-service/src/gateway.js) and the signature helper would change.

---

## Documentation

| Document | Contents |
|---|---|
| [`docs/user-stories/`](docs/user-stories/) | 48 user stories, 230 acceptance criteria, traceability matrix |
| [`docs/erd.md`](docs/erd.md) | Entity relationship diagram, collection schemas, indexes, status lifecycles |
| [`CLAUDE.md`](CLAUDE.md) | Restatement of the assessment requirements |

### Decisions

Points the brief leaves open, decided once and applied throughout:

| Decision | Choice | Rationale |
|---|---|---|
| Frontend build tool | React + Vite (SPA) | The brief assigns the backend to five Express microservices behind a gateway. A full-stack framework such as Next.js would leave its server half unused, or introduce a second server tier in front of the existing gateway — contradicting the specified architecture. The payment widget, service worker, and push subscription are client-side regardless, so SSR would not apply where the work is. Vite keeps the frontend a clean SPA consuming the gateway |
| Payment gateway | Razorpay, test mode | Brief permits Razorpay, Stripe, or PayPal; integration is gateway-agnostic |
| Push technology | Web Push (VAPID) | No third-party dependency; brief permits any suitable service |
| Product deletion | Soft delete | Keeps carts and order history coherent; listing queries exclude flagged records |
| Stock decrement | At order creation, via an atomic conditional `$inc` in the Product Service. Released again if the order write fails or payment fails. Chosen over decrementing at payment confirmation so two customers cannot both check out the last unit. | Determines oversell behaviour on abandoned payments |
| Advancing unpaid orders | Blocked past `Confirmed` until payment is `Paid` | Shipping unpaid goods is the costlier failure |
| Job status surface | Admin-only endpoint | Queue internals leak operational detail and must not be public |

---

## License

See [LICENSE](LICENSE).
