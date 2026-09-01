# 01 — Authentication & Authorization

**Source:** `Full-Stack MERN.docx` §1 (Login / Register), §11 (Security Requirements)
**Owning service:** Auth Service
**Actors:** GUEST, CUSTOMER, ADMIN

---

### US-AUTH-1: Register a new account

**Traces to:** docx §1.1 — "Users should be able to: Register"

**User Story**
As a GUEST
I want to register with my name, email and password
So that I can have an account and place orders

**Acceptance Criteria**
- **AC1** — Given I am on the Register page with an unused email and a valid password, When I submit the form, Then my account is created with role `CUSTOMER`, I am authenticated, and I am redirected to the product listing.
- **AC2** — Given I submit the form with an email that is already registered, When the server responds, Then I see the message "An account with this email already exists" and remain on the Register page with my other input preserved.
- **AC3** — Given I submit the form with any field empty or malformed, When I submit, Then per-field validation errors render beneath the offending inputs and no request is sent.
- **AC4** — Given my registration succeeds, When I inspect the API response, Then the password is absent from the payload in any form.
- **AC5** — Given my account has just been created, When the record is read from MongoDB, Then the stored password is a bcrypt hash, never plaintext.

**Edge Cases**
- Email differing only by case or surrounding whitespace (` User@Ex.com `) → normalised to lowercase and trimmed before the uniqueness check, so it collides with an existing `user@ex.com`.
- Password below the minimum length → rejected client-side and re-validated server-side; the server never trusts the client's check.
- Two identical registrations submitted simultaneously → the unique index on `email` makes one fail; that duplicate-key error is translated to a `409`, not surfaced as a `500`.
- Double-click on Submit → the button disables on first submit, so only one account is created.
- Registration attempted while already logged in → redirected to the product listing instead of seeing the form.

**Technical Considerations**
- `POST /api/auth/register` on the Auth Service, routed through the API Gateway.
- Collection `users`: `{ name, email, passwordHash, role, createdAt, updatedAt }`. Unique index on `email`.
- Password hashed with bcrypt (cost factor 10–12). Hashing happens in the service layer, never in the controller.
- Request validation on the body before the controller runs; validation failure short-circuits to the centralized error handler.
- Role is assigned server-side as `CUSTOMER`. A `role` field arriving in the request body is stripped — it must never be honoured, or any visitor could self-promote to `ADMIN`.
- Status codes: `201` created, `400` validation failure, `409` email taken.
- Rate limiting applies to this route (docx §11).

**Design Notes**
- Single centred card, `max-w-md`, comfortable on a 320px viewport upward. Labels are visible above inputs, not placeholder-only.
- States required here: **form validation** (inline, per field), **loading** (submit button shows a spinner and is disabled), **error** (API failure banner at the top of the form), **success** (redirect).
- Every input has an associated `<label for>`. Errors are tied to their input via `aria-describedby` and the error region is `role="alert"` so screen readers announce it.
- The password field has a show/hide toggle that is a real `<button>` with an accessible name, reachable by keyboard.
- Submitting with Enter from any field works — the form uses a native `<form onSubmit>`, not a click handler on a `<div>`.

---

### US-AUTH-2: Log in to an existing account

**Traces to:** docx §1.1 — "Users should be able to: Login" / "Use JWT-based authentication"

**User Story**
As a CUSTOMER
I want to log in with my email and password
So that I can reach my cart and orders

**Acceptance Criteria**
- **AC1** — Given I enter credentials matching an existing account, When I submit, Then I am issued a JWT, my session becomes authenticated, and I land on the page I originally requested (or the product listing if there was none).
- **AC2** — Given I enter a wrong password, or an email with no account, When I submit, Then I see the single message "Invalid email or password" — the response never reveals which of the two was wrong.
- **AC3** — Given I log in as a user whose role is `ADMIN`, When authentication completes, Then the admin dashboard entry point is visible in the navigation.
- **AC4** — Given I log in as a `CUSTOMER`, When I look at the navigation, Then no admin entry point is shown.

**Edge Cases**
- Repeated failed attempts from one IP → rate limiter returns `429` with a retry hint; the UI shows that message rather than "Invalid email or password".
- Login submitted while already authenticated → redirected away from the form.
- Credentials correct but the account record is missing its `passwordHash` (corrupt data) → treated as an authentication failure, logged server-side as an anomaly, never a `500` leaking a stack trace.
- Clock skew between services → JWT verification allows a small leeway so a valid token is not rejected as expired.

**Technical Considerations**
- `POST /api/auth/login`. Compare with `bcrypt.compare` against the stored hash.
- The failure path must cost roughly the same whether the email exists or not, so response timing does not disclose account existence.
- JWT signed with `JWT_SECRET` from the environment, carrying `{ sub: userId, role }` and a finite expiry. The secret is never committed (docx §11).
- Where the token lives on the client is decided once and applied consistently across the app; whichever storage is chosen, the same mechanism is used by every authenticated request.
- Status codes: `200` success, `400` validation failure, `401` bad credentials, `429` rate limited.

**Design Notes**
- Mirrors the Register card so the pair feels like one system: same width, spacing, and button treatment.
- States: **form validation**, **loading**, **error**, **success**.
- The credential error appears once, above the form, in an `aria-live="polite"` region — not duplicated under both fields, which would imply the app knows which one was wrong.
- A link to Register sits below the form, and vice versa, so the two pages are reachable from each other without the browser back button.

---

### US-AUTH-3: Log out

**Traces to:** docx §1.1 — "Users should be able to: Logout"

**User Story**
As a CUSTOMER
I want to log out
So that my session cannot be used by someone else on this device

**Acceptance Criteria**
- **AC1** — Given I am authenticated, When I choose Logout, Then my credentials are cleared from the client and I am returned to the login page.
- **AC2** — Given I have logged out, When I navigate back to a protected page, Then I am sent to the login page rather than shown cached content.
- **AC3** — Given I have logged out, When I press the browser Back button, Then no authenticated view is restored from cache.

**Edge Cases**
- Logout pressed while a request is in flight → the in-flight response is discarded and does not repopulate authenticated state.
- Logout in one browser tab → the other tabs observe the change and drop their authenticated state rather than continuing to render a logged-in shell.
- Token already expired when Logout is pressed → the client still clears local state and completes the flow without error.

**Technical Considerations**
- Client-side clearing of the token plus any in-memory auth context. Cart and order data cached in the client are cleared with it, so the next user of the device sees nothing.
- No server round trip is strictly required for a stateless JWT; if a logout endpoint exists it is idempotent and returns `204`.
- The auth context is the single place that owns this teardown, so no screen needs its own copy of the logic.

**Design Notes**
- Logout lives in the header/account menu, present at every breakpoint — inside the mobile menu on small screens, not hidden behind a hover-only interaction.
- State: **success** (a brief confirmation, or the redirect itself as the confirmation).
- The control is a `<button>`, not a link, since it performs an action rather than navigating.

---

### US-AUTH-4: Stay signed in across a page reload

**Traces to:** docx §1.1 — "Maintain authenticated session"

**User Story**
As a CUSTOMER
I want my session to survive a page refresh
So that I am not asked to log in again while I shop

**Acceptance Criteria**
- **AC1** — Given I am logged in, When I refresh the page or reopen the tab before my token expires, Then I remain authenticated and stay on the same route.
- **AC2** — Given my token has expired, When I load the app, Then my stale session is cleared and I am shown the login page.
- **AC3** — Given the app is restoring my session on first paint, When restoration is still in progress, Then a loading state renders — the login page must not flash before the restored session resolves.

**Edge Cases**
- Stored token is malformed or truncated → treated as no session; cleared without throwing.
- Token valid but the underlying user has been deleted → the first authenticated request returns `401`, the client clears the session and redirects.
- Token expires mid-session while the tab is open → the next `401` from any request triggers the same clear-and-redirect path, handled centrally.

**Technical Considerations**
- Session restoration runs once at app startup in an auth provider; screens read from it rather than each reading storage.
- Expiry is checked before use so an obviously-dead token does not cause a pointless request.
- A single response interceptor maps `401` to "clear session and redirect", so this is not reimplemented per API call.
- Handled entirely client-side against the JWT — no server session store, consistent with stateless JWT auth.

**Design Notes**
- A full-page loading state (skeleton or spinner) covers the restoration window. This directly prevents the login-page flash called out in AC3.
- State: **loading**.
- Focus is not stolen during restoration; when the app resolves, focus lands sensibly at the top of the restored page.

---

### US-AUTH-5: Protected routes reject unauthenticated visitors

**Traces to:** docx §11 — "Protected routes"

**User Story**
As a GUEST
I want to be redirected to login when I open a page that needs an account
So that I understand why I cannot see it, and can return once signed in

**Acceptance Criteria**
- **AC1** — Given I am not authenticated, When I open the cart, checkout, orders, or any admin route, Then I am redirected to the login page.
- **AC2** — Given I was redirected from a protected route, When I log in successfully, Then I continue to the page I originally asked for, not to a generic landing page.
- **AC3** — Given I call a protected API without a token, When the server responds, Then it is `401` and no data is returned.
- **AC4** — Given I call a protected API with a token whose signature does not verify, When the server responds, Then it is `401`.

**Edge Cases**
- `Authorization` header present but malformed (missing the `Bearer ` prefix) → `401`, not `500`.
- Token signed with a different secret, e.g. from another environment → `401`.
- Deep link to a protected route with query parameters → the full path *and* query are preserved through the login round trip.
- Redirect target sanitised so it can only be an internal path — an absolute URL supplied by an attacker must not become an open redirect.

**Technical Considerations**
- Frontend: a route guard component wrapping protected routes, reading from the same auth context as US-AUTH-4.
- Backend: an authentication middleware that verifies the JWT and attaches the user to the request. Applied to `/api/cart`, `/api/orders`, `/api/payments`, `/api/users`, and all admin routes.
- Route protection is declared per route group rather than checked ad hoc inside controllers, so a new endpoint cannot be left unguarded by omission.
- Status codes: `401` missing/invalid token, distinct from `403` in US-AUTH-6.

**Design Notes**
- The redirect is immediate — a protected page never renders its content skeleton before bouncing, which would leak layout information.
- On arriving at login via redirect, a short line explains why ("Please sign in to continue to checkout") in an `aria-live` region.
- State: **loading** while the guard resolves the session, so a logged-in user does not see a redirect flicker.

---

### US-AUTH-6: Role-based authorization separates CUSTOMER from ADMIN

**Traces to:** docx §11 — "Role-based authorization" / "Example roles: CUSTOMER, ADMIN"

**User Story**
As an ADMIN
I want admin-only functions to be closed to customers
So that catalogue and order data cannot be altered by unauthorised users

**Acceptance Criteria**
- **AC1** — Given I am authenticated as `ADMIN`, When I open the admin dashboard, Then it loads.
- **AC2** — Given I am authenticated as `CUSTOMER`, When I navigate directly to an admin route by URL, Then I am refused access and shown a "not authorised" view rather than the dashboard.
- **AC3** — Given I am authenticated as `CUSTOMER`, When I call an admin API directly (bypassing the UI entirely), Then the server responds `403` and performs no change.
- **AC4** — Given a request carries a valid token, When the route requires `ADMIN` and the token's role is not `ADMIN`, Then the response is `403`, distinct from the `401` of US-AUTH-5.

**Edge Cases**
- Role tampered with in a client-held copy of the user object → irrelevant, because authorization reads the role from the verified JWT claim, never from the request body or client state.
- A user's role changed by an admin while that user holds a live token → the old role remains in force until the token expires; this is an accepted consequence of stateless JWT and is documented rather than silently ignored.
- Unknown role value on a record → denied by default; the guard allowlists roles rather than blocklisting them.

**Technical Considerations**
- An authorization middleware that runs after authentication and asserts the required role, applied to every `/api/admin/*` route and to product create/update/delete.
- Hiding admin UI is presentation only — the server check is the actual control. Both exist; only the server one is trusted.
- Status codes: `403` authenticated but not permitted.
- Denied attempts are logged with the user id and the route (docx §3, "Logging"), since repeated `403`s are a meaningful signal.

**Design Notes**
- The "not authorised" view is a plain page with a route back to the shop — not a dead end, and not a raw error dump.
- State: **error**.
- Admin navigation is conditionally rendered by role, so a customer is never shown a control that will only refuse them.

---

## Coverage

| docx requirement | Covered by |
|---|---|
| §1.1 Register | US-AUTH-1 |
| §1.1 Login | US-AUTH-2 |
| §1.1 Logout | US-AUTH-3 |
| §1.1 View validation errors | US-AUTH-1 AC3, US-AUTH-2 AC2 |
| §1.1 Maintain authenticated session | US-AUTH-4 |
| §1.1 JWT-based authentication | US-AUTH-2, US-AUTH-5 |
| §11 Password hashing | US-AUTH-1 AC5 |
| §11 Protected routes | US-AUTH-5 |
| §11 Role-based authorization | US-AUTH-6 |
| §11 Input validation | US-AUTH-1 AC3 |
| §11 Basic rate limiting | US-AUTH-1, US-AUTH-2 |
