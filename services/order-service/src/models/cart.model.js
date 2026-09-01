/**
 * Cart model (US-CART-1, US-SYS-6).
 *
 * A cart stores productId and quantity ONLY — no price, no name.
 *
 * This is deliberate and the opposite of the Order model. A cart is an
 * intention, not a contract: prices are resolved live at read time, so the
 * customer always sees what they will actually pay. Storing a price here would
 * let a stale figure reach checkout.
 */
import mongoose from 'mongoose';

const cartItemSchema = new mongoose.Schema(
  {
    productId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
    },
    quantity: {
      type: Number,
      required: true,
      min: [1, 'Quantity must be at least 1'],
      validate: { validator: Number.isInteger, message: 'Quantity must be a whole number' },
    },
  },
  { _id: false },
);

const cartSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      // One cart per user, enforced by the database rather than by convention
      // (docx §4: User ├── Cart).
      unique: true,
      index: true,
    },
    items: {
      type: [cartItemSchema],
      default: [],
    },
  },
  { timestamps: true },
);

/**
 * Add or merge a line.
 *
 * Merging rather than duplicating is enforced here, so the rule holds no
 * matter which screen called the endpoint (US-PDP-3 AC3).
 */
cartSchema.methods.addItem = function addItem(productId, quantity) {
  const id = String(productId);
  const existing = this.items.find((i) => String(i.productId) === id);
  if (existing) {
    existing.quantity += quantity;
    return existing.quantity;
  }
  this.items.push({ productId, quantity });
  return quantity;
};

cartSchema.methods.setQuantity = function setQuantity(productId, quantity) {
  const id = String(productId);
  const line = this.items.find((i) => String(i.productId) === id);
  if (!line) return false;
  line.quantity = quantity;
  return true;
};

cartSchema.methods.removeItem = function removeItem(productId) {
  const id = String(productId);
  const before = this.items.length;
  this.items = this.items.filter((i) => String(i.productId) !== id);
  return this.items.length !== before;
};

export const Cart = mongoose.model('Cart', cartSchema);
