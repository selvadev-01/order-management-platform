/**
 * Category management.
 *
 * The API supports create and list only — there is no update or delete
 * endpoint, and this screen does not pretend otherwise: it offers exactly what
 * the server can do, with the product count each category carries so an admin
 * can see which are actually in use.
 */
import { useMemo, useState } from 'react';
import { api, qs } from '../../services/api';
import { useFetch } from '../../hooks/useFetch';
import { useToast } from '../../context/ToastContext';
import { Spinner, EmptyState, FormError } from '../../components/States';
import { PageHeader, Modal } from '../../components/admin/Primitives';
import DataTable from '../../components/admin/DataTable';
import Field from '../../components/admin/Field';
import { AlertIcon, CategoriesIcon, PlusIcon } from '../../components/Icons';
import { useDocumentTitle } from "../../hooks/useDocumentTitle";

function CategoryForm({ open, onClose, onSaved }) {
  const toast = useToast();
  const [name, setName] = useState('');
  const [error, setError] = useState(null);
  const [formError, setFormError] = useState(null);
  const [saving, setSaving] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    // Mirrors createCategorySchema on the server (2–60 characters).
    const trimmed = name.trim();
    if (trimmed.length < 2) {
      setError('Name must be at least 2 characters');
      return;
    }
    if (trimmed.length > 60) {
      setError('Name must be 60 characters or fewer');
      return;
    }

    setSaving(true);
    setFormError(null);
    try {
      await api.post('/api/categories', { name: trimmed });
      toast.success(`Category “${trimmed}” created`);
      setName('');
      onSaved();
    } catch (err) {
      setFormError(err.message);
      setError(err.fieldErrors?.name);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={saving ? () => {} : onClose}
      size="sm"
      title="New category"
      description="Products are grouped by category in the storefront filter."
      footer={
        <>
          <button type="button" onClick={onClose} disabled={saving} className="btn-secondary">
            Cancel
          </button>
          <button type="submit" form="category-form" disabled={saving} className="btn-primary">
            {saving && <Spinner />}
            {saving ? 'Creating…' : 'Create category'}
          </button>
        </>
      }
    >
      <form id="category-form" onSubmit={submit} className="space-y-4" noValidate>
        <FormError message={formError} />
        <Field
          label="Name"
          name="name"
          value={name}
          onChange={(e) => { setName(e.target.value); setError(null); }}
          error={error}
          hint="Between 2 and 60 characters, e.g. “Kitchen”."
          required
          maxLength={60}
        />
      </form>
    </Modal>
  );
}

export default function Categories() {
  useDocumentTitle("Categories · Admin");
  const [creating, setCreating] = useState(false);

  const categories = useFetch(({ signal }) => api.get('/api/categories', { signal }), []);
  // A wide page of products, purely to count how many sit in each category.
  const products = useFetch(
    ({ signal }) => api.get(`/api/products/admin/all${qs({ page: 1, limit: 200 })}`, { signal }),
    [],
  );

  const rows = useMemo(() => {
    const list = categories.data?.categories ?? [];
    const items = products.data?.items ?? [];
    return list.map((c) => {
      const owned = items.filter((p) => p.category?.id === c.id && !p.isDeleted);
      return {
        ...c,
        productCount: owned.length,
        // Total stock is the useful second figure: a category with products but
        // no stock is a different problem from an empty one.
        stock: owned.reduce((sum, p) => sum + (p.stock ?? 0), 0),
      };
    });
  }, [categories.data, products.data]);

  // Counts depend on the product request too, so the table waits for both.
  const countsPending = products.state === 'loading';
  // If that request failed, the derived figures would all be 0 — which reads as
  // a fact about the catalogue rather than a failure to load it.
  const countsFailed = products.state === 'error';

  const columns = [
    {
      key: 'name',
      header: 'Category',
      mobile: 'title',
      cell: (c) => (
        <div className="flex items-center gap-2.5">
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-primary-soft text-primary-text">
            <CategoriesIcon className="h-4 w-4" />
          </span>
          <span className="font-medium text-content">{c.name}</span>
        </div>
      ),
    },
    {
      key: 'slug',
      header: 'Slug',
      mobile: 'meta',
      cell: (c) => <code className="text-xs text-content-muted">{c.slug ?? '—'}</code>,
    },
    {
      key: 'products',
      header: 'Products',
      align: 'right',
      mobile: 'trailing',
      cell: (c) =>
        countsPending ? (
          <span className="inline-block h-4 w-8 animate-pulse rounded bg-surface-active align-middle" />
        ) : countsFailed ? (
          <span className="text-content-subtle">—</span>
        ) : (
          <span className="tabular-nums text-content-secondary">{c.productCount}</span>
        ),
    },
    {
      key: 'stock',
      header: 'Units in stock',
      align: 'right',
      mobile: 'badge',
      cell: (c) =>
        countsPending ? (
          <span className="inline-block h-4 w-10 animate-pulse rounded bg-surface-active align-middle" />
        ) : countsFailed ? (
          <span className="text-content-subtle">—</span>
        ) : (
          <span className="tabular-nums text-content-muted">{c.stock}</span>
        ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Categories"
        description="Groupings used by the storefront filter."
        actions={
          <button type="button" onClick={() => setCreating(true)} className="btn-primary">
            <PlusIcon className="h-4 w-4" />
            New category
          </button>
        }
      />

      {countsFailed && (
        <div
          className="mb-4 flex items-center gap-2.5 rounded-lg border border-warning-border bg-warning-soft px-3.5 py-2.5 text-sm text-warning-text"
          role="status"
        >
          <AlertIcon className="h-4 w-4 shrink-0" />
          <span className="flex-1">Product counts are unavailable — the categories themselves are current.</span>
          <button type="button" onClick={products.refetch} className="font-medium underline">
            Retry
          </button>
        </div>
      )}

      <DataTable
        caption="Product categories"
        columns={columns}
        rows={rows}
        rowKey={(c) => c.id}
        state={categories.state}
        error={categories.error}
        onRetry={categories.refetch}
        empty={
          <EmptyState
            icon={CategoriesIcon}
            title="No categories yet"
            message="Create a category before adding products — every product needs one."
            action={
              <button type="button" onClick={() => setCreating(true)} className="btn-primary">
                <PlusIcon className="h-4 w-4" />
                New category
              </button>
            }
          />
        }
      />

      <CategoryForm
        open={creating}
        onClose={() => setCreating(false)}
        onSaved={() => { setCreating(false); categories.refetch(); }}
      />
    </div>
  );
}
