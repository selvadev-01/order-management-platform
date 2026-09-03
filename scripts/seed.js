/**
 * Seed script — `npm run seed`.
 *
 * Creates the test accounts and catalogue documented in the README. Safe to
 * re-run: it upserts by natural key rather than duplicating.
 *
 * Credentials come from environment variables, never hard-coded, so this file
 * carries no password even in development (US-SYS-7 AC3).
 */
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import bcrypt from 'bcrypt';
import { Role, toMinor, createLogger } from '@oms/shared';

const here = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(here, '../.env') });

const logger = createLogger('seed');

const {
  MONGODB_URI,
  BCRYPT_SALT_ROUNDS = '12',
  SEED_ADMIN_EMAIL,
  SEED_ADMIN_PASSWORD,
  SEED_CUSTOMER_EMAIL,
  SEED_CUSTOMER_PASSWORD,
} = process.env;

function requireEnv(name, value) {
  if (!value) {
    console.error(`\nMissing required variable: ${name}\nCopy .env.example to .env and fill it in.\n`);
    process.exit(1);
  }
  return value;
}

// Minimal schemas: the seed writes directly rather than importing each
// service's models, so it stays runnable without starting any service.
const userSchema = new mongoose.Schema(
  {
    name: String,
    email: { type: String, lowercase: true, trim: true, unique: true },
    passwordHash: String,
    role: String,
  },
  { timestamps: true },
);

const categorySchema = new mongoose.Schema(
  { name: String, slug: { type: String, unique: true } },
  { timestamps: true },
);

const productSchema = new mongoose.Schema(
  {
    name: String,
    description: String,
    price: Number,
    stock: Number,
    category: { type: mongoose.Schema.Types.ObjectId, ref: 'Category' },
    images: [String],
    isDeleted: { type: Boolean, default: false },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

/**
 * Orders are never seeded — they are created by using the app. This model
 * exists only so the seed can establish the `orderNumber` constraint on a
 * fresh database (see `seedOrderNumbers`).
 */
const orderSchema = new mongoose.Schema(
  { orderNumber: String },
  { strict: false, collection: 'orders' },
);

const User = mongoose.model('User', userSchema);
const Category = mongoose.model('Category', categorySchema);
const Product = mongoose.model('Product', productSchema);
const Order = mongoose.model('Order', orderSchema);

const CATEGORIES = [
  { name: 'Audio & Wearables', slug: 'audio-wearables' },
  { name: 'Home & Kitchen', slug: 'home-kitchen' },
  { name: 'Home Decor', slug: 'home-decor' },
  { name: 'Sports & Outdoors', slug: 'sports-outdoors' },
];

/**
 * Prices are given in major units here for readability and converted to the
 * integer minor units the schema stores.
 *
 * Two products are seeded with stock 0 on purpose, so the out-of-stock states
 * in US-PDP-4 and US-PROD-1 AC3 can be demonstrated without editing data.
 *
 * The last field is the image slug. Each product document stores the resolved
 * URL in its `images` array — the catalogue served to the frontend is entirely
 * DB-driven — while the image files themselves are static assets under
 * `frontend/public/products/`, the role a CDN would play in production.
 *
 * The catalogue is deliberately built around products that have real, matching
 * product photography available (see README "Product images"): a demo storefront
 * showing a stock photo of an unrelated object reads as broken.
 */
const PRODUCTS = [
  ['Over-Ear Wireless Headphones', 'Premium over-ear headphones with active noise cancellation and a 20-hour charge.', 24999, 12, 'audio-wearables', 'airpods-max'],
  ['True Wireless Earbuds', 'Compact in-ear buds with charging case, sweat resistance and one-tap pairing.', 9999, 67, 'audio-wearables', 'wireless-earbuds'],
  ['Smart Speaker with Assistant', 'Room-filling 360° sound with a built-in voice assistant and smart-home hub.', 7999, 24, 'audio-wearables', 'smart-speaker'],
  ['Smart Watch, Gold Finish', 'Fitness and heart-rate tracking with always-on retina display and GPS.', 27999, 33, 'audio-wearables', 'smart-watch'],
  ['10.4" Android Tablet', 'Slim tablet with a 10.4-inch display, 128GB storage and all-day battery.', 22999, 0, 'audio-wearables', 'android-tablet'],
  ['Carbon Steel Wok 30cm', 'Traditional hand-hammered carbon steel wok with a wooden helper handle.', 2499, 40, 'home-kitchen', 'carbon-steel-wok'],
  ['Stainless Steel Pot with Glass Lid', 'Induction-compatible stainless steel pot with a tempered glass lid.', 3299, 22, 'home-kitchen', 'stainless-steel-pot'],
  ['Countertop Microwave Oven', '20-litre microwave with grill function, defrost presets and a child lock.', 7499, 9, 'home-kitchen', 'microwave-oven'],
  ['Immersion Hand Blender', '700W stick blender with variable speed, whisk attachment and beaker.', 2899, 84, 'home-kitchen', 'hand-blender'],
  ['Rotating Spice Rack', 'Two-tier rotating rack with twelve labelled airtight glass spice jars.', 1699, 0, 'home-kitchen', 'spice-rack'],
  ['Ceramic Table Lamp', 'Warm-toned bedside lamp with a fabric shade and inline dimmer switch.', 4199, 9, 'home-decor', 'table-lamp'],
  ['Artificial Showpiece Plant', 'Low-maintenance decorative plant in a ceramic pot, 60cm tall.', 3299, 28, 'home-decor', 'showpiece-plant'],
  ['Graphite Tennis Racket', 'Lightweight graphite frame, 100 sq in head, pre-strung with a comfort grip.', 4299, 6, 'sports-outdoors', 'tennis-racket'],
  ['Indoor/Outdoor Basketball', 'Official size 7 composite-leather ball with deep-channel grip.', 1299, 75, 'sports-outdoors', 'basketball'],
  ['English Willow Cricket Bat', 'Grade-A English willow bat with a short handle and protective toe guard.', 5499, 98, 'sports-outdoors', 'cricket-bat'],
];

/**
 * Where product imagery is served from, and the file extension the assets use.
 * Both are overridable so a deployment can point the catalogue at a CDN without
 * touching the seed data.
 */
const IMAGE_BASE_URL = process.env.SEED_IMAGE_BASE_URL ?? '/products';
const IMAGE_EXT = process.env.SEED_IMAGE_EXT ?? 'webp';

async function seedUsers(rounds) {
  const accounts = [
    {
      name: 'Platform Admin',
      email: requireEnv('SEED_ADMIN_EMAIL', SEED_ADMIN_EMAIL).toLowerCase(),
      password: requireEnv('SEED_ADMIN_PASSWORD', SEED_ADMIN_PASSWORD),
      role: Role.ADMIN,
    },
    {
      name: 'Test Customer',
      email: requireEnv('SEED_CUSTOMER_EMAIL', SEED_CUSTOMER_EMAIL).toLowerCase(),
      password: requireEnv('SEED_CUSTOMER_PASSWORD', SEED_CUSTOMER_PASSWORD),
      role: Role.CUSTOMER,
    },
  ];

  for (const { name, email, password, role } of accounts) {
    const passwordHash = await bcrypt.hash(password, Number(rounds));
    await User.findOneAndUpdate(
      { email },
      { name, email, passwordHash, role },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
    logger.info({ email, role }, 'user seeded');
  }
}

async function seedCatalogue() {
  const bySlug = new Map();
  for (const c of CATEGORIES) {
    const doc = await Category.findOneAndUpdate(
      { slug: c.slug },
      c,
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
    bySlug.set(c.slug, doc._id);
  }
  logger.info({ count: CATEGORIES.length }, 'categories seeded');

  // Categories carry no soft-delete flag and the listing endpoint returns them
  // all, so a superseded one would show up as a filter chip matching nothing.
  const staleCategories = await Category.deleteMany({
    slug: { $nin: CATEGORIES.map((c) => c.slug) },
  });
  if (staleCategories.deletedCount) {
    logger.info({ count: staleCategories.deletedCount }, 'stale categories removed');
  }

  for (const [name, description, priceMajor, stock, slug, imageSlug] of PRODUCTS) {
    await Product.findOneAndUpdate(
      { name },
      {
        name,
        description,
        price: toMinor(priceMajor),
        stock,
        category: bySlug.get(slug),
        images: [`${IMAGE_BASE_URL}/${imageSlug}.${IMAGE_EXT}`],
        isDeleted: false,
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
  }
  logger.info({ count: PRODUCTS.length }, 'products seeded');

  // Soft-delete anything not in the current catalogue, so re-seeding after the
  // product list changes leaves no orphaned rows on the storefront. Soft rather
  // than hard delete: existing orders snapshot their line items but still
  // reference the product, and admin views expect the document to survive.
  const retired = await Product.updateMany(
    { name: { $nin: PRODUCTS.map(([name]) => name) }, isDeleted: { $ne: true } },
    { isDeleted: true, deletedAt: new Date() },
  );
  if (retired.modifiedCount) {
    logger.info({ count: retired.modifiedCount }, 'superseded products retired');
  }
}

/**
 * Prepare the order-number constraint (see README "Two order identifiers").
 *
 * The seed creates no orders, but it is the step that readies a database, and
 * a database without this index can let two orders share a customer-facing
 * reference. Creating it here means a fresh install is correct after `npm run
 * seed` alone, with no second command to remember.
 *
 * Existing orders written before order numbers existed are NOT numbered here —
 * that is `npm run backfill:order-numbers`, which is deliberately separate
 * because it rewrites live data. The index build is what would fail on such a
 * database, so it is reported as a clear instruction rather than a stack trace.
 */
async function seedOrderNumbers() {
  const unnumbered = await Order.countDocuments({ orderNumber: { $in: [null, ''] } });

  if (unnumbered > 0) {
    logger.warn(
      { unnumbered },
      'orders without an order number found — run `npm run backfill:order-numbers`, then re-run the seed',
    );
    return;
  }

  await Order.collection.createIndex({ orderNumber: 1 }, { unique: true });
  logger.info('order number index ensured');
}

async function main() {
  await mongoose.connect(requireEnv('MONGODB_URI', MONGODB_URI), {
    serverSelectionTimeoutMS: 5000,
  });
  logger.info({ db: mongoose.connection.name }, 'mongodb connected');

  await seedUsers(BCRYPT_SALT_ROUNDS);
  await seedCatalogue();
  await seedOrderNumbers();

  const [users, categories, products, outOfStock] = await Promise.all([
    User.countDocuments(),
    Category.countDocuments(),
    Product.countDocuments(),
    Product.countDocuments({ stock: 0 }),
  ]);

  logger.info({ users, categories, products, outOfStock }, 'seed complete');
  await mongoose.disconnect();
}

main().catch(async (err) => {
  logger.fatal({ err }, 'seed failed');
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
