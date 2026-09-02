# Testing Guide — All Flows

A step-by-step walkthrough for exercising every flow in the platform: setup, automated tests, the full customer journey in the browser, the same journey via API, admin flows, background jobs, notifications, and the security controls.

Follow it top to bottom for a complete verification pass, or jump to the flow you need.

- [0. Prerequisites](#0-prerequisites)
- [1. Setup](#1-setup)
- [2. Automated tests](#2-automated-tests)
- [3. Health check](#3-health-check)
- [4. Customer flow — browser](#4-customer-flow--browser)
- [5. Customer flow — API](#5-customer-flow--api)
- [6. Payment flow](#6-payment-flow)
- [7. Admin flows](#7-admin-flows)
- [8. Background jobs & queue](#8-background-jobs--queue)
- [9. Push notifications](#9-push-notifications)
- [10. Redis caching](#10-redis-caching)
- [11. Security & error handling](#11-security--error-handling)
- [12. UI states](#12-ui-states)
- [13. Full acceptance checklist](#13-full-acceptance-checklist)
- [14. Troubleshooting](#14-troubleshooting)

---

## 0. Prerequisites

| Requirement | Notes |
|---|---|
| Node.js ≥ 20 | `node -v` |
| MongoDB running | default `mongodb://localhost:27017` |
| Redis running | default `redis://localhost:6379` |
| `ngrok` *(optional)* | only for live Razorpay webhooks — [§6.3](#63-live-razorpay-with-a-tunnel) |

Confirm the datastores are actually up before starting — most "service won't boot" reports are one of these two being down:

```bash
mongosh --eval "db.runCommand({ping:1})"
redis-cli ping     # → PONG
```

---

## 1. Setup

```bash
npm install
cp .env.example .env
```

Edit `.env` and set, at minimum:

```bash
JWT_SECRET=<long random string>
SEED_ADMIN_PASSWORD=<a password you choose>
SEED_CUSTOMER_PASSWORD=<a password you choose>
```

Generate a strong JWT secret:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

Razorpay keys are **optional**. Left as placeholders, the Payment Service falls back to a built-in mock gateway that signs webhooks with the same HMAC — so the signature-verification path is genuinely exercised without a Razorpay account. See [§6](#6-payment-flow).

Seed the database and start everything:

```bash
npm run seed     # 4 categories, 15 products (2 with zero stock), 2 users
npm run dev      # gateway + 5 services + worker + frontend
```

| Process | URL |
|---|---|
| Frontend | http://localhost:5173 |
| API Gateway | http://localhost:4000 |
| Auth / Product / Order / Payment / Notification | 4001–4005 |

All client traffic goes through the gateway on **4000**. Hitting a service port directly works but bypasses gateway rate limiting and CORS — test through 4000 unless you are specifically isolating a service.

### Test credentials

| Role | Email | Password |
|---|---|---|
| Customer | `customer@example.com` | your `SEED_CUSTOMER_PASSWORD` |
| Admin | `admin@example.com` | your `SEED_ADMIN_PASSWORD` |

---

## 2. Automated tests

```bash
npm test
```

102 tests across four workspaces using Node's built-in runner. **No MongoDB, Redis, or running services required** — these are unit and contract tests over pure logic, so they can run first as a fast sanity gate.

| Workspace | Tests | Covers |
|---|---|---|
| `shared` | 62 | Error normalisation, webhook signatures, status transitions, money arithmetic, pagination, cache-aside, auth middleware |
| `product-service` | 17 | Product and query validation, injection resistance, price/stock bounds |
| `order-service` | 16 | Cart and checkout validation, empty-cart and flagged-line guards |
| `payment-service` | 7 | Signature forgery resistance, tamper detection, amount mismatch, idempotency |

Run one workspace alone:

```bash
npm test --workspace shared
```

Everything below this section is manual verification against the running stack — the flows that automated tests deliberately don't cover.

---

## 3. Health check

```bash
curl http://localhost:4000/health/services
```

One call reports all five services through the gateway. Expect every entry `ok` before testing further.

To confirm the gateway isolates outages: stop one service (Ctrl-C its pane), re-run the call, and check it reports that service unhealthy **quickly** rather than hanging. Restart it before continuing.

---

## 4. Customer flow — browser

Open http://localhost:5173.

### 4.1 Register & login

| Step | Expected |
|---|---|
| Register with a weak password (`abc`) | Inline validation: min 8 chars, needs lowercase, uppercase, number |
| Register with an already-used email | Clear error, no duplicate created |
| Register with valid details | Signed in, redirected to product list |
| Log out, log in again | Session restored, header shows your name |
| Refresh the page while logged in | Still signed in — token persisted |
| Visit `/orders` while logged out | Redirected to login, then **back to `/orders`** after signing in |

That last row is the one worth checking carefully — the original destination is preserved through the login redirect.

### 4.2 Product listing

| Step | Expected |
|---|---|
| Load the list | Products with image, name, price, stock, category |
| Type in search | Debounced — one request after you stop typing, not one per keystroke |
| Search gibberish (`zzzzz`) | Empty state, not an error |
| Filter by category | List narrows; filter reflected in the URL |
| Paginate | Page changes; refreshing keeps the page |
| Sort by price | Order changes accordingly |
| Throttle network in DevTools | Loading state appears |
| Stop the Product Service, reload | Error state with a retry affordance — not a blank page |

### 4.3 Product details & cart

| Step | Expected |
|---|---|
| Open a product | Images, description, price, live stock, quantity selector |
| Open a zero-stock product (two are seeded) | Add-to-cart disabled, out-of-stock messaging |
| Try quantity above stock | Clamped to available stock |
| Add to cart | Cart badge in the header increments |
| Open the cart | Line items, per-line subtotal, order total |
| Increase / decrease quantity | Totals recalculate |
| Decrease to zero | Line removed |
| Remove an item | Removed; totals update |
| Empty the cart | Empty state with a link back to products |
| Add an item, log out, log back in | Cart still there — it is server-side, not `localStorage` |

### 4.4 Checkout

| Step | Expected |
|---|---|
| Proceed to checkout | Customer info, delivery address, order summary, total |
| Submit with blank fields | Per-field validation errors |
| Enter a bad email or a 3-digit phone | Field-level errors |
| Submit valid details | Order created with status `Pending` / payment `Pending` |

Continue into [§6](#6-payment-flow) for payment.

---

## 5. Customer flow — API

The same journey with `curl`, useful for verifying the backend independently of the UI. Each step feeds the next.

**Register / login:**

```bash
curl -s -X POST http://localhost:4000/api/auth/register \
  -H 'Content-Type: application/json' \
  -d '{"name":"Test User","email":"test@example.com","password":"Passw0rd!"}'

TOKEN=$(curl -s -X POST http://localhost:4000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"customer@example.com","password":"<SEED_CUSTOMER_PASSWORD>"}' \
  | node -pe "JSON.parse(require('fs').readFileSync(0)).token")

curl -s http://localhost:4000/api/users/me -H "Authorization: Bearer $TOKEN"
```

**Browse:**

```bash
curl -s "http://localhost:4000/api/products?page=1&limit=5"
curl -s "http://localhost:4000/api/products?search=head&sort=price_asc"
curl -s http://localhost:4000/api/categories

PRODUCT_ID=$(curl -s "http://localhost:4000/api/products?limit=1" \
  | node -pe "JSON.parse(require('fs').readFileSync(0)).items[0]._id")

curl -s http://localhost:4000/api/products/$PRODUCT_ID
```

**Cart:**

```bash
curl -s -X POST http://localhost:4000/api/cart \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d "{\"productId\":\"$PRODUCT_ID\",\"quantity\":2}"

curl -s http://localhost:4000/api/cart -H "Authorization: Bearer $TOKEN"

# change quantity
curl -s -X PATCH http://localhost:4000/api/cart/$PRODUCT_ID \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"quantity":3}'

# remove
curl -s -X DELETE http://localhost:4000/api/cart/$PRODUCT_ID \
  -H "Authorization: Bearer $TOKEN"
```

**Checkout** — note there is no `totalAmount` field. The total is computed server-side from live prices; a client cannot propose what it will pay.

```bash
ORDER_ID=$(curl -s -X POST http://localhost:4000/api/orders \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{
    "customerInfo": {"name":"Test User","email":"test@example.com","phone":"9876543210"},
    "deliveryAddress": {"line1":"12 Example Street","city":"Chennai","state":"Tamil Nadu","postalCode":"600001","country":"India"}
  }' | node -pe "JSON.parse(require('fs').readFileSync(0)).order._id")

curl -s http://localhost:4000/api/orders -H "Authorization: Bearer $TOKEN"
curl -s http://localhost:4000/api/orders/$ORDER_ID -H "Authorization: Bearer $TOKEN"
```

---

## 6. Payment flow

The flow the brief specifies:

```
Checkout → Create Order → Create Payment → Gateway →
Payment Success → Webhook → Update Order → Queue Notification → Send Notification
```

**The frontend success callback is advisory.** An order is marked paid only after the gateway's webhook arrives and its HMAC signature is independently verified server-side. Testing must confirm that, not just that the UI shows success.

### 6.1 Create the payment

```bash
curl -s -X POST http://localhost:4000/api/payments/create \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d "{\"orderId\":\"$ORDER_ID\"}"
```

Returns the gateway order id used to sign the webhook.

### 6.2 Settle without a Razorpay account (mock gateway)

Available when no real Razorpay credentials are configured, `NODE_ENV != production`, and with an **admin** token. It builds a webhook signed with the real webhook secret and feeds it through the real handler — signature verification, idempotency, and the order update are all genuinely exercised, nothing is bypassed.

```bash
ADMIN=$(curl -s -X POST http://localhost:4000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@example.com","password":"<SEED_ADMIN_PASSWORD>"}' \
  | node -pe "JSON.parse(require('fs').readFileSync(0)).token")

curl -s -X POST http://localhost:4000/api/payments/mock/settle \
  -H "Authorization: Bearer $ADMIN" -H 'Content-Type: application/json' \
  -d "{\"orderId\":\"$ORDER_ID\",\"outcome\":\"captured\"}"
```

Then confirm the order flipped:

```bash
curl -s http://localhost:4000/api/orders/$ORDER_ID -H "Authorization: Bearer $TOKEN"
# → status "Confirmed", paymentStatus "Paid"
```

Use `"outcome":"failed"` to exercise the failure path — the order must stay unpaid and remain retryable from **My orders**.

### 6.3 Live Razorpay with a tunnel

Razorpay cannot reach `localhost`. Tunnel the **API gateway** (4000), not the Payment Service — so the request follows the same path real traffic does, proving the raw body survives proxying:

```bash
ngrok http 4000
```

Dashboard → Settings → Webhooks → Add New Webhook:

| Field | Value |
|---|---|
| URL | `https://<your-id>.ngrok-free.app/api/payments/webhook` |
| Secret | a strong random string — same value in `RAZORPAY_WEBHOOK_SECRET` |
| Events | `payment.captured`, `payment.failed` |

The webhook secret is **separate** from the API key secret. Restart the Payment Service after editing `.env`.

Test instruments:

| Method | Details |
|---|---|
| Card | `4111 1111 1111 1111`, any future expiry, any CVV |
| UPI | `success@razorpay` / `failure@razorpay` |
| Netbanking | Any bank, then choose Success or Failure |

In the browser: add to cart → checkout → Pay → complete the modal. The confirmation page shows **"Confirming your payment…"** while polling, then flips to Paid once the webhook is verified. Polling is bounded at ~30s; if it stops, the order is safe and payment can be retried.

### 6.4 Signature verification — the security tests

These are the tests that prove webhook verification is real. Sign a webhook yourself:

```bash
SECRET="<your RAZORPAY_WEBHOOK_SECRET>"
GW="<gatewayOrderId from POST /api/payments/create>"

BODY=$(node -pe "JSON.stringify({event:'payment.captured',payload:{payment:{entity:{id:'pay_test_1',order_id:'$GW',amount:459900,currency:'INR'}}}})")
SIG=$(node -pe "require('crypto').createHmac('sha256','$SECRET').update(process.argv[1]).digest('hex')" "$BODY")

curl -s -X POST http://localhost:4000/api/payments/webhook \
  -H 'Content-Type: application/json' \
  -H "x-razorpay-signature: $SIG" \
  -d "$BODY"
```

| Test | Command change | Expected |
|---|---|---|
| Valid signature | as above | `200`, order becomes Paid |
| **Replay** | send the identical request twice | `"duplicate": true`, nothing changes |
| **Tampered body** | alter any byte of `BODY`, keep `SIG` | `400` |
| **Forged signature** | replace `SIG` with junk | `400` |
| **Missing signature** | drop the `x-razorpay-signature` header | `400 VALIDATION_ERROR` — not 404 or 502 |
| **Wrong secret** | sign with a different secret | `400` |

The replay and tamper cases are the two that matter most: they demonstrate idempotency and that the raw request bytes are verified rather than a re-serialised body.

---

## 7. Admin flows

Log in as `admin@example.com`. Admin navigation appears only for admins — but **hiding a control is not a control**; every admin endpoint independently enforces the role, and §11 tests that.

### 7.1 Products

| Step | Expected |
|---|---|
| Open Admin → Products | Paginated list of all products |
| Create a product | Appears in the catalogue immediately (cache invalidated) |
| Submit with a negative price or non-integer stock | Validation errors |
| Edit a product | Changes reflected on the public listing |
| Update stock to `0` | Product shows out-of-stock on the storefront |
| Delete a product | Removed from listing |

API equivalents — note **`price` is in minor units** (₹4,599.00 → `459900`):

```bash
CATEGORY_ID=$(curl -s http://localhost:4000/api/categories \
  | node -pe "JSON.parse(require('fs').readFileSync(0)).categories[0]._id")

# create
curl -s -X POST http://localhost:4000/api/products \
  -H "Authorization: Bearer $ADMIN" -H 'Content-Type: application/json' \
  -d "{\"name\":\"Test Product\",\"description\":\"Created during testing\",\"price\":459900,\"stock\":10,\"category\":\"$CATEGORY_ID\"}"

# stock only
curl -s -X PATCH http://localhost:4000/api/products/$PRODUCT_ID/stock \
  -H "Authorization: Bearer $ADMIN" -H 'Content-Type: application/json' \
  -d '{"stock":0}'

curl -s http://localhost:4000/api/products/admin/all -H "Authorization: Bearer $ADMIN"
curl -s -X DELETE http://localhost:4000/api/products/<id> -H "Authorization: Bearer $ADMIN"
```

### 7.2 Orders

Admin → Orders shows order id, customer, products, amount, payment status, order status, created date.

Advance a paid order through the lifecycle and confirm each step:

```
Pending → Confirmed → Processing → Shipped → Delivered
```

```bash
curl -s -X PATCH http://localhost:4000/api/orders/$ORDER_ID/status \
  -H "Authorization: Bearer $ADMIN" -H 'Content-Type: application/json' \
  -d '{"status":"Processing"}'
```

| Test | Expected |
|---|---|
| Advance one stage at a time | Accepted; customer sees the new status and receives a notification |
| **Skip a stage** (Confirmed → Shipped) | Rejected |
| **Move backwards** (Shipped → Processing) | Rejected |
| **Change a Delivered order** | Rejected — `Delivered` is terminal |
| Filter by status | `?status=Shipped` narrows the list |

---

## 8. Background jobs & queue

Jobs run through BullMQ on Redis, processed by the notification worker. Queue endpoints are admin-only.

```bash
curl -s http://localhost:4000/api/notifications/queue/status -H "Authorization: Bearer $ADMIN"
```

Reports waiting / active / completed / failed / delayed counts.

**Observing a job end to end:** watch the worker pane in the `npm run dev` output, then place an order. You should see the job enqueued and processed within a second or two, with completed count incrementing.

Inspect one job:

```bash
curl -s http://localhost:4000/api/notifications/queue/jobs/<jobId> -H "Authorization: Bearer $ADMIN"
```

Returns state, attempts made, and failure reason if any.

| Mechanic | How to observe |
|---|---|
| **Queue + job creation** | Place an order → counts move |
| **Worker processing** | Worker pane logs the job; completed count rises |
| **Retry** | Stop the Notification Service, place an order — the job retries with backoff (`QUEUE_ATTEMPTS`, `QUEUE_BACKOFF_DELAY_MS`) |
| **Failed jobs** | Leave it down past all attempts — the job lands in `failed`, visible in queue status |
| **Recovery** | Restart the service; new jobs process normally |
| **Job status** | The `/queue/jobs/:jobId` call above |
| **Delayed jobs** | Status-change notifications scheduled with a delay show in the `delayed` count |
| **Concurrency** | `QUEUE_CONCURRENCY` (default 5) — place several orders quickly and watch parallel processing |

The retry test is the most informative one: it demonstrates that a downstream outage degrades gracefully rather than losing the notification.

---

## 9. Push notifications

Notifications are delivered in-app and, if VAPID keys are configured, as browser push.

**In-app** (no setup needed):

```bash
curl -s http://localhost:4000/api/notifications -H "Authorization: Bearer $TOKEN"

curl -s -X PATCH http://localhost:4000/api/notifications/<id>/read \
  -H "Authorization: Bearer $TOKEN"
```

**Browser push** — generate keys, put them in `.env` (`VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VITE_VAPID_PUBLIC_KEY`), restart:

```bash
npx web-push generate-vapid-keys
curl -s http://localhost:4000/api/notifications/vapid-key   # → enabled: true
```

Then enable notifications in the app, accept the browser permission prompt, and trigger events.

#### Three preconditions, all mandatory

Real push (an OS-level notification that arrives with the tab closed) is not the in-app list. It fails silently if any of these is unmet — `autoEnablePush()` deliberately swallows errors so a declined prompt never disturbs the session.

1. **A secure context.** Browsers expose service workers and `PushManager` only over HTTPS; `localhost` is the sole exception. Plain `http://192.168.x.x:5173` from another device will **not** work — [`push.js`](../frontend/src/services/push.js) rejects it before subscribing.
2. **A browser that supports Web Push.** Chrome, Edge, Firefox, Opera, Samsung Internet (desktop and Android); Safari 16.4+ on macOS; Safari 16.4+ on iOS **only after Add to Home Screen**. Internet Explorer has no service worker and no `PushManager` — it can never receive push.
3. **A reachable API over that same origin.** Subscribing calls `GET /api/notifications/vapid-key` first. If that request fails, no subscription is created and every notification is recorded in-app only.

#### Cross-device testing

To test customer and admin on separate devices, expose the frontend over HTTPS — a VS Code dev tunnel on port 5173 (set visibility **Public**), `npx cloudflared tunnel --url http://localhost:5173`, or ngrok.

Point the frontend at its own origin so API calls ride the same tunnel, avoiding both mixed content and CORS. In `frontend/.env.local` (gitignored):

```
VITE_API_BASE_URL=
```

An empty base makes the client use relative `/api/...` paths, which Vite's dev proxy forwards to the gateway. **Restart Vite** — env values are inlined at startup and are not hot-reloaded.

If you instead tunnel the gateway separately and set an absolute `VITE_API_BASE_URL`, add that origin to `CORS_ORIGINS` in `.env` and restart the services.

#### Verify the subscription exists

Permission alone proves nothing — confirm a subscription actually reached the server:

```js
// DevTools console, on the customer device
window.isSecureContext                                   // must be true
await (await navigator.serviceWorker.getRegistration('/')).pushManager.getSubscription()
```

The second call must return an object with an `fcm.googleapis.com` (or Mozilla) endpoint. Then confirm server-side:

```bash
mongosh "$MONGODB_URI" --eval 'db.pushsubscriptions.find({expiredAt:null},{userId:1,endpoint:1})'
```

On delivery the notification-service log distinguishes the two outcomes precisely:

- `notification delivered` with `delivered: 1` — real push sent
- `notification recorded in-app only` — no subscription, or VAPID unset

The **/notifications** page reports the same state in the UI, showing `unsupported` / `denied` / not-subscribed (with an **Enable notifications** retry button) / nothing when working.

Events that should produce a notification:

| Event | Trigger |
|---|---|
| Order placed | Complete checkout |
| Payment successful | Settle the payment (§6) |
| Order confirmed | Admin sets Confirmed |
| Order shipped | Admin sets Shipped |
| Order delivered | Admin sets Delivered |

Check that notifications are **scoped to the recipient** — log in as a different customer and confirm you cannot see another user's notifications.

---

## 10. Redis caching

Product and category reads use cache-aside: `request → Redis → hit? return : Mongo → write Redis → return`.

**Verify a cache hit** — call the same endpoint twice and compare timing:

```bash
time curl -s "http://localhost:4000/api/products?page=1" > /dev/null   # miss
time curl -s "http://localhost:4000/api/products?page=1" > /dev/null   # hit — faster
```

**Verify invalidation** — the important test, since a stale cache after a write is the classic bug:

1. `GET /api/products` and note a product's price.
2. As admin, update that product's price.
3. `GET /api/products` again → the **new** price appears immediately, not after `CACHE_TTL_SECONDS`.

**Verify keys directly:**

```bash
redis-cli KEYS '*'
redis-cli --scan --pattern 'product*'
```

You should see both cache keys and BullMQ queue keys — the two required Redis use cases side by side.

**Verify graceful degradation:** stop Redis and reload the product list. Reads should still work by falling through to MongoDB. Restart Redis afterwards.

---

## 11. Security & error handling

Run these with a **customer** token (`$TOKEN`) and an **admin** token (`$ADMIN`).

### Authentication

| Test | Command | Expected |
|---|---|---|
| No token on a protected route | `curl -i http://localhost:4000/api/cart` | `401` |
| Malformed token | `-H "Authorization: Bearer junk"` | `401` |
| Tampered token payload | edit a character of a real token | `401` — signature check fails |
| Valid token | `-H "Authorization: Bearer $TOKEN"` | `200` |

### Authorization

| Test | Command | Expected |
|---|---|---|
| Customer hits admin products | `curl -i -X POST .../api/products -H "Authorization: Bearer $TOKEN" ...` | **`403`, not `401`** |
| Customer lists all orders | `curl -i .../api/orders/admin -H "Authorization: Bearer $TOKEN"` | `403` |
| Customer reads queue status | `curl -i .../api/notifications/queue/status -H "Authorization: Bearer $TOKEN"` | `403` |
| Customer reads another user's order | `GET /api/orders/<other id>` | `403` or `404` — never the order |

The `401` vs `403` distinction matters: it confirms the request authenticated fine and was rejected on *role*, not on a missing token.

### Privilege escalation

```bash
# role in the body must be discarded, not honoured
curl -s -X POST http://localhost:4000/api/auth/register \
  -H 'Content-Type: application/json' \
  -d '{"name":"Sneaky","email":"sneaky@example.com","password":"Passw0rd!","role":"ADMIN"}'
```

Then log in as that user and confirm the token's role is `CUSTOMER` and admin routes return `403`.

### Input validation

| Test | Payload | Expected |
|---|---|---|
| NoSQL operator injection | `?search={"$ne":null}` | Treated as a string, `400` or empty result — never an operator |
| Malformed ObjectId | `/api/products/notanid` | `400 VALIDATION_ERROR`, not a driver crash |
| Out-of-range pagination | `?page=abc&limit=5000` | Coerced and bounded, not an unbounded read |
| Negative price | `{"price":-100}` | `400` |
| Oversized field | 3000-char description | `400` |
| Empty-cart checkout | `POST /api/orders` with empty cart | `400` with a clear message |

### Rate limiting

Login is limited more tightly than general traffic (`AUTH_RATE_LIMIT_MAX`, default 10):

```bash
for i in $(seq 1 15); do
  curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:4000/api/auth/login \
    -H 'Content-Type: application/json' \
    -d '{"email":"customer@example.com","password":"wrong"}'
done
```

Expect `401`s followed by `429`s. Wait out the window before continuing other tests, or restart the gateway.

### CORS

```bash
curl -i -X OPTIONS http://localhost:4000/api/products \
  -H "Origin: http://evil.example.com" \
  -H "Access-Control-Request-Method: GET"
```

The disallowed origin must not be reflected in `Access-Control-Allow-Origin`. `http://localhost:5173` (from `CORS_ORIGINS`) must be.

### Secrets

```bash
git ls-files | xargs grep -lE "rzp_live|RAZORPAY_KEY_SECRET=[^\s]" 2>/dev/null
git check-ignore .env    # → .env  (confirms it is ignored)
```

`.env` must never be tracked. Confirm `VITE_`-prefixed variables contain no secrets — they are embedded in the client bundle and are public by definition.

### Error handling

| Test | Expected |
|---|---|
| Unknown route (`/api/nope`) | `404` in the standard error shape |
| Stop a service, call its route | Clear gateway error, fast — not a hang |
| Any error response | Consistent JSON envelope, no stack traces or internal paths leaked |

---

## 12. UI states

Every page must handle all six states. Sweep them at three viewport widths — **mobile 375px, tablet 768px, desktop 1280px**.

| State | How to trigger |
|---|---|
| **Loading** | Throttle the network in DevTools |
| **Empty** | Search for gibberish; empty the cart; a new account's order list |
| **Error** | Stop the relevant service and reload |
| **Success** | Complete a checkout |
| **Form validation** | Submit blank or invalid forms |
| **API failure** | Stop the gateway mid-action |

Accessibility spot-checks:

- Tab through each page — focus order is logical and focus is always visible.
- Forms are operable by keyboard alone; errors are associated with their fields.
- Interactive controls have accessible names.
- No horizontal scrolling at 375px.

---

## 13. Full acceptance checklist

A single pass covering the brief end to end:

- [ ] `npm test` — 112 tests pass
- [ ] `npm run seed` and `npm run dev` start cleanly
- [ ] `/health/services` reports all five services ok
- [ ] Register, login, logout, session persists across refresh
- [ ] Product listing: search, category filter, pagination, sort
- [ ] Loading / empty / error states on the listing
- [ ] Product details with quantity selector and stock limit
- [ ] Out-of-stock product cannot be added
- [ ] Cart: add, remove, increase, decrease, subtotal, total
- [ ] Cart survives logout and login (server-side)
- [ ] Checkout captures customer info, address, summary, total
- [ ] Checkout validation rejects bad input
- [ ] Order created as Pending / Pending
- [ ] Payment created against the order
- [ ] Webhook with a valid signature marks the order Paid
- [ ] Replayed webhook is idempotent (`duplicate: true`)
- [ ] Tampered / forged / unsigned webhooks return `400`
- [ ] Payment failure path leaves the order retryable
- [ ] Notification queued and processed by the worker
- [ ] Retry and failed-job behaviour observed with the service down
- [ ] Delayed jobs visible in queue status
- [ ] Notifications received for placed / paid / confirmed / shipped / delivered
- [ ] Notifications are scoped to the recipient — another customer cannot see them
- [ ] Real browser push verified over HTTPS: subscription row exists and the log reads `notification delivered`
- [ ] Push arrives on a second device with the tab closed
- [ ] Push status states render on **/notifications**: unsupported, denied, not-subscribed with a working **Enable notifications** button
- [ ] Admin can create, edit, delete a product and update stock
- [ ] Admin sees all orders with full detail
- [ ] Status advances Pending → Confirmed → Processing → Shipped → Delivered
- [ ] Skipping stages, moving backwards, and editing Delivered are rejected
- [ ] Cache hit observed; invalidation confirmed after an admin write
- [ ] Redis holds both cache keys and BullMQ keys
- [ ] `401` for missing/invalid token; `403` for wrong role
- [ ] `role` in a registration body is discarded
- [ ] Injection, malformed ids, and out-of-range pagination rejected
- [ ] Rate limiting returns `429` on repeated login attempts
- [ ] CORS rejects a disallowed origin
- [ ] No secrets tracked in Git; `.env` ignored
- [ ] Responsive at 375 / 768 / 1280px

---

## 14. Troubleshooting

| Symptom | Cause / fix |
|---|---|
| Service exits on startup | A required env var is missing — services fail fast with the variable named. Check `.env` against `.env.example`. |
| `ECONNREFUSED` on 27017 / 6379 | MongoDB or Redis is not running. |
| Login always `401` | Seed not run, or `SEED_*_PASSWORD` in `.env` differs from what you are typing. Re-run `npm run seed`. |
| Login returns `429` | Rate limit hit from earlier testing. Wait out `RATE_LIMIT_WINDOW_MS` or restart the gateway. |
| Frontend loads, API calls fail | Gateway not running, or `VITE_API_BASE_URL` doesn't point at `http://localhost:4000`. On a tunnel it should be empty instead — see §9. |
| CORS error in the browser console | `http://localhost:5173` missing from `CORS_ORIGINS`. |
| Webhook `400` with a valid-looking signature | A body parser ran before the raw-body parser. The route must receive unmodified bytes — the gateway registers no body parser for exactly this reason. |
| Order stays Pending after paying | The webhook never arrived. Check the tunnel is running and the dashboard URL matches its current address — ngrok free URLs change on restart. |
| `Payment gateway is unavailable` | Wrong or missing `RAZORPAY_KEY_SECRET`. |
| `Mock settlement is unavailable` | Real Razorpay credentials are configured — use the real flow, or clear them to fall back to the mock gateway. |
| Confirmation page polls then stops | Bounded at ~30s. The order is safe; retry payment from **My orders**. |
| Notifications never arrive at all | Worker not running (check the `npm run dev` panes), Redis down, or VAPID keys unset for browser push. |
| Notification appears in the list but no system notification | No push subscription exists for that user — the log says `notification recorded in-app only`. Work through the three preconditions in §9: secure context, a supporting browser, and a reachable API. |
| No permission prompt on a second device | Page not served over HTTPS (`window.isSecureContext` is `false`), or the browser has no push support. See §9. |
| Push works on the laptop but not the phone | Usually Internet Explorer or another browser without service workers — use Chrome, Firefox, or Samsung Internet on Android. On iOS, Safari 16.4+ requires Add to Home Screen first. |
| Push silently stops after being enabled | The subscription expired; the service marks it `expiredAt` on a 404/410 from the push service. Re-enable from **/notifications**. |
| API calls fail only on the tunnel URL | `VITE_API_BASE_URL` still points at `http://localhost:4000`, which resolves to the *remote device*, and an HTTPS page cannot call HTTP. Set it empty in `frontend/.env.local` and restart Vite (§9). |
| Stale product data after an admin edit | Cache invalidation issue — verify with `redis-cli KEYS 'product*'`. |

---

## Related documentation

| Document | Contents |
|---|---|
| [`README.md`](../README.md) | Setup, architecture, API reference, payment sandbox |
| [`docs/user-stories/`](user-stories/) | 48 user stories, 230 acceptance criteria, traceability matrix |
| [`docs/erd.md`](erd.md) | Data model and relationships |
