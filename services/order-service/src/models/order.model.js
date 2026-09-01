/**
 * Order model (US-PAY-1, US-SYS-6).
 *
 * An order stores a SNAPSHOT of each item — name, unit price, quantity — as
 * they were at purchase.
 *
 * This is the opposite of the Cart model, deliberately. A placed order is
 * immutable history: the customer paid a specific amount for specifically
 * described goods. If it referenced products, editing one would retroactively
 * rewrite what someone bought, and deleting one would corrupt the record.
 * This is why a deleted product breaks neither the cart nor past orders.
 */
import mongoose from 'mongoose';
import { OrderStatus, PaymentStatus } from '@oms/shared';

const orderItemSchema = new mongoose.Schema(
  {
    productId: { type: mongoose.Schema.Types.ObjectId, required: true },
    // Snapshot fields — never re-resolved from the catalogue.
    name: { type: String, required: true },
    unitPrice: { type: Number, required: true, min: 0 },
    quantity: { type: Number, required: true, min: 1 },
    lineTotal: { type: Number, required: true, min: 0 },
  },
  { _id: false },
);

const customerInfoSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, lowercase: true, trim: true },
    phone: { type: String, required: true, trim: true },
  },
  { _id: false },
);

const addressSchema = new mongoose.Schema(
  {
    line1: { type: String, required: true, trim: true },
    line2: { type: String, default: '', trim: true },
    city: { type: String, required: true, trim: true },
    state: { type: String, required: true, trim: true },
    postalCode: { type: String, required: true, trim: true },
    country: { type: String, required: true, trim: true, default: 'India' },
  },
  { _id: false },
);

const orderSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
    items: {
      type: [orderItemSchema],
      required: true,
      validate: { validator: (v) => v.length > 0, message: 'An order must contain at least one item' },
    },
    // Server-computed from live prices; a client-supplied total is ignored.
    totalAmount: { type: Number, required: true, min: 0 },
    currency: { type: String, default: 'INR' },
    customerInfo: { type: customerInfoSchema, required: true },
    deliveryAddress: { type: addressSchema, required: true },
    orderStatus: {
      type: String,
      enum: Object.values(OrderStatus),
      default: OrderStatus.PENDING,
      index: true,
    },
    paymentStatus: {
      type: String,
      enum: Object.values(PaymentStatus),
      default: PaymentStatus.PENDING,
      index: true,
    },
    // Set by the Payment Service once a webhook verifies.
    paymentId: { type: mongoose.Schema.Types.ObjectId, default: null },
    statusHistory: [
      {
        status: String,
        at: { type: Date, default: Date.now },
        by: mongoose.Schema.Types.ObjectId,
        _id: false,
      },
    ],
  },
  {
    timestamps: true,
    toJSON: {
      transform(_doc, ret) {
        ret.id = String(ret._id);
        delete ret._id;
        delete ret.__v;
        return ret;
      },
    },
  },
);

// Serves the customer's order list and its sort in one index (US-PAY-5).
orderSchema.index({ userId: 1, createdAt: -1 });
// Admin listing, newest first.
orderSchema.index({ createdAt: -1 });

export const Order = mongoose.model('Order', orderSchema);
