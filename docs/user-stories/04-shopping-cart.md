# 04 — Shopping Cart

**Source:** `Full-Stack MERN.docx` §1 (Shopping Cart), §4 (User → Cart relationship)
**Owning service:** Order Service
**Actors:** CUSTOMER

---

### US-CART-1: View the cart

**Traces to:** docx §1.4 — "View subtotal, View total"; §4 — "User ├── Cart"

**User Story**
As a CUSTOMER
I want to see everything in my cart with the money totalled
So that I know exactly what I am about to buy and what it costs

**Acceptance Criteria**
- **AC1** — Given my cart has items, When I open it, Then each line shows the product image, name, unit price, quantity, and that line's subtotal.
- **AC2** — Given my cart has items, When I look at the summary, Then the total across all lines is shown.
- **AC3** — Given my cart is empty, When I open it, Then the empty state renders with a route back to the product listing.
- **AC4** — Given I am not authenticated, When I open the cart, Then I am sent to login and returned to the cart afterwards.
- **AC5** — Given my cart has items, When I look at the summary, Then a Proceed to Checkout control is available.

**Edge Cases**
- A product in the cart was deleted by an admin → the line is flagged as unavailable and excluded from the total; checkout is blocked until it is removed.
- A product's price changed since it was added → the current price is shown and used; the cart is not a price lock.
- A line's quantity now exceeds available stock → the line is flagged and checkout is blocked until the quantity is reduced.
- Cart request fails → the error state renders with retry, not an empty cart, which would wrongly imply the cart was cleared.

**Technical Considerations**
- `GET /api/cart` on the Order Service. Requires authentication.
- Collection `carts`: `{ userId, items: [{ productId, quantity }], createdAt, updatedAt }`. Unique index on `userId` — one cart per user, which is the docx's `User ├── Cart` relationship.
- The cart stores `productId` and `quantity` only. Price, name, and image are resolved from the Product Service at read time, which is what makes the price-change edge case behave correctly — a cart holding stale prices would be wrong by construction.
- Totals are computed server-side and returned with the cart. The client displays them; it does not calculate money independently, so the two can never disagree.
- Line and cart totals use integer minor units (paise/cents) internally to avoid floating-point drift, formatted for display by the shared currency util from US-PROD-1.
- Status codes: `200` (an empty cart is `200` with an empty array, not `404`), `401` unauthenticated.

**Design Notes**
- Two-column from `lg`: line items left, a sticky order summary right. Single column on mobile with the summary beneath the lines and the checkout button reachable without hunting.
- Each line is a row on desktop and a stacked card on mobile — quantity controls must stay comfortably tappable at 320px.
- States: **loading** (skeleton rows), **empty**, **error**, **success**.
- Totals use a larger, heavier type than line subtotals so the final figure is unmistakable.
- Flagged (unavailable/over-stock) lines are marked with text and an icon, not colour alone.

---

### US-CART-2: Remove a product from the cart

**Traces to:** docx §1.4 — "Users should be able to: Remove products"

**User Story**
As a CUSTOMER
I want to remove a line from my cart
So that I do not buy something I changed my mind about

**Acceptance Criteria**
- **AC1** — Given a line is in my cart, When I remove it, Then it disappears from the list and the total recalculates.
- **AC2** — Given I remove the last remaining line, When the update completes, Then the empty state renders.
- **AC3** — Given the remove request fails, When the response arrives, Then the line remains and an error is shown — the UI never diverges from the server's state.
- **AC4** — Given I have removed a line, When I reload the page, Then it is still gone, because the change was persisted.

**Edge Cases**
- Remove pressed twice quickly → the second is a no-op; removing an absent line is idempotent and does not error.
- Removing a line already deleted in another tab → treated as success, since the desired end state already holds.
- Remove while a quantity update on the same line is in flight → requests are serialised per line so they cannot interleave into an inconsistent state.

**Technical Considerations**
- `DELETE /api/cart/:productId` on the Order Service. Requires authentication and operates only on the caller's own cart — a user must never be able to mutate another user's cart by supplying an id.
- Idempotent by design: removing a line that is not present returns success, which is what makes the double-press edge case harmless.
- The response returns the updated cart with recalculated totals, so the client re-renders from server truth rather than mutating a local copy.
- Status codes: `200` with the updated cart, `401` unauthenticated.

**Design Notes**
- Remove is a clearly-labelled control on each line — an icon button with an accessible name including the product ("Remove Blue Mug from cart"), never a bare unlabelled ✕.
- No confirmation dialog for a single line removal; the action is cheap and easily redone by re-adding.
- States: **loading** (the line dims and its controls disable), **error**, **success**.
- The change is announced via `aria-live` so screen reader users know the line went and what the new total is.

---

### US-CART-3: Increase or decrease quantity in the cart

**Traces to:** docx §1.4 — "Users should be able to: Increase/decrease quantity"

**User Story**
As a CUSTOMER
I want to change how many units of a line I want
So that I can adjust my order without removing and re-adding it

**Acceptance Criteria**
- **AC1** — Given a line at quantity n, When I increase it, Then it becomes n+1 and both that line's subtotal and the cart total recalculate.
- **AC2** — Given a line at quantity n above 1, When I decrease it, Then it becomes n−1 with totals recalculated.
- **AC3** — Given a line at quantity 1, When I look at the decrease control, Then it is disabled — reaching zero is done via Remove (US-CART-2), not by decrementing.
- **AC4** — Given a line at the product's available stock, When I try to increase it, Then it does not go higher and a message explains the stock limit.
- **AC5** — Given a quantity update fails, When the response arrives, Then the previous quantity is restored and an error is shown.

**Edge Cases**
- Increase beyond stock attempted via the API directly → refused with `409`; the client-side disable is convenience only.
- Rapid repeated clicks → requests are debounced or queued per line so the final server state matches the final displayed quantity.
- Stock reduced by an admin below my current cart quantity → the line is flagged on next load (US-CART-1) and checkout is blocked until corrected.
- Quantity typed directly rather than stepped → clamped by the same shared helper used on the product details page (US-PDP-2), so the two screens behave identically.

**Technical Considerations**
- `PATCH /api/cart/:productId` with `{ quantity }`. Requires authentication; scoped to the caller's cart.
- The server validates the quantity is a positive integer and re-checks it against current stock before persisting — the authoritative check, matching US-PDP-3.
- The response returns the whole updated cart with fresh totals, keeping one recalculation path shared with US-CART-1 and US-CART-2.
- Optimistic UI is acceptable provided the rollback in AC5 is implemented; otherwise the update waits for the server.
- Status codes: `200` updated, `400` invalid quantity, `401` unauthenticated, `409` insufficient stock.

**Design Notes**
- The same three-part stepper as the product details page (US-PDP-2) — reused as one component, not rebuilt.
- Controls stay at least 44×44px on touch so they are comfortably tappable on mobile.
- States: **loading** (per line, not the whole cart — one line updating must not blank the page), **form validation** (the stock-limit message), **error**.
- Totals update in an `aria-live="polite"` region so the financial consequence of the change is announced.

---

### US-CART-4: Proceed to checkout

**Traces to:** docx §1.4 — "Users should be able to: Proceed to checkout"

**User Story**
As a CUSTOMER
I want to move from my cart to checkout
So that I can supply delivery details and pay

**Acceptance Criteria**
- **AC1** — Given my cart has at least one valid line, When I proceed to checkout, Then I arrive at the checkout page carrying my cart contents and total.
- **AC2** — Given my cart is empty, When I look at the cart page, Then no checkout control is offered.
- **AC3** — Given any line is flagged unavailable or over-stock, When I try to proceed, Then I am blocked with a message naming the offending line.
- **AC4** — Given I am authenticated with a valid cart, When I proceed, Then the total shown at checkout matches the total shown on the cart exactly.

**Edge Cases**
- Cart emptied in another tab before proceeding → checkout detects the empty cart and returns me to the cart page with an explanation.
- Stock changing between cart and checkout → re-validated at order creation (`05-checkout-payment.md`, US-PAY-1); this is the last of three checks (add, checkout entry, order creation).
- Session expiring at the moment of proceeding → the `401` interceptor sends me to login and back afterwards, preserving the cart, which lives server-side.

**Technical Considerations**
- Client-side navigation to the checkout route; no dedicated API call at this step.
- Checkout re-fetches the cart from `GET /api/cart` rather than trusting values passed through client state, which is what guarantees AC4's total match and catches the cross-tab edge case.
- Validity (no unavailable or over-stock lines) is determined from the same server-computed flags rendered in US-CART-1, so the cart and checkout agree on what "valid" means.

**Design Notes**
- Proceed to Checkout is the primary action in the summary panel: full width, visually dominant over Continue Shopping.
- Sticky on desktop within the summary column; on mobile it sits at the end of the summary, always reachable by scrolling.
- The blocking message from AC3 appears adjacent to the button and moves focus to the offending line, so the user knows exactly what to fix.
- States: **loading** (while the cart re-validates), **error**.

---

## Coverage

| docx requirement | Covered by |
|---|---|
| §1.4 Add products | US-PDP-3 (`03-product-details.md`) |
| §1.4 Remove products | US-CART-2 |
| §1.4 Increase/decrease quantity | US-CART-3 |
| §1.4 View subtotal | US-CART-1 AC1 |
| §1.4 View total | US-CART-1 AC2 |
| §1.4 Proceed to checkout | US-CART-4 |
| §4 User ├── Cart relationship | US-CART-1 (technical: one cart per user) |

**Note on "Add products":** the docx lists adding to cart under both Product Details (§1.3) and Shopping Cart (§1.4). It is specified once as US-PDP-3 to avoid a duplicate story; the endpoint and merge behaviour are shared.
