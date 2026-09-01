/**
 * Product listing (US-PROD-1..5).
 *
 * Search, category filter and page all live in the URL query string, so any
 * view is shareable and survives a refresh.
 */
import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, qs } from '../services/api';
import { useFetch, useDebounced } from '../hooks/useFetch';
import { formatMoney } from '../utils/format';
import { LoadingGrid, EmptyState, ErrorState } from '../components/States';
import { useDocumentTitle } from "../hooks/useDocumentTitle";
import { BoxIcon, SearchIcon } from '../components/Icons';

function ProductCard({ product }) {
  const out = product.stock === 0;
  return (
    <Link
      to={`/products/${product.id}`}
      className="card group flex flex-col overflow-hidden transition hover:shadow-md"
    >
      <div className="relative aspect-[4/3] overflow-hidden bg-surface-hover">
        {product.images?.[0] ? (
          <img
            src={product.images[0]}
            alt={product.name}
            className="h-full w-full object-cover transition group-hover:scale-105"
            loading="lazy"
          />
        ) : (
          <div className="grid h-full place-items-center text-content-subtle" aria-hidden="true">
            <BoxIcon className="h-10 w-10" />
          </div>
        )}
        {/* Out-of-stock is text, not colour alone. */}
        {out && (
          <span className="absolute left-2 top-2 badge badge-neutral">Out of stock</span>
        )}
      </div>

      <div className="flex flex-1 flex-col p-4">
        {product.category && (
          <span className="mb-1 text-xs font-medium uppercase tracking-wide text-brand-600">
            {product.category.name}
          </span>
        )}
        {/* Clamped so cards in a row keep the same height. */}
        <h3 className="line-clamp-2 font-medium text-content">{product.name}</h3>
        <p className="mt-1 line-clamp-2 text-sm text-content-muted">{product.description}</p>

        <div className="mt-auto flex items-end justify-between pt-3">
          <span className="text-lg font-semibold text-content">{formatMoney(product.price)}</span>
          <span className={`text-xs ${out ? 'text-content-subtle' : 'text-success'}`}>
            {out ? 'Unavailable' : `${product.stock} in stock`}
          </span>
        </div>
      </div>
    </Link>
  );
}

function Pagination({ page, totalPages, hasPrev, hasNext, onChange, disabled }) {
  // Hidden entirely when everything fits on one page (US-PROD-4 AC5).
  if (totalPages <= 1) return null;
  return (
    <nav className="mt-8 flex items-center justify-center gap-3" aria-label="Pagination">
      <button
        type="button"
        className="btn-secondary"
        onClick={() => onChange(page - 1)}
        disabled={!hasPrev || disabled}
      >
        Previous
      </button>
      {/* A status, not a link: aria-current on static text says nothing, but
          announcing the change of page does. */}
      <span className="text-sm text-content-secondary" role="status" aria-live="polite">
        Page {page} of {totalPages}
      </span>
      <button
        type="button"
        className="btn-secondary"
        onClick={() => onChange(page + 1)}
        disabled={!hasNext || disabled}
      >
        Next
      </button>
    </nav>
  );
}

export default function ProductList() {
  useDocumentTitle("Products");
  const [params, setParams] = useSearchParams();
  const search = params.get('search') ?? '';
  const category = params.get('category') ?? '';
  const page = Number(params.get('page') ?? 1);

  const [searchInput, setSearchInput] = useState(search);
  const debouncedSearch = useDebounced(searchInput, 300);

  // Push the settled search term into the URL, resetting to page 1 since the
  // old page may not exist in the new result set (US-PROD-2 edge case).
  useEffect(() => {
    if (debouncedSearch === search) return;
    const next = new URLSearchParams(params);
    if (debouncedSearch) next.set('search', debouncedSearch);
    else next.delete('search');
    next.delete('page');
    setParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSearch]);

  const { data: categories } = useFetch(
    ({ signal }) => api.get('/api/categories', { signal, auth: false }),
    [],
  );

  const { data, state, error, refetch, isLoading } = useFetch(
    ({ signal }) =>
      api.get(`/api/products${qs({ search, category, page, limit: 12 })}`, { signal, auth: false }),
    [search, category, page],
  );

  const setParam = useCallback(
    (key, value) => {
      const next = new URLSearchParams(params);
      if (value) next.set(key, value);
      else next.delete(key);
      // Changing the filter resets pagination (US-PROD-3 edge case).
      if (key !== 'page') next.delete('page');
      setParams(next);
    },
    [params, setParams],
  );

  const filtered = Boolean(search || category);
  const items = data?.items ?? [];

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-content">Products</h1>
        <p className="mt-1 text-sm text-content-muted">Browse the catalogue.</p>
      </div>

      <div className="mb-6 flex flex-col gap-3 md:flex-row md:items-center">
        <div className="relative flex-1">
          <label htmlFor="search" className="sr-only">Search products</label>
          <input
            id="search"
            type="search"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search products…"
            className="input pl-10"
          />
          <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-content-subtle" />
        </div>

        {/* Select on mobile, chips from md up. */}
        <div className="md:hidden">
          <label htmlFor="category" className="sr-only">Filter by category</label>
          <select
            id="category"
            value={category}
            onChange={(e) => setParam('category', e.target.value)}
            className="input"
          >
            <option value="">All categories</option>
            {categories?.categories?.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>

        <div className="hidden flex-wrap items-center gap-2 md:flex">
          <button
            type="button"
            onClick={() => setParam('category', '')}
            aria-pressed={!category}
            className={`badge min-h-[2.25rem] border px-3 py-1.5 ${
              !category ? 'border-brand-600 bg-brand-50 text-brand-700' : 'border-line-strong bg-surface text-content-secondary'
            }`}
          >
            All
          </button>
          {categories?.categories?.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => setParam('category', c.id)}
              aria-pressed={category === c.id}
              className={`badge min-h-[2.25rem] border px-3 py-1.5 ${
                category === c.id
                  ? 'border-brand-600 bg-brand-50 text-brand-700'
                  : 'border-line-strong bg-surface text-content-secondary'
              }`}
            >
              {c.name}
            </button>
          ))}
        </div>
      </div>

      {/* Result count announced so screen reader users learn the list changed. */}
      {/* Gated on success, not merely on `data`: after a failed refetch the
          previous count would otherwise sit above an error telling the user
          the load failed. */}
      {state === 'success' && data && (
        <p className="mb-4 text-sm text-content-muted" role="status" aria-live="polite">
          {data.total} product{data.total === 1 ? '' : 's'}
          {search ? ` matching “${search}”` : ''}
        </p>
      )}

      {isLoading && <LoadingGrid />}

      {state === 'error' && <ErrorState error={error} onRetry={refetch} />}

      {state === 'success' && items.length === 0 && (
        filtered ? (
          <EmptyState
            icon={SearchIcon}
            title="No products match your search"
            message="Try a different term, or clear the filters."
            action={
              <button
                type="button"
                className="btn-secondary"
                onClick={() => { setSearchInput(''); setParams(new URLSearchParams()); }}
              >
                Clear filters
              </button>
            }
          />
        ) : (
          <EmptyState title="No products yet" message="The catalogue is empty." />
        )
      )}

      {state === 'success' && items.length > 0 && (
        <>
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {items.map((p) => <ProductCard key={p.id} product={p} />)}
          </div>
          <Pagination
            page={data.page}
            totalPages={data.totalPages}
            hasPrev={data.hasPrev}
            hasNext={data.hasNext}
            disabled={isLoading}
            onChange={(p) => {
              setParam('page', String(p));
              window.scrollTo({ top: 0, behavior: 'smooth' });
            }}
          />
        </>
      )}
    </div>
  );
}
