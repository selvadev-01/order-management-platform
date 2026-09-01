/**
 * Product and category controllers.
 *
 * Read paths: US-PROD-1..4, US-PDP-1.
 * Admin write paths: US-ADMIN-1..5 — each invalidates the cache it affects.
 */
import { notFound, badRequest, conflict } from '@oms/shared';
import { Product } from './models/product.model.js';
import { Category, slugify } from './models/category.model.js';

export function buildControllers({ service, config }) {
  return {
    /** GET /api/products — public, paginated, searchable, filterable. */
    async listProducts(req, res) {
      // Validate the category exists rather than silently returning nothing;
      // an unknown category falls back to the full catalogue (US-PROD-3 edge case).
      if (req.query.category) {
        const exists = await Category.exists({ _id: req.query.category });
        if (!exists) delete req.query.category;
      }
      res.json(await service.list(req.query));
    },

    /** GET /api/products/:id — public. */
    async getProduct(req, res) {
      res.json({ product: await service.getById(req.params.id) });
    },

    /** GET /api/categories — public, cached. */
    async listCategories(req, res) {
      res.json({ categories: await service.listCategories(config.CATEGORY_CACHE_TTL_SECONDS) });
    },

    /** POST /api/products — ADMIN. */
    async createProduct(req, res) {
      const category = await Category.findById(req.body.category);
      if (!category) throw badRequest('Category not found', [
        { field: 'category', message: 'No such category' },
      ]);

      const product = await Product.create(req.body);
      await service.invalidateProduct(product._id);

      req.log?.info({ productId: String(product._id), adminId: req.user.id }, 'product created');
      res.status(201).json({ product: await service.getById(String(product._id)) });
    },

    /** PUT /api/products/:id — ADMIN. */
    async updateProduct(req, res) {
      if (req.body.category) {
        const exists = await Category.exists({ _id: req.body.category });
        if (!exists) throw badRequest('Category not found', [
          { field: 'category', message: 'No such category' },
        ]);
      }

      const product = await Product.findOneAndUpdate(
        { _id: req.params.id, isDeleted: { $ne: true } },
        req.body,
        { new: true, runValidators: true },
      );
      if (!product) throw notFound('Product not found');

      await service.invalidateProduct(product._id);
      req.log?.info({ productId: String(product._id), adminId: req.user.id }, 'product updated');
      res.json({ product: await service.getById(String(product._id)) });
    },

    /** PATCH /api/products/:id/stock — ADMIN. The highest-frequency admin action. */
    async updateStock(req, res) {
      const product = await Product.findOneAndUpdate(
        { _id: req.params.id, isDeleted: { $ne: true } },
        { stock: req.body.stock },
        { new: true, runValidators: true },
      );
      if (!product) throw notFound('Product not found');

      await service.invalidateProduct(product._id);
      req.log?.info(
        { productId: String(product._id), stock: product.stock, adminId: req.user.id },
        'stock updated',
      );
      res.json({ product: await service.getById(String(product._id)) });
    },

    /**
     * DELETE /api/products/:id — ADMIN, soft delete.
     *
     * Idempotent: deleting an already-deleted product succeeds rather than
     * erroring (US-ADMIN-4 edge case).
     */
    async deleteProduct(req, res) {
      const product = await Product.findById(req.params.id);
      if (!product) throw notFound('Product not found');

      if (!product.isDeleted) {
        product.isDeleted = true;
        product.deletedAt = new Date();
        await product.save();
        await service.invalidateProduct(product._id);
        req.log?.info({ productId: String(product._id), adminId: req.user.id }, 'product deleted');
      }

      res.status(204).send();
    },

    /** GET /api/products/admin/all — ADMIN, includes soft-deleted rows. */
    async listProductsAdmin(req, res) {
      const { page, limit } = req.query;
      const total = await Product.countDocuments({});
      const docs = await Product.find({})
        .populate('category', 'name slug')
        .sort({ createdAt: -1, _id: 1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean();

      res.json({
        items: docs.map((d) => ({
          id: String(d._id),
          name: d.name,
          price: d.price,
          stock: d.stock,
          category: d.category ? { id: String(d.category._id), name: d.category.name } : null,
          isDeleted: Boolean(d.isDeleted),
          createdAt: d.createdAt,
        })),
        page,
        limit,
        total,
        totalPages: total === 0 ? 0 : Math.ceil(total / limit),
      });
    },

    /** POST /api/categories — ADMIN. */
    async createCategory(req, res) {
      const slug = slugify(req.body.name);
      if (await Category.exists({ slug })) {
        throw conflict('A category with that name already exists', [
          { field: 'name', message: 'Already exists' },
        ]);
      }

      const category = await Category.create({ name: req.body.name, slug });
      await service.invalidateCategories();

      req.log?.info({ categoryId: String(category._id), adminId: req.user.id }, 'category created');
      res.status(201).json({ category: category.toJSON() });
    },

    /**
     * GET /api/products/:id/stock — internal.
     *
     * The Order Service calls this to check stock rather than reading the
     * products collection directly, keeping the service boundary real
     * (US-SYS-5 AC3).
     */
    async getStock(req, res) {
      const product = await Product.findOne({ _id: req.params.id, isDeleted: { $ne: true } })
        .select('name price stock')
        .lean();
      if (!product) throw notFound('Product not found');

      res.json({
        id: String(product._id),
        name: product.name,
        price: product.price,
        stock: product.stock,
      });
    },
  };
}
