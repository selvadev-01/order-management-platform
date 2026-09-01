# 03 — Product Details

**Source:** `Full-Stack MERN.docx` §1 (Product Details)
**Owning service:** Product Service (read), Order Service (add to cart)
**Actors:** GUEST, CUSTOMER

---

### US-PDP-1: View a product's full details

**Traces to:** docx §1.3 — "Display: Product images, Product name, Description, Price, Available stock"

**User Story**
As a CUSTOMER
I want to see everything about one product on its own page
So that I can decide whether to buy it

**Acceptance Criteria**
- **AC1** — Given I open a product's page, When it loads, Then I see its images, name, full description, price, and available stock.
- **AC2** — Given a product has several images, When the page loads, Then all are viewable and one is shown as the main image by default.
- **AC3** — Given the product is in stock, When I view the page, Then the exact remaining quantity is stated, not just "available".
- **AC4** — Given I request a product id that does not exist, When the server responds, Then it is `404` and I see a not-found page with a route back to the listing.
- **AC5** — Given the page is public, When I open it without logging in, Then the details render without authentication.

**Edge Cases**
- Product with no images at all → placeholder in the main image slot, no gallery thumbnails rendered.
- An image URL that fails to load → falls back to the placeholder without breaking the gallery layout.
- Malformed product id in the URL (not a valid ObjectId) → `400` or `404`, handled cleanly; never a `500` from a cast error.
- Description containing HTML or markup → rendered as text, never injected as raw HTML.
- Very long description → renders in full on its own page; no clamping here, unlike the listing card.

**Technical Considerations**
- `GET /api/products/:id` on the Product Service. Public route.
- Returns the complete document including the full `images[]` array and untruncated description — this is what distinguishes it from the list payload in US-PROD-1.
- The id is validated as an ObjectId before the query, which is what turns the malformed-id edge case into a clean `404` instead of a driver exception.
- Cached in Redis under `products:<id>`, invalidated by the admin write paths (US-PROD-6, `07-admin-products.md`).
- Status codes: `200` found, `400` malformed id, `404` no such product.

**Design Notes**
- Two-column from `md` up — gallery left, details right; single stacked column on mobile with the image first.
- Gallery thumbnails are buttons that swap the main image; the active one is indicated with `aria-current` and a visible border.
- Every image has meaningful `alt` text derived from the product name.
- States: **loading** (skeleton matching the two-column layout), **error** (fetch failure with retry), **success**.
- Price is the most prominent element after the name. Stock sits adjacent to the quantity selector, since the two are related.

---

### US-PDP-2: Choose a quantity within available stock

**Traces to:** docx §1.3 — "Quantity selector"

**User Story**
As a CUSTOMER
I want to choose how many units I want, bounded by what is in stock
So that I cannot order more than exists

**Acceptance Criteria**
- **AC1** — Given a product with stock available, When the page loads, Then the quantity selector starts at 1.
- **AC2** — Given quantity is 1, When I decrease it, Then it stays at 1 and the decrease control is disabled.
- **AC3** — Given quantity equals available stock, When I increase it, Then it does not exceed stock and the increase control is disabled.
- **AC4** — Given I type a quantity directly, When it exceeds available stock, Then it is clamped to the stock level and a message explains why.
- **AC5** — Given I type a non-numeric or zero value, When the field settles, Then it resets to 1.

**Edge Cases**
- Stock is 1 → both increase and decrease are disabled; quantity is fixed at 1.
- Stock is 0 → the selector is disabled entirely (see US-PDP-4).
- Decimal typed in (`2.5`) → coerced to an integer.
- Very large number pasted in → clamped to available stock, with no overflow or scientific notation reaching the field.
- Negative number pasted in → reset to 1.

**Technical Considerations**
- Purely client-side state on this page; the authoritative stock check happens again on add-to-cart (US-PDP-3) and at order creation (`05-checkout-payment.md`). Client clamping is convenience, not enforcement.
- The input is `type="number"` with `min="1"` and `max={stock}`, but the JS handler still validates, because native constraints alone do not stop paste or programmatic input.
- Clamping logic lives in a small shared helper reused by the cart's quantity controls (US-CART-3), so both behave identically.

**Design Notes**
- A three-part control: decrease button, numeric input, increase button — a familiar pattern that works with both mouse and keyboard.
- Buttons are `<button type="button">` so they never submit a surrounding form.
- The input has an accessible label ("Quantity") even though it is visually implied by context.
- Disabled buttons are genuinely `disabled`, and the clamp message uses `aria-live="polite"`.
- State: **form validation** (the clamp message).

---

### US-PDP-3: Add a product to the cart from its details page

**Traces to:** docx §1.3 — "Add to cart"

**User Story**
As a CUSTOMER
I want to add the product to my cart at my chosen quantity
So that I can continue shopping and check out later

**Acceptance Criteria**
- **AC1** — Given I am authenticated and have chosen a valid quantity, When I add to cart, Then the item is added at that quantity and I get a success confirmation.
- **AC2** — Given the item is added, When I look at the header, Then the cart indicator reflects the new count without a page reload.
- **AC3** — Given the product is already in my cart, When I add it again, Then the quantities combine into one line rather than creating a duplicate line.
- **AC4** — Given I am not authenticated, When I add to cart, Then I am sent to login and, once signed in, returned to this product page.
- **AC5** — Given the add request fails, When the response arrives, Then an error is shown and the cart indicator is unchanged.

**Edge Cases**
- Stock dropped below my chosen quantity between page load and the add → the server rejects it and the page refreshes its stock figure so I see the current number.
- Combined quantity (existing cart line + new addition) exceeds stock → rejected with a message naming the current limit.
- Add pressed twice quickly → the button disables during the request, so only one add is performed.
- Product deleted between page load and the add → `404`, with a message and a route back to the listing.

**Technical Considerations**
- `POST /api/cart` on the Order Service. Requires authentication (US-AUTH-5).
- Body `{ productId, quantity }`. The server re-reads the product's current stock and rejects if insufficient — the client's clamp from US-PDP-2 is never trusted.
- Merge-not-duplicate (AC3) is enforced server-side on the cart document, so the rule holds regardless of which screen called the endpoint.
- The response returns the updated cart so the header indicator updates from real data rather than an optimistic guess.
- Status codes: `200`/`201` added, `400` invalid quantity, `401` unauthenticated, `404` no such product, `409` insufficient stock.

**Design Notes**
- Add to Cart is the primary action on the page — full width on mobile, prominent on desktop.
- States: **loading** (in-button spinner, disabled), **success** (toast plus the cart count animating), **error** (inline message near the button, not a modal).
- The success toast offers "View cart" so the user can act on it, and auto-dismisses.
- The toast region is `aria-live="polite"` so the addition is announced to screen readers.
- Focus stays on the Add to Cart button after success, so keyboard users are not thrown to the top of the page.

---

### US-PDP-4: Out-of-stock products cannot be added

**Traces to:** docx §1.3 — "Available stock"; §1.2 — "Stock availability"

**User Story**
As a CUSTOMER
I want a clear signal when a product is unavailable
So that I do not try to buy something that cannot ship

**Acceptance Criteria**
- **AC1** — Given a product has zero stock, When I open its page, Then it is clearly marked out of stock.
- **AC2** — Given a product is out of stock, When I look at the controls, Then both the quantity selector and Add to Cart are disabled.
- **AC3** — Given a product is out of stock, When I call the add-to-cart API directly, Then the server refuses and the cart is unchanged.
- **AC4** — Given an admin restocks the product, When I reload the page, Then the controls become usable again.

**Edge Cases**
- Stock reaching zero while I have the page open → the disable happens on the next load or add attempt; the server refusal in AC3 is the real guard.
- Negative stock from a data error → treated as zero and out of stock, never as a purchasable negative.
- Product with stock but already fully reserved in my own cart → the add is refused with a message explaining my cart already holds the remaining units.

**Technical Considerations**
- The server-side check in AC3 is the enforcement point; the disabled UI is presentation. This mirrors the US-AUTH-6 principle that a hidden control is not a control.
- Stock is read fresh at add time, not from a cached product document, so the cache in US-PROD-6 cannot permit an oversell.
- Status code `409` for insufficient stock, distinguishing "your request conflicts with current state" from a `400` malformed request.

**Design Notes**
- Out-of-stock is signalled by a text badge plus the disabled controls — never by colour alone, which fails for colour-blind users.
- The disabled Add to Cart button keeps an accessible name explaining why it is unavailable, rather than being silently inert.
- State: **error**/unavailable variant of the details page, distinct from a fetch failure.

---

## Coverage

| docx requirement | Covered by |
|---|---|
| §1.3 Product images | US-PDP-1 AC1, AC2 |
| §1.3 Product name, Description, Price | US-PDP-1 AC1 |
| §1.3 Available stock | US-PDP-1 AC3, US-PDP-4 |
| §1.3 Quantity selector | US-PDP-2 |
| §1.3 Add to cart | US-PDP-3 |
