/**
 * Product business logic: querying, caching, and cache invalidation.
 *
 * Kept out of the controllers so the cache-aside path and the invalidation
 * contract live in one place — the admin write paths cannot forget to
 * invalidate, because they call through here (US-PROD-6 AC3).
 */
import { notFound, paginated, clampPage, paginationToSkipLimit, cacheKeys } from '@oms/shared';
import { Product } from './models/product.model.js';
import { Category } from './models/category.model.js';

/** Fields the listing needs. Full description and image array are detail-only. */
const LIST_PROJECTION = 'name description price stock category images createdAt';

/**
 * Build the Mongo filter from validated query params.
 *
 * Search and category compose into ONE query (AND), rather than one replacing
 * the other (US-PROD-3 edge case).
 */
function buildFilter({ search, category, includeDeleted = false }) {
  const filter = {};
  if (!includeDeleted) filter.isDeleted = { $ne: true };
  if (category) filter.category = category;
  if (search) filter.$text = { $search: search };
  return filter;
}

function buildSort(sort, hasSearch) {
  switch (sort) {
    case 'price_asc':
      return { price: 1, _id: 1 };
    case 'price_desc':
      return { price: -1, _id: 1 };
    case 'relevance':
      return hasSearch ? { score: { $meta: 'textScore' }, _id: 1 } : { createdAt: -1, _id: 1 };
    default:
      // _id breaks ties so ordering is stable across pages (US-PROD-4).
      return { createdAt: -1, _id: 1 };
  }
}

export class ProductService {
  constructor({ cache, logger }) {
    this.cache = cache;
    this.logger = logger;
  }

  /**
   * Paginated product list.
   *
   * Searches are deliberately NOT cached: the key space is unbounded and the
   * hit rate would be poor (US-PROD-2 technical notes).
   */
  async list(params) {
    const load = () => this.#queryList(params);
    if (params.search) return load();
    return this.cache.wrap(cacheKeys.productList(params), load);
  }

  async #queryList({ page, limit, search, category, sort }) {
    const filter = buildFilter({ search, category });
    const total = await Product.countDocuments(filter);

    // Clamp AFTER the count: a page beyond the end returns the last page
    // rather than an empty grid (US-PROD-4 edge case).
    const safePage = clampPage(page, total, limit);
    const { skip } = paginationToSkipLimit({ page: safePage, limit });

    const query = Product.find(filter, search ? { score: { $meta: 'textScore' } } : undefined)
      .select(LIST_PROJECTION)
      .populate('category', 'name slug')
      .sort(buildSort(sort, Boolean(search)))
      .skip(skip)
      .limit(limit)
      .lean();

    const docs = await query;
    return paginated(docs.map(shape), { page: safePage, limit, total });
  }

  /** Single product, cached by id. */
  async getById(id) {
    const cached = await this.cache.wrap(cacheKeys.product(id), async () => {
      const doc = await Product.findOne({ _id: id, isDeleted: { $ne: true } })
        .populate('category', 'name slug')
        .lean();
      return doc ? shape(doc) : null;
    });

    if (!cached) throw notFound('Product not found');
    return cached;
  }

  /** Categories change rarely and are read constantly — a strong cache fit. */
  async listCategories(ttlSeconds) {
    return this.cache.wrap(
      cacheKeys.categoriesAll(),
      async () => {
        const docs = await Category.find().sort({ name: 1 }).lean();
        return docs.map((c) => ({ id: String(c._id), name: c.name, slug: c.slug }));
      },
      { ttlSeconds },
    );
  }

  /**
   * Invalidate everything a write could have affected.
   *
   * Both the specific product key AND the list keys must go — invalidating
   * only one is the common bug this method exists to prevent
   * (US-ADMIN-2 AC4).
   */
  async invalidateProduct(id) {
    await Promise.all([
      id ? this.cache.del(cacheKeys.product(String(id))) : Promise.resolve(),
      this.cache.delPattern(cacheKeys.productListPattern()),
    ]);
  }

  async invalidateCategories() {
    await this.cache.del(cacheKeys.categoriesAll());
  }
}

/** One shape for products on the wire, so list and detail cannot drift. */
function shape(doc) {
  return {
    id: String(doc._id),
    name: doc.name,
    description: doc.description,
    price: doc.price,
    stock: doc.stock,
    inStock: doc.stock > 0,
    category: doc.category
      ? { id: String(doc.category._id ?? doc.category), name: doc.category.name, slug: doc.category.slug }
      : null,
    images: doc.images ?? [],
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}
