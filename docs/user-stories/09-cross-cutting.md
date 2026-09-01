# 09 — Cross-Cutting: Backend, Architecture, Security, UI States

**Source:** `Full-Stack MERN.docx` §3 (Backend), §4 (MongoDB), §5 (Microservice Architecture), §6 (Redis), §10 (UI/UX), §11 (Security)
**Owning services:** all
**Actors:** SYSTEM, CUSTOMER

These requirements have no single screen. They are written as `SYSTEM` stories because they trace to explicit docx lines that would otherwise have no home, and because they are the requirements most easily left half-done.

---

### US-SYS-1: Centralized error handling with correct status codes

**Traces to:** docx §3 — "Centralized error handling, Proper HTTP status codes"

**User Story**
As a SYSTEM
I want every error to pass through one handler producing a consistent shape
So that clients can rely on one error contract and internals never leak

**Acceptance Criteria**
- **AC1** — Given any route throws, When the response is produced, Then it comes from the centralized error middleware, not from an ad-hoc `try/catch` in the controller.
- **AC2** — Given an error response, When it is inspected, Then it has one consistent shape (message, and where relevant a code and field-level details).
- **AC3** — Given an unexpected server error, When it is returned to the client, Then no stack trace, file path, or database detail is included.
- **AC4** — Given an unexpected server error, When it is handled, Then the full error including the stack is logged server-side.
- **AC5** — Given the various failure classes, When each occurs, Then the status code is correct: `400` validation, `401` unauthenticated, `403` unauthorised, `404` not found, `409` conflict, `429` rate limited, `500` unexpected.

**Edge Cases**
- Async errors in route handlers → captured and forwarded to the handler rather than becoming unhandled rejections.
- Mongoose cast errors from malformed ids → translated to `400`/`404`, not `500`.
- Duplicate-key errors from unique indexes → translated to `409` (this is what US-AUTH-1's simultaneous-registration edge case depends on).
- Errors thrown inside the error handler itself → fall back to a bare `500` rather than crashing the process.
- Errors in BullMQ workers → handled by the worker's own error path (US-NOTIF-3), not this middleware.

**Technical Considerations**
- One error-handling middleware registered last in each service, plus a shared `AppError` class carrying a status code.
- The shape is shared across all five services, so the frontend has one error contract regardless of which service answered.
- Stack traces are included in development only, gated on `NODE_ENV` — AC3 applies to production.
- The frontend's shared fetch layer maps this shape into the error states used across the UI (US-PROD-5, US-SYS-8).

**Design Notes**
- Users see human-readable messages; the technical detail goes to the logs. This is the boundary AC3 and AC4 draw together.

---

### US-SYS-2: Validate every request

**Traces to:** docx §3 — "Request validation"; §11 — "Input validation"

**User Story**
As a SYSTEM
I want every incoming request body, param, and query validated before it reaches business logic
So that malformed or hostile input cannot reach the database

**Acceptance Criteria**
- **AC1** — Given a request with an invalid body, When it arrives, Then validation rejects it with `400` and per-field detail before the controller runs.
- **AC2** — Given a request with unexpected extra fields, When it is validated, Then those fields are stripped rather than passed through.
- **AC3** — Given a request with a malformed id parameter, When it is validated, Then it is rejected before any database query.
- **AC4** — Given query parameters like `page`, `limit`, and `search`, When they arrive, Then they are coerced, bounded, and type-checked.
- **AC5** — Given validation fails, When the response is built, Then it uses the shared error shape from US-SYS-1.

**Edge Cases**
- Field-stripping (AC2) is what prevents privilege escalation via a `role` field in the registration body (US-AUTH-1) and price tampering at checkout (US-PAY-1).
- Objects containing Mongo operators (`$ne`, `$gt`) submitted where a string is expected → rejected by type validation, closing off NoSQL operator injection.
- Deeply nested or very large payloads → rejected by a body size limit before parsing.
- Unicode and emoji in text fields → accepted; validation constrains length and type, not alphabet.

**Technical Considerations**
- A schema validation library applied as middleware per route, with schemas kept beside their routes.
- The same middleware serves all five services, so validation cannot be strong in one and absent in another.
- Validation is the outermost guard; it does not replace the authorization checks (US-AUTH-6) or the stock and ownership checks in the order and payment flows.
- Body size limits are configured on the JSON parser — except on the webhook route, which needs its raw body (US-PAY-4).

**Design Notes**
- Field-level errors map onto the frontend's inline form validation, which is what makes the per-field detail in AC1 worth returning at all.

---

### US-SYS-3: Structured logging

**Traces to:** docx §3 — "Logging"

**User Story**
As a SYSTEM
I want requests, errors, and significant events logged in a structured form
So that behaviour can be traced and demonstrated

**Acceptance Criteria**
- **AC1** — Given any request, When it completes, Then method, path, status, and duration are logged.
- **AC2** — Given an error occurs, When it is handled, Then it is logged with its stack and context.
- **AC3** — Given a log line is written, When it is inspected, Then it contains no password, token, or gateway secret.
- **AC4** — Given significant events occur (payment verified, order status changed, job completed or failed, cache hit or miss), When they happen, Then each is logged.
- **AC5** — Given different environments, When log level is configured, Then it is set by environment variable rather than hard-coded.

**Edge Cases**
- Request bodies containing passwords or card data → redacted by a field allowlist, never logged wholesale. AC3 is the requirement most easily violated by a well-meaning `console.log(req.body)`.
- Very large bodies → truncated in logs.
- High-volume debug logs in production → controlled by AC5's level configuration.
- Webhook payloads → logged with the event id and outcome, not the full signed body.

**Technical Considerations**
- A structured logger (Pino or Winston) rather than `console.log`, so output is machine-parseable.
- Redaction is configured centrally on the logger, so a new call site cannot accidentally leak a secret.
- The event logging in AC4 is what makes the Redis caching (US-PROD-6) and BullMQ mechanics (US-NOTIF-3, US-NOTIF-4) demonstrable during assessment review — the docx asks for these to be shown working, and logs are the evidence.

**Design Notes**
- No user-facing surface.

---

### US-SYS-4: Route all client traffic through an API gateway

**Traces to:** docx §5 — "React App → API Gateway → [Auth Service | Product Service | Order Service]"

**User Story**
As a SYSTEM
I want the frontend to talk to one gateway that routes to the services behind it
So that service boundaries exist without the client needing to know about them

**Acceptance Criteria**
- **AC1** — Given the frontend makes any API call, When it is sent, Then it goes to a single gateway origin, not directly to a service.
- **AC2** — Given a request arrives at the gateway, When it is routed, Then it reaches the correct service by path prefix (`/api/auth`, `/api/products`, `/api/orders`, `/api/payments`, `/api/notifications`).
- **AC3** — Given a downstream service is unavailable, When a request for it arrives, Then the gateway returns a clear error rather than hanging indefinitely.
- **AC4** — Given a request requires authentication, When it passes through, Then the token reaches the target service so it can enforce its own authorization.

**Edge Cases**
- A service being restarted → `502`/`503` with a clear message; other services keep serving, which is the point of the separation.
- A slow downstream service → bounded by a timeout so the gateway does not exhaust its own connections.
- Unknown path prefix → `404` from the gateway.
- The webhook route → must reach the Payment Service with its **raw body intact** (US-PAY-4); a gateway that re-serialises the body breaks signature verification. This is the subtlest failure mode in the whole system.

**Technical Considerations**
- A lightweight Express gateway using a proxy middleware, routing by path prefix.
- Services are addressed by environment-configured URLs, never hard-coded hosts.
- Each service still enforces its own authentication and authorization — the gateway routes, it does not become the sole security boundary. A request reaching a service directly must still be checked.
- The docx explicitly states large-scale infrastructure is not required; a simple proxy satisfies §5's intent of demonstrating service separation.
- CORS is configured at the gateway (US-SYS-7).

**Design Notes**
- Invisible to users. The frontend has one configured API base URL.

---

### US-SYS-5: Separate the backend into the five required services

**Traces to:** docx §5 — "Minimum Services: Auth Service, Product Service, Order Service, Payment Service, Notification Service"

**User Story**
As a SYSTEM
I want the backend split into five services by responsibility
So that the architecture demonstrates genuine service separation

**Acceptance Criteria**
- **AC1** — Given the repository, When the services are inspected, Then all five exist as separate applications with their own entry points and dependencies.
- **AC2** — Given each service, When its responsibilities are checked, Then they match the docx: Auth (registration, login, JWT, users), Product (products, categories, search, stock), Order (cart, orders, order status), Payment (creation, verification, webhook, status), Notification (push, order and payment notifications).
- **AC3** — Given services need to communicate, When they do, Then it is over defined interfaces — HTTP calls or the shared queue — not by reaching into another service's database collections.
- **AC4** — Given each service, When it starts, Then it reads its own configuration from environment variables and can run independently.

**Edge Cases**
- A service needing another's data (e.g. Order needing product prices) → an HTTP call to that service, not a direct collection read. This is the boundary that makes the separation real rather than cosmetic.
- One service down → the others continue; the failure is contained and surfaces as a clear error (US-SYS-4 AC3).
- Shared code (error shape, validation helpers, status enums) → kept in a shared module rather than copy-pasted, which is what stops the five services drifting apart.

**Technical Considerations**
- Structure follows the docx's suggested layout: `services/{auth,product,order,payment,notification}-service/` plus `workers/`.
- The Order Service reads product data from the Product Service; the Payment Service updates orders via the Order Service or the shared queue. Whichever pattern is chosen, it is applied consistently and documented in the README architecture section (docx §14).
- Each service has its own `.env`, with `.env.example` committed and real values never (docx §11, §14).
- Running all services in development is handled by a root-level `npm run dev` (docx §14 requires this to be documented).
- The docx allows a different architecture if justified; if a modular monolith with clear internal boundaries is chosen instead, that justification belongs in the README.

**Design Notes**
- The README architecture diagram (docx §14) reproduces the §5 diagram, showing the gateway, the five services, Redis/BullMQ, and MongoDB.

---

### US-SYS-6: Model the data with appropriate schemas and indexes

**Traces to:** docx §4 — "Suggested collections: users, products, categories, carts, orders, payments, notifications... The candidate should design appropriate schemas and indexes"

**User Story**
As a SYSTEM
I want well-designed schemas and indexes
So that queries stay fast and the data model holds its own invariants

**Acceptance Criteria**
- **AC1** — Given the database, When collections are inspected, Then all seven exist: `users`, `products`, `categories`, `carts`, `orders`, `payments`, `notifications`.
- **AC2** — Given the relationships in the docx, When they are inspected, Then a user has one cart and many orders, and an order has a payment.
- **AC3** — Given the query patterns used by the app, When indexes are inspected, Then each frequent query is index-backed.
- **AC4** — Given required fields, When an invalid document is written, Then schema validation rejects it.
- **AC5** — Given uniqueness constraints, When a duplicate is inserted, Then the unique index rejects it.

**Edge Cases**
- Unique index on `users.email` → the enforcement behind US-AUTH-1's simultaneous-registration case.
- Unique index on `carts.userId` → makes "one cart per user" a database invariant rather than an application convention.
- Unique index on `payments.gatewayPaymentId` → the backstop for webhook idempotency (US-PAY-4 AC5).
- Text index on `products.name` → what makes search (US-PROD-2) viable.
- Compound index on `orders.userId + createdAt` → serves both the customer's order list (US-PAY-5) and its sort in one index.

**Technical Considerations**
- Index summary: `users.email` (unique); `products.category`, `products.name` (text), `products.createdAt`; `categories.slug` (unique); `carts.userId` (unique); `orders.userId + createdAt`, `orders.orderStatus`; `payments.orderId`, `payments.gatewayPaymentId` (unique); `notifications.userId + createdAt`.
- The deliberate denormalisation split: `carts` store product references only (so prices stay live — US-CART-1), while `orders` store item snapshots (so history is immutable — US-PAY-1 AC5). These pull in opposite directions on purpose and the reasoning belongs in the README.
- Money is stored in integer minor units throughout, never as floats.
- Timestamps on every collection.

**Design Notes**
- No user-facing surface. The schema design is documented in the README (docx §14).

---

### US-SYS-7: Apply API security controls

**Traces to:** docx §11 — "Environment variables, Basic rate limiting, CORS configuration, Do not expose secrets in Git"; §3 — "API security, Environment variables"

**User Story**
As a SYSTEM
I want the standard API protections in place
So that the API is not trivially abusable and no secret ever reaches the repository

**Acceptance Criteria**
- **AC1** — Given repeated requests from one client to a sensitive route, When the threshold is exceeded, Then further requests get `429` with a retry hint.
- **AC2** — Given a browser request from an unapproved origin, When CORS is evaluated, Then it is refused; approved origins come from configuration, not a wildcard.
- **AC3** — Given the repository, When it is searched, Then it contains no JWT secret, gateway key, webhook secret, database URI, or VAPID key.
- **AC4** — Given the repository, When it is inspected, Then a `.env.example` documents every required variable with placeholder values only.
- **AC5** — Given a required environment variable is missing, When a service starts, Then it fails fast with a clear message rather than starting in a broken state.
- **AC6** — Given any HTTP response, When headers are inspected, Then standard security headers are present.

**Edge Cases**
- Rate limiting the webhook route → tuned so legitimate gateway retries are not throttled (US-PAY-4).
- Rate limiting behind a proxy → configured to read the real client IP, or every client appears as one and the limiter is useless.
- A secret accidentally committed → `.gitignore` covers `.env` from the outset; if it ever happens, rotation is required, not just deletion, since git history retains it.
- CORS preflight (`OPTIONS`) → handled so legitimate cross-origin calls are not blocked.

**Technical Considerations**
- `express-rate-limit` on `/api/auth/*` and other sensitive routes (docx §11 asks for basic rate limiting, not a distributed limiter).
- `cors` configured with an explicit origin allowlist from environment configuration.
- `helmet` for AC6's security headers.
- All configuration read from environment variables at startup, with the AC5 validation making a misconfiguration loud instead of subtle.
- `.gitignore` already exists in this repository and must cover `.env` files before any secret is ever written.
- `.env.example` is required by docx §14 and the submission checklist.

**Design Notes**
- The `429` response surfaces as a specific user-facing message ("Too many attempts, please wait"), not a generic error — this is the one security control users actually encounter, in US-AUTH-2.

---

### US-SYS-8: Provide the six required UI states consistently

**Traces to:** docx §10 — "Required states: Loading, Error, Empty, Success, Form validation, API failure"; "Responsive, Mobile-friendly, Clean, Consistent, Accessible, Easy to navigate"

**User Story**
As a CUSTOMER
I want every screen to tell me clearly what is happening
So that I am never left looking at an ambiguous blank page

**Acceptance Criteria**
- **AC1** — Given any screen fetching data, When a request is in flight, Then a loading state renders.
- **AC2** — Given a list with no results, When it settles, Then an empty state renders with an action where one makes sense.
- **AC3** — Given a request fails, When it settles, Then an error state renders with a retry route.
- **AC4** — Given any form, When a field is invalid, Then inline per-field validation renders.
- **AC5** — Given an action succeeds, When it completes, Then success is confirmed visibly.
- **AC6** — Given the app is used at 320px width and upward, When any screen is viewed, Then it is usable with no horizontal scrolling.
- **AC7** — Given the app is navigated by keyboard only, When moving through any flow, Then every interactive element is reachable, operable, and shows a visible focus indicator.

**Edge Cases**
- A very fast response → a minimum display time or delayed appearance prevents a spinner flash (US-PROD-5).
- Simultaneous partial failures (e.g. products load but categories fail) → each region shows its own state; one failure does not blank the page (US-PROD-3).
- Long content, long names, many items → handled with truncation and wrapping so layouts hold.
- Zoom to 200% → the layout remains usable, since it uses relative units rather than fixed pixel widths.

**Technical Considerations**
- Loading, empty, and error states are built once as shared components in `frontend/src/components` and reused by every list screen — the listing, cart, orders, notifications, and both admin lists. This is what makes AC1–AC3 consistent rather than reimplemented six times.
- The `idle | loading | success | error` state machine from US-PROD-5 is provided by a shared hook in `frontend/src/hooks`.
- Form validation errors map from the field-level detail the API returns (US-SYS-2).
- Tailwind's mobile-first breakpoints throughout; layouts start at the smallest viewport rather than being retrofitted down.

**Design Notes**
- Consistency across screens is itself the requirement: the same skeleton treatment, the same empty-state composition, the same error and retry pattern everywhere.
- Accessibility baseline: semantic HTML, labelled form controls, `aria-live` for asynchronous changes, focus management on route change and dialog open/close, and status never conveyed by colour alone.
- The docx explicitly de-emphasises visual complexity, so effort goes into state coverage, responsiveness, and accessibility rather than decoration.

---

## Coverage

| docx requirement | Covered by |
|---|---|
| §3 Request validation | US-SYS-2 |
| §3 Authentication middleware | US-AUTH-5 (`01-auth.md`) |
| §3 Authorization middleware | US-AUTH-6 (`01-auth.md`) |
| §3 Centralized error handling | US-SYS-1 |
| §3 Proper HTTP status codes | US-SYS-1 AC5 |
| §3 Logging | US-SYS-3 |
| §3 Environment variables | US-SYS-7 AC3–AC5 |
| §3 API security | US-SYS-7 |
| §4 Seven collections, schemas, indexes | US-SYS-6 |
| §5 API Gateway | US-SYS-4 |
| §5 Five minimum services | US-SYS-5 |
| §6 Redis caching (use case 1) | US-PROD-6 (`02-product-listing.md`) |
| §6 Redis as BullMQ backend (use case 2) | US-NOTIF-1 (`06-notifications-jobs.md`) |
| §10 Loading / Error / Empty / Success / Form validation / API failure | US-SYS-8 |
| §10 Responsive, mobile-friendly, accessible | US-SYS-8 AC6, AC7 |
| §11 Password hashing | US-AUTH-1 AC5 |
| §11 JWT authentication | US-AUTH-2 |
| §11 Protected routes | US-AUTH-5 |
| §11 Role-based authorization | US-AUTH-6 |
| §11 Environment variables | US-SYS-7 |
| §11 Input validation | US-SYS-2 |
| §11 Payment signature verification | US-PAY-4 (`05-checkout-payment.md`) |
| §11 Basic rate limiting | US-SYS-7 AC1 |
| §11 CORS configuration | US-SYS-7 AC2 |
| §11 No secrets in Git | US-SYS-7 AC3, AC4 |
