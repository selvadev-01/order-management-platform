# 02 — Product Listing

**Source:** `Full-Stack MERN.docx` §1 (Product Listing), §6 (Redis caching)
**Owning service:** Product Service
**Actors:** GUEST, CUSTOMER

---

### US-PROD-1: Browse the product catalogue

**Traces to:** docx §1.2 — "Display: Product image, Product name, Description, Price, Stock availability, Category"

**User Story**
As a CUSTOMER
I want to see a list of products with their key details
So that I can decide what is worth opening

**Acceptance Criteria**
- **AC1** — Given products exist, When I open the listing, Then each card shows all six required fields: image, name, description, price, stock availability, and category.
- **AC2** — Given a product has stock greater than zero, When I view its card, Then availability reads as in stock.
- **AC3** — Given a product has zero stock, When I view its card, Then it is clearly marked out of stock and the card is visually distinguished from purchasable ones.
- **AC4** — Given I select a product card, When the navigation completes, Then I am on that product's details page.
- **AC5** — Given the listing is public, When I browse without logging in, Then products are visible without authentication.

**Edge Cases**
- Product has no image, or the image URL 404s → a placeholder renders at the same dimensions, so the grid does not reflow.
- Very long product name or description → clamped to a fixed number of lines with an ellipsis; cards in a row stay the same height.
- Price of zero, or a price needing rounding → formatted consistently through one shared currency formatter, never with ad-hoc `toFixed` calls per component.
- A product whose category was deleted → still renders, showing an "Uncategorised" label rather than crashing on a null lookup.

**Technical Considerations**
- `GET /api/products` on the Product Service via the API Gateway. Public — no auth middleware.
- Collection `products`: `{ name, description, price, stock, category, images[], createdAt, updatedAt }`.
- The list response returns only the fields the card needs; full descriptions and the complete image array are left to the details endpoint.
- Category is populated or denormalised so the client makes one request, not one per card.
- Currency formatting lives in a shared util in `frontend/src/utils` and is reused by cart, checkout, and admin — this is the single source of truth for money display.
- Status codes: `200` with an array (empty array is still `200`, not `404`).

**Design Notes**
- Responsive grid: one column on mobile, two on `sm`, three on `lg`, four on `xl`. Tailwind `grid` with `gap`, not floats or absolute positioning.
- Images use a fixed aspect ratio box with `object-cover`, so mixed source dimensions cannot break the grid.
- Cards are keyboard reachable and activate with Enter; the whole card is one link rather than a nest of separately focusable elements.
- Price uses a larger weight than the description so the scanning eye finds it first.
- Out-of-stock state is conveyed by a text badge, not colour alone.

---

### US-PROD-2: Search products by name

**Traces to:** docx §1.2 — "Implement: Search"

**User Story**
As a CUSTOMER
I want to search for products by name
So that I can find a specific item without paging through the catalogue

**Acceptance Criteria**
- **AC1** — Given I type a term matching one or more products, When the search runs, Then only matching products are listed.
- **AC2** — Given I type a term matching nothing, When the search runs, Then the empty state renders with my term quoted back and a way to clear the search.
- **AC3** — Given I clear the search box, When the field is empty, Then the unfiltered catalogue returns.
- **AC4** — Given I have searched, When I look at the URL, Then my term is in the query string so the result is shareable and survives a refresh.
- **AC5** — Given I type quickly, When keystrokes arrive faster than the debounce window, Then only one request is issued for the settled term.

**Edge Cases**
- Search combined with an active category filter → both apply together (AND), not one replacing the other.
- Term with leading/trailing whitespace → trimmed before searching.
- Regex metacharacters or `$` operators typed into the box → treated as literal text; the input is never interpolated into a query in a way that permits NoSQL operator injection.
- Search term while on page 5 → pagination resets to page 1, since the old page number may not exist in the new result set.
- Responses arriving out of order after fast typing → the stale response is discarded, so the list matches the current term.

**Technical Considerations**
- `GET /api/products?search=<term>` — same endpoint as US-PROD-1, an added parameter rather than a second endpoint.
- Text index on `name` (and `description` if the index budget allows) in `products`.
- Input validated and length-capped server-side; the value is bound as a parameter, never spliced into the query object.
- Debounce ~300ms client-side. Request cancellation (`AbortController`) handles the out-of-order case in the edge list.
- Search is deliberately **not** Redis-cached — the key space is unbounded and hit rate would be poor. Caching stays on the unfiltered catalogue and category reads (US-PROD-6).

**Design Notes**
- Search input sits above the grid, full width on mobile, inline with the category filter from `md` up.
- States: **loading** (existing results dim with a spinner rather than being replaced by a blank screen — no layout jump), **empty**, **error**.
- The input is `type="search"` with a visible label or a clear `aria-label`, and a clear button once it has content.
- Result count is announced in an `aria-live="polite"` region so screen reader users learn the list changed.

---

### US-PROD-3: Filter products by category

**Traces to:** docx §1.2 — "Implement: Category filtering"

**User Story**
As a CUSTOMER
I want to narrow the list to a category
So that I only see the kind of product I came for

**Acceptance Criteria**
- **AC1** — Given categories exist, When I open the listing, Then the available categories are offered as filter options.
- **AC2** — Given I pick a category, When the list refreshes, Then only products in that category appear.
- **AC3** — Given a filter is active, When I choose to clear it, Then the full catalogue returns.
- **AC4** — Given a filter is active, When I look at the URL, Then the category is in the query string and survives a refresh.
- **AC5** — Given I pick a category holding no products, When the list refreshes, Then the empty state renders rather than a blank region.

**Edge Cases**
- Category in the URL that does not exist → the filter is ignored and the full catalogue loads, rather than erroring.
- Filter applied while on a later page → pagination resets to page 1.
- Category list itself fails to load → the grid still renders unfiltered and the filter control shows its own inline error; one failure does not blank the page.
- A category deleted while selected → the app falls back to unfiltered on the next load.

**Technical Considerations**
- `GET /api/categories` for the options, `GET /api/products?category=<id>` for the filtered list.
- Collection `categories`: `{ name, slug, createdAt }`. Index on `category` in `products` to keep the filter fast.
- Search and category compose into one Mongo query — they are not two separate code paths.
- The category list is a strong Redis cache candidate: small, read constantly, rarely written (US-PROD-6).
- Status codes: `200`; an unknown category yields an empty array or the unfiltered list per AC in the edge cases, never a `500`.

**Design Notes**
- On mobile a `<select>`; from `md` up a horizontal row of filter chips showing the active one clearly.
- Chips are real buttons with `aria-pressed` reflecting selection.
- States: **loading** (skeleton chips), **error** (inline, scoped to the filter), **empty**.
- The active filter is visible without scrolling, so users understand why the list is short.

---

### US-PROD-4: Page through the catalogue

**Traces to:** docx §1.2 — "Implement: Pagination"

**User Story**
As a CUSTOMER
I want the catalogue split into pages
So that the listing stays fast and readable

**Acceptance Criteria**
- **AC1** — Given more products exist than fit one page, When I open the listing, Then I see the first page plus controls to move between pages.
- **AC2** — Given I move to the next page, When it loads, Then the next set renders and the current page is indicated.
- **AC3** — Given I am on the first page, When I look at the controls, Then Previous is disabled; likewise Next on the last page.
- **AC4** — Given I am on a page, When I look at the URL, Then the page number is in the query string and a refresh keeps me there.
- **AC5** — Given products fit on a single page, When the listing loads, Then pagination controls are hidden entirely.

**Edge Cases**
- Page number beyond the last page typed into the URL → clamped to the last valid page rather than showing an empty grid.
- Page number that is zero, negative, or non-numeric → falls back to page 1.
- Products deleted between page loads, shrinking the total → the current page clamps to the new maximum.
- Changing search or filter while paginated → resets to page 1 (shared with US-PROD-2 and US-PROD-3).

**Technical Considerations**
- `GET /api/products?page=<n>&limit=<n>`. Fixed default page size; `limit` capped server-side so a client cannot request the entire collection.
- Response carries pagination metadata — `{ items, page, limit, total, totalPages }` — so the client renders controls without inferring from array length.
- `skip`/`limit` with a stable sort (e.g. `createdAt` descending) so ordering does not drift between pages.
- `page` and `limit` are validated and coerced to integers server-side; the clamping in the edge cases is enforced there, not only in the UI.

**Design Notes**
- Controls centred beneath the grid: Previous, page indicator, Next. Full page-number lists are avoided since the catalogue is small.
- Controls are `<button>`s inside a `<nav aria-label="Pagination">`; the current page carries `aria-current="page"`.
- Disabled buttons are genuinely `disabled`, not merely styled grey.
- On page change the view scrolls to the top of the grid, so the user is not left mid-list.
- State: **loading** during fetch, with controls disabled to prevent double navigation.

---

### US-PROD-5: Loading, empty, and error states on the listing

**Traces to:** docx §1.2 — "Implement: Loading state, Empty state, Error state"

**User Story**
As a CUSTOMER
I want the listing to tell me what is happening when there is nothing to show
So that I can tell a slow load from a broken page from a genuinely empty catalogue

**Acceptance Criteria**
- **AC1** — Given a request for products is in flight, When I look at the page, Then a loading state renders in the grid's place.
- **AC2** — Given the request succeeds with zero products and no filters are active, When the page settles, Then an empty state explains the catalogue is empty.
- **AC3** — Given the request succeeds with zero products *because* of my search or filter, When the page settles, Then the empty state says so and offers to clear the criteria — distinct from AC2's wording.
- **AC4** — Given the request fails, When the page settles, Then an error state renders with a Retry control.
- **AC5** — Given I press Retry, When the retry succeeds, Then the grid renders normally with no page reload.

**Edge Cases**
- Request succeeds so fast the spinner would flash → the loading state has a small minimum display time, or appears only after a short delay, to avoid a visual flicker.
- Network offline entirely → the error state distinguishes a connection problem from a server error where it can.
- A 500 from the server → the user sees a friendly message; the raw error and stack go to the logs only, never to the screen.
- Retry pressed repeatedly → disabled while a retry is in flight.

**Technical Considerations**
- Fetch state is modelled explicitly as one of `idle | loading | success | error`, so "empty" and "not yet loaded" cannot be confused — the distinction AC1 and AC2 depend on.
- A shared data-fetching hook in `frontend/src/hooks` owns this state machine and is reused by every list screen in the app, rather than each page reimplementing it.
- The empty-state variant is chosen by whether any search/filter parameter is active, which is what separates AC2 from AC3.
- Server errors are shaped by the centralized error handler (docx §3), so the client can rely on one consistent error body.

**Design Notes**
- Loading uses skeleton cards matching the real card dimensions, so the layout does not shift when data arrives.
- Empty and error states are centred in the grid area with an icon, one line of explanation, and one clear action.
- The four states are mutually exclusive — only ever one is on screen.
- Error and empty regions use `role="status"` so the change is announced.
- These four states are built once as shared components and reused by the cart, orders, and admin lists.

---

### US-PROD-6: Serve catalogue reads from a Redis cache

**Traces to:** docx §6 — "Use Case 1 — Caching: Cache frequently requested product/category data"

**User Story**
As a SYSTEM
I want frequently requested product and category data served from Redis
So that repeat reads avoid MongoDB and the listing stays responsive

**Acceptance Criteria**
- **AC1** — Given a catalogue request has not been cached, When it arrives, Then it is read from MongoDB, written to Redis with a TTL, and returned.
- **AC2** — Given the same request arrives again within the TTL, When it is handled, Then it is served from Redis without touching MongoDB.
- **AC3** — Given a product is created, updated, or deleted by an admin, When the write commits, Then the affected cache entries are invalidated so the next read is fresh.
- **AC4** — Given Redis is unreachable, When a request arrives, Then it falls through to MongoDB and succeeds — a cache outage must not take down the catalogue.
- **AC5** — Given a cached response is returned, When it is compared against the uncached one, Then they are identical in shape and content.

**Edge Cases**
- Redis available on read but failing on write → the response is still returned; the cache-write failure is logged and swallowed.
- Stale entry surviving invalidation → bounded by the TTL, which acts as the backstop.
- Many distinct query combinations → cache keys are built from a normalised parameter set so `?page=1&category=x` and `?category=x&page=1` share one key.
- Cache stampede when a hot key expires under load → acceptable at this scale, but the key design keeps the blast radius to one query.

**Technical Considerations**
- Cache-aside, exactly as the docx flow diagram describes: request → Redis → hit? return : Mongo → write Redis → return.
- Key naming: `products:list:<normalised-query-hash>`, `products:<id>`, `categories:all`. A documented prefix scheme keeps invalidation tractable.
- TTL in the low minutes for lists; the category list can hold longer since it changes rarely.
- Invalidation is triggered by the admin write paths in `07-admin-products.md`, keeping the two files' behaviour consistent.
- Every Redis call is wrapped so a failure degrades to a MongoDB read — this is what AC4 requires.
- This is Redis use case #1 of the two the docx requires; BullMQ (`06-notifications-jobs.md`) is use case #2.

**Design Notes**
- No user-visible surface. The only observable effect should be faster repeat loads.
- Cache hit/miss is logged at debug level so the behaviour can be demonstrated during review — the docx asks for meaningful use, which has to be evidenceable.

---

## Coverage

| docx requirement | Covered by |
|---|---|
| §1.2 Display image, name, description, price, stock, category | US-PROD-1 |
| §1.2 Search | US-PROD-2 |
| §1.2 Category filtering | US-PROD-3 |
| §1.2 Pagination | US-PROD-4 |
| §1.2 Loading state | US-PROD-5 AC1 |
| §1.2 Empty state | US-PROD-5 AC2, AC3 |
| §1.2 Error state | US-PROD-5 AC4 |
| §6 Caching (Redis use case 1) | US-PROD-6 |
