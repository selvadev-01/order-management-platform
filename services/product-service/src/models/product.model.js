/**
 * Product model (US-PROD-1, US-ADMIN-1..4, US-SYS-6).
 *
 * Price is stored in integer MINOR units (paise). No float ever reaches a
 * total; conversion happens only at display.
 */
import mongoose from 'mongoose';

const productSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Name is required'],
      trim: true,
      maxlength: [140, 'Name must be at most 140 characters'],
    },
    description: {
      type: String,
      required: [true, 'Description is required'],
      trim: true,
      maxlength: [2000, 'Description must be at most 2000 characters'],
    },
    price: {
      type: Number,
      required: [true, 'Price is required'],
      min: [1, 'Price must be greater than zero'],
      // Integer minor units — a fractional paise is a data error.
      validate: { validator: Number.isInteger, message: 'Price must be an integer (minor units)' },
    },
    stock: {
      type: Number,
      required: true,
      default: 0,
      // Zero is valid and means out of stock; negative never is. This makes
      // the negative-stock case in US-PDP-4 a defensive fallback, not a state
      // the database can actually hold.
      min: [0, 'Stock cannot be negative'],
      validate: { validator: Number.isInteger, message: 'Stock must be a whole number' },
    },
    category: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Category',
      required: [true, 'Category is required'],
      index: true,
    },
    images: {
      type: [String],
      default: [],
    },
    /**
     * Soft delete (US-ADMIN-4). Customer-facing queries exclude flagged rows;
     * admin queries include them. Keeps carts and order history coherent
     * without a hard delete cascading through the system.
     */
    isDeleted: {
      type: Boolean,
      default: false,
      index: true,
    },
    deletedAt: { type: Date, default: null },
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

// Search (US-PROD-2). Name weighted above description so a name match ranks first.
productSchema.index(
  { name: 'text', description: 'text' },
  { weights: { name: 10, description: 2 }, name: 'product_text' },
);

// Default listing sort.
productSchema.index({ createdAt: -1 });

/** True when the product can be purchased right now. */
productSchema.virtual('inStock').get(function inStock() {
  return this.stock > 0;
});

productSchema.set('toJSON', {
  virtuals: true,
  transform(_doc, ret) {
    ret.id = String(ret._id);
    delete ret._id;
    delete ret.__v;
    return ret;
  },
});

export const Product = mongoose.model('Product', productSchema);
