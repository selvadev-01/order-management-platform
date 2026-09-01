# 07 — Admin: Product Management

**Source:** `Full-Stack MERN.docx` §9 (Admin Dashboard — Products)
**Owning service:** Product Service
**Actors:** ADMIN

Every story here requires the `ADMIN` role. The authorization rule itself is specified once in US-AUTH-6 (`01-auth.md`) and applies to all endpoints below.

---

### US-ADMIN-1: Create a product

**Traces to:** docx §9 — "Products: Create product"

**User Story**
As an ADMIN
I want to add a new product to the catalogue
So that customers can buy it

**Acceptance Criteria**
- **AC1** — Given I am an admin on the product form, When I submit valid details (name, description, price, stock, category, image), Then the product is created and appears in the admin product list.
- **AC2** — Given I submit with any required field missing or invalid, When I submit, Then per-field validation errors render and nothing is created.
- **AC3** — Given a product is created, When a customer loads the listing, Then the new product appears — the cache does not hide it.
- **AC4** — Given I am not an admin, When I call the create endpoint directly, Then the response is `403` and nothing is created.
- **AC5** — Given creation succeeds, When the response arrives, Then I get a success confirmation and the form is cleared or I am returned to the list.

**Edge Cases**
- Negative or zero price → rejected by validation.
- Negative stock → rejected; zero stock is valid and means out of stock (US-PDP-4).
- Non-numeric price or stock → rejected; strings are not silently coerced.
- Price with more precision than the currency supports → rounded or rejected consistently with the minor-unit storage from US-CART-1.
- Duplicate product name → permitted, since the docx defines no uniqueness rule for names; the id is the identity.
- Category id that does not exist → rejected with a clear message.
- Very long name or description → length-capped server-side, matching the clamping the listing card expects.

**Technical Considerations**
- `POST /api/products` on the Product Service. Requires authentication **and** the `ADMIN` role.
- Writes to `products` with the schema established in US-PROD-1.
- Validation runs through the shared request-validation middleware (docx §3), the same one used by auth and checkout — one validation approach across the codebase.
- **Cache invalidation:** on success, the product list and category cache keys from US-PROD-6 are invalidated. AC3 is the observable consequence, and this is where the invalidation contract in US-PROD-6 AC3 is actually honoured.
- Image handling is by URL reference unless file upload is added; the docx does not require an upload pipeline, so URL is the minimal compliant approach.
- Status codes: `201` created, `400` validation failure, `401` unauthenticated, `403` not an admin.

**Design Notes**
- A single-column form with grouped fieldsets, comfortable on mobile — an admin may well be working from a phone.
- Price and stock are numeric inputs with sensible `min` values, still validated server-side.
- States: **form validation**, **loading** (disabled submit), **error**, **success** (toast plus navigation to the list).
- On validation failure focus moves to the first offending field, matching the checkout behaviour in US-PAY-1.

---

### US-ADMIN-2: Edit a product

**Traces to:** docx §9 — "Products: Edit product"

**User Story**
As an ADMIN
I want to change a product's details
So that the catalogue stays accurate

**Acceptance Criteria**
- **AC1** — Given an existing product, When I open its edit form, Then every field is pre-filled with its current values.
- **AC2** — Given I change fields and save, When the update succeeds, Then the new values persist and are shown in the list.
- **AC3** — Given I submit invalid values, When I submit, Then validation errors render and nothing changes.
- **AC4** — Given a product is updated, When a customer loads the listing or that product's page, Then the updated values appear rather than cached stale ones.
- **AC5** — Given I edit a product that has been deleted meanwhile, When I save, Then the response is `404` with a clear message.

**Edge Cases**
- Price changed while the product sits in customers' carts → carts show the new price, because they store only ids (US-CART-1); already-placed orders keep their snapshot (US-PAY-1 AC5). This split is intentional and worth verifying explicitly.
- Stock reduced below quantities already in carts → those cart lines are flagged and blocked at checkout (US-CART-1 edge cases).
- Concurrent edits by two admins → last write wins, which is acceptable at this scale and should be noted rather than left implicit.
- No fields actually changed → the save succeeds as a no-op.

**Technical Considerations**
- `PUT /api/products/:id` (or `PATCH` for partial updates — chosen once and applied consistently). Requires `ADMIN`.
- Same validation rules as US-ADMIN-1, shared rather than duplicated, so create and edit cannot drift apart.
- **Cache invalidation:** both `products:<id>` and the list keys are invalidated, which is what AC4 requires. Invalidating only one is the common bug here.
- Status codes: `200` updated, `400` validation failure, `401`, `403`, `404` no such product.

**Design Notes**
- The same form component as US-ADMIN-1 in an edit mode, so the two screens cannot diverge visually or behaviourally.
- The product being edited is clearly identified in the heading.
- States: **loading** (fetching current values), **form validation**, **error**, **success**.
- Cancel returns to the list without saving.

---

### US-ADMIN-3: Update product stock

**Traces to:** docx §9 — "Products: Update stock"

**User Story**
As an ADMIN
I want to adjust a product's stock quickly
So that availability reflects what we actually hold

**Acceptance Criteria**
- **AC1** — Given a product in the admin list, When I set a new stock value, Then it saves and the list shows the new figure.
- **AC2** — Given I set stock to zero, When it saves, Then the product shows as out of stock to customers and cannot be added to a cart.
- **AC3** — Given I set stock above zero on an out-of-stock product, When it saves, Then customers can add it again.
- **AC4** — Given I enter a negative or non-numeric value, When I try to save, Then it is rejected and stock is unchanged.
- **AC5** — Given stock is updated, When a customer views the product, Then the new figure is shown rather than a cached one.

**Edge Cases**
- Stock reduced below quantities already in customers' carts → those lines are flagged at checkout rather than silently truncated.
- Stock changed while a customer is mid-checkout → the order-creation stock check (US-PAY-1) catches it before payment.
- Two admins updating stock at once → last write wins, consistent with US-ADMIN-2.
- Very large stock value → capped to a sane maximum by validation.

**Technical Considerations**
- Either the general update endpoint from US-ADMIN-2 or a dedicated `PATCH /api/products/:id/stock`. A dedicated route is preferable because it is the highest-frequency admin action and keeps the payload minimal.
- Requires `ADMIN`.
- Stock is stored as a non-negative integer; validation enforces this, which is what makes the negative-stock edge case in US-PDP-4 a defensive fallback rather than an expected state.
- **Cache invalidation** as in US-ADMIN-2 — AC5 depends on it.
- Status codes: `200`, `400`, `401`, `403`, `404`.

**Design Notes**
- Inline editing in the admin list is preferable to a full form navigation, since this action is repeated across many products.
- The stock field is a numeric input with a visible label, saving on blur or via an explicit Save control.
- States: **loading** (per row, so one row saving does not block the table), **form validation**, **error**, **success**.
- The saved value is confirmed inline via `aria-live` rather than a full-page toast, keeping the admin's place in a long list.

---

### US-ADMIN-4: Delete a product

**Traces to:** docx §9 — "Products: Delete product"

**User Story**
As an ADMIN
I want to remove a product from the catalogue
So that we stop selling things we no longer offer

**Acceptance Criteria**
- **AC1** — Given a product exists, When I delete it and confirm, Then it is removed from the admin list and no longer visible to customers.
- **AC2** — Given I press delete, When the confirmation appears, Then nothing is deleted until I confirm.
- **AC3** — Given a deleted product appeared in past orders, When I open one of those orders, Then it still renders correctly from the order's own snapshot.
- **AC4** — Given a product is deleted, When a customer requests its details page, Then the response is `404`.
- **AC5** — Given I am not an admin, When I call the delete endpoint directly, Then the response is `403` and nothing is deleted.

**Edge Cases**
- Product sitting in customers' carts when deleted → those lines are flagged unavailable and block checkout until removed (US-CART-1).
- Product referenced by historical orders → orders are unaffected, because they hold their own item snapshot. This is precisely why US-PAY-1 AC5 stores the snapshot, and is the single most important reason not to hard-delete blindly.
- Deleting an already-deleted product → idempotent, returning success or `404` consistently.
- Delete confirmed twice → the second is a no-op.

**Technical Considerations**
- `DELETE /api/products/:id`. Requires `ADMIN`.
- Hard delete versus soft delete (an `isDeleted` flag) is a genuine decision: soft delete preserves referential sanity for carts and analytics, hard delete is simpler. The docx requires neither specifically. **Recommendation: soft delete**, since it makes AC3 and the cart edge case trivially correct, and the listing query simply excludes flagged records. The choice is documented in the README.
- If soft delete is used, `GET /api/products` and `GET /api/products/:id` must both filter it out, or deleted products leak back into the catalogue.
- **Cache invalidation** for both the product key and the list keys.
- Status codes: `200`/`204` deleted, `401`, `403`, `404`.

**Design Notes**
- Delete requires an explicit confirmation naming the product — this is the one destructive action in the admin surface and should not be a single misclick.
- The confirmation is a focus-trapped dialog, dismissible with Escape, with focus returning to the triggering row afterwards.
- The confirm button is styled as destructive; Cancel is the default focus target.
- States: **loading** (during deletion), **error**, **success**.

---

### US-ADMIN-5: View the admin product list

**Traces to:** docx §9 — "Admin should be able to: Products: Create / Edit / Delete / Update stock" (the surface these actions are performed from)

**User Story**
As an ADMIN
I want a list of all products with their stock
So that I can find and manage any product

**Acceptance Criteria**
- **AC1** — Given products exist, When I open the admin product list, Then each row shows name, price, stock, and category, with controls to edit and delete.
- **AC2** — Given no products exist, When I open the list, Then the empty state renders with a route to create one.
- **AC3** — Given the list fails to load, When it settles, Then the error state renders with retry.
- **AC4** — Given many products exist, When I browse, Then the list is paginated.
- **AC5** — Given I am not an admin, When I open the route, Then I am refused per US-AUTH-6.

**Edge Cases**
- Out-of-stock products → visually distinguished so restocking candidates are easy to spot.
- Long product names → truncated in the table without breaking the row layout.
- A product deleted in another tab → disappears on the next load rather than erroring on interaction.

**Technical Considerations**
- Reuses `GET /api/products` with admin scope — including soft-deleted records if soft delete is used, since admins need to see them and customers do not.
- Requires `ADMIN`.
- Pagination follows the same contract as US-PROD-4, so the metadata shape is shared.
- This list is the surface from which US-ADMIN-2, 3, and 4 are launched, which is why it is specified rather than assumed.

**Design Notes**
- A table from `md` up, stacked cards on mobile — an admin table must not force horizontal scrolling on a phone.
- States: **loading**, **empty**, **error**, **success** — reusing the shared components from US-PROD-5.
- Action controls carry accessible names including the product name, so a screen reader user is not presented with a column of identical "Edit" buttons.
- A clear Create Product action sits at the top of the list.

---

## Coverage

| docx requirement | Covered by |
|---|---|
| §9 Create product | US-ADMIN-1 |
| §9 Edit product | US-ADMIN-2 |
| §9 Update stock | US-ADMIN-3 |
| §9 Delete product | US-ADMIN-4 |
| §9 (admin product surface) | US-ADMIN-5 |
| §11 Role-based authorization on all of the above | US-AUTH-6 (`01-auth.md`) |
| §6 Cache invalidation on write | US-ADMIN-1/2/3/4 (technical), contract in US-PROD-6 AC3 |
