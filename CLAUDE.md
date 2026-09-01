# CLAUDE.md

Source of truth for this project: `Full-Stack MERN.docx` (Full-Stack MERN Developer — Technical Assessment). This file restates its requirements. Do not add scope beyond it.

## Objective

Build a production-style full-stack web application — a **Mini E-Commerce / Order Management Platform** — where users browse products, add to cart, place an order, make a payment, and receive notifications about their order. The system contains a customer-facing application and backend services.

Must demonstrate practical knowledge of: React.js, Tailwind CSS, Node.js, Express.js, MongoDB, REST APIs, microservice architecture, Redis, BullMQ, payment gateway integration, push notifications, authentication & authorization, error handling, API security, responsive UI, Git and project documentation.

## 1. User Application — React.js + Tailwind CSS

Responsive web app. Required pages:

1. **Login / Register** — register, login, logout, view validation errors, maintain authenticated session. JWT-based authentication.
2. **Product Listing** — display product image, name, description, price, stock availability, category. Implement search, category filtering, pagination, loading state, empty state, error state.
3. **Product Details** — product images, name, description, price, available stock, quantity selector, add to cart.
4. **Shopping Cart** — add products, remove products, increase/decrease quantity, view subtotal, view total, proceed to checkout.

## 2. Checkout & Payment

Checkout page containing: customer information, delivery address, order summary, total amount, payment option.

Integrate a payment gateway such as Razorpay, Stripe, or PayPal. Use test/sandbox mode.

Payment flow:

```
User → Checkout → Create Order → Create Payment → Payment Gateway →
Payment Success → Payment Webhook → Update Order → Queue Notification → Send Notification
```

Do not rely only on the frontend payment-success response. The backend must verify the payment using the gateway webhook/signature mechanism.

## 3. Backend — Node.js + Express.js

REST APIs. Suggested structure:

```
/api/auth  /api/users  /api/products  /api/categories
/api/cart  /api/orders  /api/payments  /api/notifications
```

Implement: request validation, authentication middleware, authorization middleware, centralized error handling, proper HTTP status codes, logging, environment variables, API security.

## 4. MongoDB

Primary database. Suggested collections: `users`, `products`, `categories`, `carts`, `orders`, `payments`, `notifications`.

Example relationship:

```
User
├── Cart
└── Orders
    └── Payment
```

Design appropriate schemas and indexes.

## 5. Microservice Architecture

Backend separated into logical services:

```
React App → API Gateway → [Auth Service | Product Service | Order Service]
                                              ↓
                                       Payment Service
                                              ↓
                                        Redis/BullMQ
                                              ↓
                                    Notification Service
```

Minimum services:

- **Auth Service** — registration, login, JWT authentication, user management
- **Product Service** — products, categories, search, stock
- **Order Service** — cart, orders, order status
- **Payment Service** — payment creation, payment verification, webhook handling, payment status
- **Notification Service** — push notifications, order notifications, payment notifications

Large-scale production infrastructure is not required. The purpose is to demonstrate understanding of service separation and communication.

## 6. Redis

Use Redis for at least two meaningful use cases. Examples:

- **Caching** — cache frequently requested product/category data. Request → Redis → cache hit? return : MongoDB → write to Redis → return.
- **Queue** — Redis as the backend for BullMQ.

## 7. BullMQ

Background jobs, at least two.

- **Order Notification Job** — Order Created → BullMQ Queue → Redis → Worker → Push Notification
- **Additional job** — e.g. payment confirmation, order status notification, email notification, stock update, invoice generation, abandoned-cart notification.

Demonstrate: queue creation, job creation, worker, retry mechanism, failed jobs, job status, delayed jobs.

## 8. Push Notifications

Push notifications for important events:

```
Order Placed → BullMQ → Notification Worker → Push Notification → Customer
```

Possible notifications: order placed successfully, payment successful, order confirmed, order shipped, order delivered. Any suitable push notification technology/service may be used.

## 9. Admin Dashboard

Basic admin dashboard. Admin should be able to:

- **Products** — create, edit, delete product; update stock.
- **Orders** — view order ID, customer, products, amount, payment status, order status, created date. Update status: Pending → Confirmed → Processing → Shipped → Delivered.

## 10. UI/UX Requirements

React.js + Tailwind CSS. Application should be responsive, mobile-friendly, clean, consistent, accessible, easy to navigate.

Required states: loading, error, empty, success, form validation, API failure.

Do not focus heavily on visual complexity — implementation quality and engineering decisions are what is evaluated.

## 11. Security Requirements

Required: password hashing, JWT authentication, protected routes, role-based authorization, environment variables, input validation, payment signature verification, basic rate limiting, CORS configuration, no secrets in Git.

Example roles: `CUSTOMER`, `ADMIN`.

## 12. Suggested Project Structure

Exact structure is up to the candidate; a different architecture is acceptable if justified.

```
project/
├── frontend/
│   ├── src/
│   ├── components/
│   ├── pages/
│   ├── hooks/
│   ├── services/
│   └── utils/
├── services/
│   ├── auth-service/
│   ├── product-service/
│   ├── order-service/
│   ├── payment-service/
│   └── notification-service/
├── workers/
│   ├── notification-worker/
│   └── payment-worker/
├── README.md
└── .env.example
```

## 14. README Requirements

The repository must contain a proper README including:

- **Project Overview** — explain the application.
- **Architecture** — system architecture diagram.
- **Technologies** — React, Tailwind CSS, Node.js, Express.js, MongoDB, Redis, BullMQ, payment gateway, push notification.
- **Installation** — `npm install`, `npm run dev`.
- **Environment Variables** — provide `.env.example`; do not commit actual secrets.
- **API Documentation** — document the important APIs, e.g.:

```
POST /api/auth/register     POST /api/auth/login
GET  /api/products          GET  /api/products/:id
POST /api/cart              GET  /api/cart
POST /api/orders            GET  /api/orders
POST /api/payments/create   POST /api/payments/webhook
```

## 16. Git Requirements

Submit through GitHub/GitLab/Bitbucket with meaningful commits.

Good: `feat: add authentication service`, `feat: implement product APIs`, `feat: add Redis caching`, `feat: implement order queue`, `fix: payment webhook verification`.

Avoid: `final`, `final2`, `latest`, `done`, `test`.

## Assessment Duration

4 days from receiving the requirement to complete and submit.

## Submission

- GitHub repository
- README
- `.env.example`
- Test credentials
- Payment sandbox credentials/instructions
- Demo URL, if available

Do not commit passwords, API keys, payment secrets, JWT secrets, or other sensitive credentials.
