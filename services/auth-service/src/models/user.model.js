/**
 * User model (US-AUTH-1, US-SYS-6).
 *
 * The password is hashed in a pre-save hook rather than in the controller, so
 * a plaintext password cannot reach the database by any code path — including
 * the seed script.
 */
import mongoose from 'mongoose';
import bcrypt from 'bcrypt';
import { Role } from '@oms/shared';

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Name is required'],
      trim: true,
      minlength: [2, 'Name must be at least 2 characters'],
      maxlength: [80, 'Name must be at most 80 characters'],
    },
    email: {
      type: String,
      required: [true, 'Email is required'],
      // Normalised so ' User@Ex.com ' collides with 'user@ex.com'
      // (US-AUTH-1 edge case).
      lowercase: true,
      trim: true,
      unique: true,
      index: true,
    },
    passwordHash: {
      type: String,
      required: true,
      // Never returned by a query unless explicitly selected, so it cannot
      // leak through a controller that forgets to strip it (US-AUTH-1 AC4).
      select: false,
    },
    role: {
      type: String,
      enum: Object.values(Role),
      default: Role.CUSTOMER,
      index: true,
    },
  },
  {
    timestamps: true,
    toJSON: {
      transform(_doc, ret) {
        delete ret.passwordHash;
        delete ret.__v;
        return ret;
      },
    },
  },
);

/**
 * Hash on save. `passwordHash` holds the plaintext when set by a caller; this
 * hook replaces it with the bcrypt digest before it is persisted.
 */
userSchema.pre('save', async function hashPassword(next) {
  if (!this.isModified('passwordHash')) return next();
  try {
    const rounds = Number(process.env.BCRYPT_SALT_ROUNDS ?? 12);
    this.passwordHash = await bcrypt.hash(this.passwordHash, rounds);
    next();
  } catch (err) {
    next(err);
  }
});

userSchema.methods.verifyPassword = function verifyPassword(plaintext) {
  return bcrypt.compare(plaintext, this.passwordHash);
};

export const User = mongoose.model('User', userSchema);
