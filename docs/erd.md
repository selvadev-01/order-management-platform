# Entity Relationship Diagram

Data model for the Order Management Platform. Seven MongoDB collections, matching the brief's suggested set (docx §4).

The behavioural rules these structures serve are specified in [`user-stories/`](user-stories/).

---

## Relationships

The brief states the core relationship:

```
User
├── Cart          (1:1 — one cart per user)
└── Orders        (1:N)
    └── Payment   (1:1 — one payment record per order)
```

Full model:

```mermaid
erDiagram
    USERS ||--o| CARTS : "has one"
    USERS ||--o{ ORDERS : "places"
    USERS ||--o{ NOTIFICATIONS : "receives"
    USERS ||--o{ PUSH_SUBSCRIPTIONS : "registers"

    ORDERS ||--o| PAYMENTS : "settled by"
    ORDERS ||--o{ NOTIFICATIONS : "raises"

    CATEGORIES ||--o{ PRODUCTS : "groups"

    CARTS }o--{ PRODUCTS : "references (live)"
    ORDERS }o--{ PRODUCTS : "snapshots (frozen)"

    USERS {
        ObjectId _id PK
        string   name
        string   email UK "lowercased, trimmed"
        string   passwordHash "bcrypt"
        string   role "CUSTOMER | ADMIN"
        date     createdAt
        date     updatedAt
    }

    CATEGORIES {
        ObjectId _id PK
        string   name
        string   slug UK
        date     createdAt
    }

    PRODUCTS {
        ObjectId _id PK
        string   name "text-indexed"
        string   description
        int      price "minor units"
        int      stock "non-negative"
        ObjectId category FK
        array    images
        bool     isDeleted "soft delete"
        date     createdAt
        date     updatedAt
    }

    CARTS {
        ObjectId _id PK
        ObjectId userId FK,UK "one per user"
        array    items "productId + quantity only"
        date     createdAt
        date     updatedAt
    }

    ORDERS {
        ObjectId _id PK
        ObjectId userId FK
        array    items "snapshot: name, unitPrice, qty"
        int      totalAmount "minor units, server-computed"
        object   customerInfo "snapshot"
        object   deliveryAddress "snapshot"
        string   orderStatus "Pending..Delivered"
        string   paymentStatus "Pending | Paid | Failed"
        date     createdAt
        date     updatedAt
    }

    PAYMENTS {
        ObjectId _id PK
        ObjectId orderId FK
        ObjectId userId FK
        string   gateway "razorpay"
        string   gatewayOrderId
        string   gatewayPaymentId UK "idempotency backstop"
        string   gatewayEventId "webhook dedupe"
        int      amount "minor units, from order"
        string   currency
        string   status "Created | Paid | Failed"
        bool     signatureVerified
        date     createdAt
        date     updatedAt
    }

    NOTIFICATIONS {
        ObjectId _id PK
        ObjectId userId FK
        ObjectId orderId FK
        string   event "ORDER_PLACED, etc."
        string   channel "push | in-app"
        string   status "Pending|Sent|Failed|Skipped"
        date     sentAt
        string   error
        date     createdAt
    }

    PUSH_SUBSCRIPTIONS {
        ObjectId _id PK
        ObjectId userId FK
        string   endpoint UK
        object   keys "p256dh, auth"
        date     createdAt
    }
```

> `push_subscriptions` is not in the brief's suggested list. Web Push requires storing per-device subscriptions, and one user may have several. Keeping it separate from `users` avoids an unbounded array on a hot document. It is an implementation detail of the notification requirement (docx §8), not added scope.

---

## The central design decision: reference vs. snapshot

Carts and orders relate to products in deliberately **opposite** ways.

| | Carts | Orders |
|---|---|---|
| Stores | `productId` + `quantity` | Full item snapshot |
| Price shown | Resolved live from `products` | Frozen at purchase |
| Product edited | Cart reflects the change | Order unaffected |
| Product deleted | Line flagged unavailable | Renders from snapshot |

**Why carts reference:** a cart is an intention, not a contract. If an admin changes a price, the customer should see the price they will actually pay. Storing a price in the cart would let a stale figure reach checkout.

**Why orders snapshot:** a placed order is immutable history. The customer paid a specific amount for specifically-described goods. If it referenced `products`, editing a product would retroactively rewrite what someone bought — and deleting one would corrupt the record entirely.

This is why deleting a product breaks neither: the cart flags the line, past orders render from their own copy.

---

## Indexes

| Collection | Index | Purpose |
|---|---|---|
| `users` | `email` **unique** | Login lookup; enforces one account per email at the database level |
| `products` | `category` | Category filter |
| `products` | `name` **text** | Search |
| `products` | `createdAt` | Default listing sort |
| `products` | `isDeleted` | Excludes soft-deleted rows from customer queries |
| `categories` | `slug` **unique** | Lookup by slug |
| `carts` | `userId` **unique** | Enforces one cart per user as an invariant, not a convention |
| `orders` | `userId + createdAt` | Customer's order list and its sort, in one compound index |
| `orders` | `orderStatus` | Admin filtering by fulfilment stage |
| `payments` | `orderId` | Payment lookup for an order |
| `payments` | `gatewayPaymentId` **unique** | Database-level backstop for webhook idempotency |
| `notifications` | `userId + createdAt` | Notification list and sort |
| `push_subscriptions` | `endpoint` **unique** | Prevents duplicate device registrations |

Three of these enforce correctness rather than speed: the unique indexes on `users.email`, `carts.userId`, and `payments.gatewayPaymentId` make application invariants impossible to violate even under concurrency — which is what lets simultaneous registration, and duplicate webhook delivery, fail safely.

---

## Status lifecycles

**Order status** — transitions validated server-side against an allowed-transitions map; skipping stages or moving backwards is rejected.

```
Pending ──→ Confirmed ──→ Processing ──→ Shipped ──→ Delivered
```

`Delivered` is terminal. Confirmed, Shipped, and Delivered each raise a customer notification.

**Payment status** — changes only on a signature-verified webhook, never on the frontend callback.

```
Pending ──→ Created ──→ Paid
                   └──→ Failed ──→ (retry: back to Created)
```

`orderStatus` and `paymentStatus` are separate fields on `orders` and can legitimately disagree — an order may be `Paid` while still `Processing`. They are never merged into one status.

---

## Conventions

**Money** is stored as integer **minor units** (paise) in every amount field — `products.price`, `orders.totalAmount`, `orders.items[].unitPrice`, `payments.amount`. No float ever reaches a total; conversion happens only at display.

**Timestamps** on every collection.

**Soft delete** on `products` only. Customer-facing queries filter `isDeleted`; admin queries include it.

**Snapshots** in `orders` (`items`, `customerInfo`, `deliveryAddress`) are copies by design and never re-resolved.

---

## Ownership by service

| Collection | Owning service |
|---|---|
| `users` | Auth |
| `products`, `categories` | Product |
| `carts`, `orders` | Order |
| `payments` | Payment |
| `notifications`, `push_subscriptions` | Notification |

A service reads and writes only its own collections. Cross-service data is fetched over HTTP — the Order Service asks the Product Service for prices rather than querying `products` directly. This is what makes the service separation real rather than cosmetic.
