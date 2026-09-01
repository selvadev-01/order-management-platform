/**
 * Product management (US-ADMIN-1..5).
 *
 * Every action is enforced server-side by requireRole(ADMIN); this screen is a
 * convenience, not the control.
 *
 * The form lives in a modal rather than pushing the table down the page, so the
 * list stays as context while editing, and create/edit remain one component in
 * two modes — they cannot drift apart.
 */
import { useEffect, useMemo, useState } from 'react';
import { api, qs } from '../../services/api';
import { useFetch, useDebounced } from '../../hooks/useFetch';
import { useToast } from '../../context/ToastContext';
import { formatMoney } from '../../utils/format';
import { stockBadge } from '../../utils/status';
import { Spinner, EmptyState, FormError } from '../../components/States';
import {
  PageHeader, Toolbar, SearchInput, Pagination, Modal, ConfirmDialog,
} from '../../components/admin/Primitives';
import DataTable, { CellStack, CellActions, IconButton } from '../../components/admin/DataTable';
import Field from '../../components/admin/Field';
import { PlusIcon, EditIcon, TrashIcon, SearchIcon } from '../../components/Icons';
import { useDocumentTitle } from "../../hooks/useDocumentTitle";

const BLANK = { name: '', description: '', price: '', stock: '0', category: '', images: '' };
const LOW_STOCK = 5;

/** Create and edit, one component. `product` null means create. */
function ProductForm({ open, product, categories, onClose, onSaved }) {
  const editing = Boolean(product);
  const toast = useToast();
  const [form, setForm] = useState(BLANK);
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setForm(
      product
        ? {
            name: product.name ?? '',
            description: product.description ?? '',
            // Stored in minor units; edited in major units.
            price: product.price != null ? String(product.price / 100) : '',
            stock: String(product.stock ?? 0),
            category: product.category?.id ?? '',
            images: (product.images ?? []).join('\n'),
          }
        : BLANK,
    );
    setErrors({});
    setFormError(null);
  }, [open, product]);

  const change = (e) => {
    const { name, value } = e.target;
    setForm((f) => ({ ...f, [name]: value }));
    // Clearing on edit means the message goes away as soon as the user acts on
    // it, rather than nagging while they retype.
    setErrors((x) => ({ ...x, [name]: undefined }));
  };

  const validate = () => {
    const next = {};
    if (form.name.trim().length < 2) next.name = 'Name must be at least 2 characters';
    if (!form.description.trim()) next.description = 'Description is required';
    const price = Number(form.price);
    if (!Number.isFinite(price) || price <= 0) next.price = 'Price must be greater than zero';
    const stock = Number(form.stock);
    if (!Number.isInteger(stock) || stock < 0) next.stock = 'Stock must be zero or a whole number';
    if (!form.category) next.category = 'Choose a category';
    return next;
  };

  const submit = async (e) => {
    e.preventDefault();
    const invalid = validate();
    if (Object.keys(invalid).length) {
      setErrors(invalid);
      // Focus the first field in error, so the fix is one keystroke away.
      const firstKey = ['name', 'description', 'price', 'stock', 'category']
        .find((k) => invalid[k]);
      document.querySelector(`[name="${firstKey}"]`)?.focus();
      return;
    }

    setSaving(true);
    setFormError(null);
    const body = {
      name: form.name.trim(),
      description: form.description.trim(),
      // Converted to integer minor units at the boundary.
      price: Math.round(Number(form.price) * 100),
      stock: Number(form.stock),
      category: form.category,
      images: form.images.split('\n').map((s) => s.trim()).filter(Boolean),
    };

    try {
      if (editing) await api.put(`/api/products/${product.id}`, body);
      else await api.post('/api/products', body);
      toast.success(editing ? 'Product updated' : 'Product created');
      onSaved();
    } catch (err) {
      setFormError(err.message);
      setErrors(err.fieldErrors ?? {});
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={saving ? () => {} : onClose}
      size="lg"
      title={editing ? 'Edit product' : 'New product'}
      description={editing ? product.name : 'Add an item to the catalogue.'}
      footer={
        <>
          <button type="button" onClick={onClose} disabled={saving} className="btn-secondary">
            Cancel
          </button>
          <button type="submit" form="product-form" disabled={saving} className="btn-primary">
            {saving && <Spinner />}
            {saving ? 'Saving…' : editing ? 'Save changes' : 'Create product'}
          </button>
        </>
      }
    >
      <form id="product-form" onSubmit={submit} className="space-y-4" noValidate>
        <FormError message={formError} />

        <Field label="Name" name="name" value={form.name} onChange={change} error={errors.name} required />

        <Field
          as="textarea"
          rows={3}
          label="Description"
          name="description"
          value={form.description}
          onChange={change}
          error={errors.description}
          required
        />

        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Price (₹)"
            name="price"
            type="number"
            min="0.01"
            step="0.01"
            inputMode="decimal"
            value={form.price}
            onChange={change}
            error={errors.price}
            required
          />
          <Field
            label="Stock"
            name="stock"
            type="number"
            min="0"
            step="1"
            inputMode="numeric"
            value={form.stock}
            onChange={change}
            error={errors.stock}
            required
          />
        </div>

        <Field
          as="select"
          label="Category"
          name="category"
          value={form.category}
          onChange={change}
          error={errors.category}
          required
          options={[
            { value: '', label: 'Choose a category…' },
            ...categories.map((c) => ({ value: c.id, label: c.name })),
          ]}
        />

        <Field
          as="textarea"
          rows={2}
          label="Image URLs"
          name="images"
          value={form.images}
          onChange={change}
          hint="One URL per line. Optional — a placeholder is shown if left empty."
          placeholder="https://…"
        />
      </form>
    </Modal>
  );
}

/** Inline stock editor. The highest-frequency admin action (US-ADMIN-3). */
function StockCell({ product, onSave, busy }) {
  const [draft, setDraft] = useState(null);
  const dirty = draft != null && Number(draft) !== product.stock;

  return (
    <div className="flex items-center gap-2">
      <label htmlFor={`stock-${product.id}`} className="sr-only">
        Stock for {product.name}
      </label>
      <input
        id={`stock-${product.id}`}
        type="number"
        min="0"
        inputMode="numeric"
        className="input h-9 w-20 py-0 tabular-nums"
        value={draft ?? product.stock}
        onChange={(e) => setDraft(e.target.value)}
        disabled={product.isDeleted || busy}
      />
      {dirty ? (
        <button
          type="button"
          onClick={() => onSave(product.id, draft, () => setDraft(null))}
          disabled={busy}
          className="btn-primary h-9 px-3 py-0 text-xs"
        >
          {busy && <Spinner />}
          Save
        </button>
      ) : (
        product.stock <= LOW_STOCK && !product.isDeleted && (
          <span className={`${stockBadge(product.stock, { lowAt: LOW_STOCK })} whitespace-nowrap`}>
            {product.stock === 0 ? 'Out' : 'Low'}
          </span>
        )
      )}
    </div>
  );
}

export default function Products() {
  useDocumentTitle("Products · Admin");
  const toast = useToast();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState(null); // null | 'new' | product
  const [deleting, setDeleting] = useState(null);
  const [busy, setBusy] = useState(false);

  // Debounced so typing does not fire a request per keystroke (US-PROD-2 AC5).
  const query = useDebounced(search, 300);

  const { data: catData } = useFetch(({ signal }) => api.get('/api/categories', { signal }), []);
  const { data, state, error, refetch } = useFetch(
    ({ signal }) => api.get(`/api/products/admin/all${qs({ page, limit: 20 })}`, { signal }),
    [page],
  );

  const categories = catData?.categories ?? [];
  const all = data?.items ?? [];

  /**
   * Filtered client-side: the admin listing endpoint takes no search parameter,
   * and a page of 20 is small enough that filtering here is honest rather than
   * misleading — it narrows the current page, which the empty state says.
   */
  const items = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return all;
    return all.filter(
      (p) => p.name?.toLowerCase().includes(q) || p.category?.name?.toLowerCase().includes(q),
    );
  }, [all, query]);

  const saveStock = async (id, value, clear) => {
    const stock = Number(value);
    if (!Number.isInteger(stock) || stock < 0) {
      toast.error('Stock must be zero or a positive whole number');
      return;
    }
    setBusy(true);
    try {
      await api.patch(`/api/products/${id}/stock`, { stock });
      clear();
      toast.success('Stock updated');
      refetch();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  const confirmDelete = async () => {
    setBusy(true);
    try {
      await api.del(`/api/products/${deleting.id}`);
      toast.success(`${deleting.name} deleted`);
      setDeleting(null);
      refetch();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  const columns = [
    {
      key: 'name',
      header: 'Product',
      mobile: 'title',
      className: 'max-w-xs',
      cell: (p) => (
        <div className="min-w-0">
          <CellStack primary={p.name} secondary={p.description} />
          {p.isDeleted && <span className="badge badge-neutral mt-1">Deleted</span>}
        </div>
      ),
    },
    {
      key: 'category',
      header: 'Category',
      mobile: 'meta',
      cell: (p) => <span className="text-content-secondary">{p.category?.name ?? 'Uncategorised'}</span>,
    },
    {
      key: 'price',
      header: 'Price',
      align: 'right',
      mobile: 'trailing',
      cell: (p) => <span className="font-medium tabular-nums">{formatMoney(p.price)}</span>,
    },
    {
      key: 'stock',
      header: 'Stock',
      mobile: 'badge',
      cell: (p) => <StockCell product={p} onSave={saveStock} busy={busy} />,
    },
    {
      key: 'actions',
      header: <span className="sr-only">Actions</span>,
      align: 'right',
      mobile: 'actions',
      cell: (p) => (
        <CellActions>
          <IconButton
            icon={EditIcon}
            label={`Edit ${p.name}`}
            onClick={() => setEditing(p)}
            disabled={p.isDeleted}
          />
          <IconButton
            icon={TrashIcon}
            label={`Delete ${p.name}`}
            tone="danger"
            onClick={() => setDeleting(p)}
            disabled={p.isDeleted}
          />
        </CellActions>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Products"
        description="Create, edit, restock and remove catalogue items."
        actions={
          <button type="button" onClick={() => setEditing('new')} className="btn-primary">
            <PlusIcon className="h-4 w-4" />
            New product
          </button>
        }
      />

      <Toolbar>
        <SearchInput
          value={search}
          onChange={(v) => setSearch(v)}
          placeholder="Filter this page by name or category…"
          label="Filter products"
        />
        {data?.total != null && (
          <p className="ml-auto text-sm tabular-nums text-content-muted">
            {items.length} of {all.length} shown · {data.total} total
          </p>
        )}
      </Toolbar>

      <DataTable
        caption="Catalogue products"
        columns={columns}
        rows={items}
        rowKey={(p) => p.id}
        state={state}
        error={error}
        onRetry={refetch}
        rowClassName={(p) => (p.isDeleted ? 'opacity-60' : '')}
        empty={
          query ? (
            <EmptyState
              icon={SearchIcon}
              title={`No match for “${query}”`}
              message="Nothing on this page matches. Try another term, clear the filter, or check another page."
              action={
                <button type="button" onClick={() => setSearch('')} className="btn-secondary">
                  Clear filter
                </button>
              }
            />
          ) : (
            <EmptyState
              title="No products yet"
              message="Create the first catalogue item."
              action={
                <button type="button" onClick={() => setEditing('new')} className="btn-primary">
                  <PlusIcon className="h-4 w-4" />
                  New product
                </button>
              }
            />
          )
        }
      />

      {/*
        * The filter is client-side over the current page only, so the pager
        * stays visible while filtering — hiding it would strand an admin
        * searching for a product that lives on another page, with no sign that
        * other pages exist.
        */}
      {query && data?.totalPages > 1 && (
        <p className="mt-6 text-center text-sm text-content-muted">
          Filtering this page only — use the pager to search the rest.
        </p>
      )}
      <Pagination
        page={data?.page ?? page}
        totalPages={data?.totalPages}
        onChange={setPage}
      />

      <ProductForm
        open={Boolean(editing)}
        product={editing === 'new' ? null : editing}
        categories={categories}
        onClose={() => setEditing(null)}
        onSaved={() => { setEditing(null); refetch(); }}
      />

      <ConfirmDialog
        open={Boolean(deleting)}
        busy={busy}
        title="Delete product?"
        message={`“${deleting?.name}” will be removed from the catalogue. Existing orders keep their record of it.`}
        confirmLabel="Delete product"
        onCancel={() => setDeleting(null)}
        onConfirm={confirmDelete}
      />
    </div>
  );
}
