/**
 * Backfill `orderNumber` on orders created before order numbers existed —
 * `npm run backfill:order-numbers`.
 *
 * Orders are numbered in `createdAt` order so the sequence within each day
 * reflects the real placement order, and the daily counters are left pointing
 * past the highest number issued — otherwise the first order placed after this
 * runs would collide with a backfilled one.
 *
 * Safe to re-run: orders that already have a number are skipped, and the
 * counter update takes the max rather than incrementing blindly.
 */
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import { createLogger } from '@oms/shared';

const here = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(here, '../.env') });

const logger = createLogger('backfill-order-numbers');

const { MONGODB_URI } = process.env;

if (!MONGODB_URI) {
  console.error('\nMissing required variable: MONGODB_URI\nCopy .env.example to .env and fill it in.\n');
  process.exit(1);
}

/** Mirrors order-number.js — duplicated so the script runs without the service. */
const dayKey = (date) => date.toISOString().slice(0, 10).replaceAll('-', '');
const formatOrderNumber = (day, seq) => `ORD-${day}-${String(seq).padStart(4, '0')}`;

// Minimal schemas: like the seed, this writes directly rather than importing
// each service's models, so it stays runnable without starting any service.
const Order = mongoose.model(
  'Order',
  new mongoose.Schema({ orderNumber: String, createdAt: Date }, { strict: false, collection: 'orders' }),
);
const Counter = mongoose.model(
  'Counter',
  new mongoose.Schema({ _id: String, seq: Number }, { versionKey: false, collection: 'counters' }),
);

async function main() {
  await mongoose.connect(MONGODB_URI);

  const pending = await Order.find({ orderNumber: { $in: [null, ''] } })
    .select('_id createdAt')
    .sort({ createdAt: 1, _id: 1 })
    .lean();

  if (pending.length === 0) {
    // Still ensure the index: a database whose orders are all numbered — a
    // fresh one included — must carry the constraint that keeps them unique.
    await Order.collection.createIndex({ orderNumber: 1 }, { unique: true });
    logger.info('no orders need backfilling; unique index ensured');
    return;
  }

  logger.info({ count: pending.length }, 'backfilling order numbers');

  /**
   * Seeded from the counters already in the database so a partial previous run
   * continues where it stopped rather than reissuing numbers.
   */
  const seqByDay = new Map();
  for (const c of await Counter.find({ _id: /^order:/ }).lean()) {
    seqByDay.set(c._id.slice('order:'.length), c.seq);
  }

  const ops = [];
  for (const order of pending) {
    // An order with no createdAt cannot be dated; the ObjectId carries its own
    // creation timestamp, which is exactly what is needed here.
    const created = order.createdAt ?? order._id.getTimestamp();
    const day = dayKey(new Date(created));
    const seq = (seqByDay.get(day) ?? 0) + 1;
    seqByDay.set(day, seq);

    ops.push({
      updateOne: {
        filter: { _id: order._id },
        update: { $set: { orderNumber: formatOrderNumber(day, seq) } },
      },
    });
  }

  const result = await Order.bulkWrite(ops, { ordered: false });
  logger.info({ modified: result.modifiedCount }, 'orders numbered');

  /**
   * Advance each day's counter to the highest number issued. `$max` rather than
   * `$set` so a counter already ahead of the backfill is never rewound — that
   * would hand a live order a number this script already used.
   */
  for (const [day, seq] of seqByDay) {
    await Counter.updateOne({ _id: `order:${day}` }, { $max: { seq } }, { upsert: true });
  }
  logger.info({ days: seqByDay.size }, 'daily counters advanced');

  /**
   * The unique index is what enforces the invariant from here on. Created after
   * the backfill, since building it over documents with a null orderNumber
   * would fail on the second such document.
   */
  await Order.collection.createIndex({ orderNumber: 1 }, { unique: true });
  logger.info('unique index on orderNumber ensured');
}

main()
  .then(() => {
    logger.info('backfill complete');
    return mongoose.disconnect();
  })
  .catch(async (err) => {
    logger.error({ err }, 'backfill failed');
    await mongoose.disconnect();
    process.exit(1);
  });
