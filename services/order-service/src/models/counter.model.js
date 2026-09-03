/**
 * Atomic sequence counters.
 *
 * One document per counter key — for order numbers the key is the calendar day,
 * e.g. `order:20260903`. `findOneAndUpdate` with `$inc` and `upsert` is a single
 * atomic operation in MongoDB, so two orders placed in the same millisecond by
 * different service instances receive different sequence values. Generating a
 * number by counting existing orders would not hold that guarantee: two readers
 * could see the same count and both write the same number.
 */
import mongoose from 'mongoose';

const counterSchema = new mongoose.Schema(
  {
    _id: { type: String },
    seq: { type: Number, default: 0 },
  },
  { versionKey: false },
);

export const Counter = mongoose.model('Counter', counterSchema);

/**
 * The next value for `key`, starting at 1.
 *
 * `upsert` creates the counter on first use, so no bootstrap step is needed for
 * a new day or a fresh database.
 */
export async function nextSequence(key) {
  const doc = await Counter.findOneAndUpdate(
    { _id: key },
    { $inc: { seq: 1 } },
    { new: true, upsert: true },
  ).lean();
  return doc.seq;
}