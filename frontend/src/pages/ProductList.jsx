/**
 * Product listing (US-PROD-1..5).
 *
 * Search, category filter and page all live in the URL query string, so any
 * view is shareable and survives a refresh.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { api, qs } from '../services/api';
import { useFetch, useDebounced } from '../hooks/useFetch';
import { formatMoney } from '../utils/format';
import { LoadingGrid, EmptyState, ErrorState, Spinner } from '../components/States';
import { useAuth } from '../context/AuthContext';
import { useCart } from '../context/CartContext';
import { useToast } from '../context/ToastContext';
import { useDocumentTitle } from "../hooks/useDocumentTitle";
import { BoxIcon, CartIcon, SearchIcon } from '../components/Icons';
import Select from '../components/Select';

/**
 * Catalogue card with inline add-to-cart (US-PROD-1, US-PDP-3).
 *
 * The card is no longer one big <Link>: a button inside an anchor is invalid
 * HTML, and a click would both add to the cart and navigate away. Instead the
 * title carries the link and an ::after overlay stretches it across the card,
 * with the button raised above it — so the whole card stays clickable, the
 * accessible name comes from the real link text, and the two targets do not
 * overlap.
 */
function ProductCard({ product, onAdd, adding }) {
  const out = product.stock === 0;
  return (
    <div className="card-interactive group relative flex flex-col overflow-hidden">
      <div className="relative aspect-[4/3] overflow-hidden bg-surface-hover">
        {product.images?.[0] ? (
          <img
            src={product.images[0]}
            alt={product.name}
            className={`h-full w-full object-cover transition-transform duration-300 group-hover:scale-105 ${
              // Dimmed rather than hidden: the product is still identifiable,
              // but reads as unavailable before the badge is even parsed.
              out ? 'opacity-60 saturate-50' : ''
            }`}
            loading="lazy"
            decoding="async"
          />
        ) : (
          <div className="grid h-full place-items-center text-content-subtle" aria-hidden="true">
            <BoxIcon className="h-10 w-10" />
          </div>
        )}
        {/* Out-of-stock is text, not colour alone. */}
        {out && (
          <span className="badge badge-neutral absolute left-2.5 top-2.5 shadow-raised">Out of stock</span>
        )}
      </div>

      <div className="flex flex-1 flex-col p-4">
        {product.category && (
          <span className="mb-1.5 text-eyebrow font-semibold uppercase text-primary-text">
            {product.category.name}
          </span>
        )}
        {/* Clamped so cards in a row keep the same height. */}
        <h3 className="text-heading line-clamp-2 font-semibold text-content">
          <Link
            to={`/products/${product.id}`}
            className="transition-colors after:absolute after:inset-0 after:content-[''] group-hover:text-primary-text"
          >
            {product.name}
          </Link>
        </h3>
        <p className="mt-1.5 line-clamp-2 text-meta text-content-muted">{product.description}</p>

        {/* Price and availability separated by a rule: the money is the thing
            the eye should land on, not one of four competing lines. */}
        <div className="mt-auto flex items-baseline justify-between gap-3 border-t border-line-subtle pt-3.5">
          <span className="text-title font-semibold tabular-nums text-content">
            {formatMoney(product.price)}
          </span>
          {/* `muted`, not `subtle`: this is the availability status, so it has
              to clear AA. `subtle` is reserved for decoration. */}
          <span className={`text-eyebrow font-semibold uppercase ${out ? 'text-content-muted' : 'text-success'}`}>
            {out ? 'Unavailable' : `${product.stock} left`}
          </span>
        </div>

        {/* Raised above the stretched overlay so it receives its own clicks. */}
        <button
          type="button"
          onClick={() => onAdd(product)}
          disabled={out || adding}
          className="btn-primary relative z-10 mt-3.5 w-full"
        >
          {adding ? <Spinner /> : <CartIcon className="h-4 w-4" />}
          {out ? 'Out of stock' : adding ? 'Adding…' : 'Add to cart'}
        </button>
      </div>
    </div>
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
      <span className="text-meta text-content-secondary" role="status" aria-live="polite">
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
  const navigate = useNavigate();
  const location = useLocation();
  const { isAuthenticated } = useAuth();
  const { addItem, pending } = useCart();
  const toast = useToast();
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

  /**
   * Add straight from the card, matching the detail page's behaviour so the two
   * routes into the cart cannot diverge: sign-in first if needed, a toast with a
   * way through to the cart, and a refetch on failure because a rejection here
   * usually means stock moved since the page loaded.
   */
  const handleAdd = async (product) => {
    if (!isAuthenticated) {
      navigate('/login', { state: { from: `${location.pathname}${location.search}`, reason: 'auth' } });
      return;
    }
    try {
      await addItem(product.id, 1);
      toast.success(`${product.name} added to cart`, {
        action: (
          <button
            type="button"
            onClick={() => navigate('/cart')}
            className="shrink-0 text-meta font-medium underline"
          >
            View cart
          </button>
        ),
      });
    } catch (err) {
      toast.error(err.message);
      refetch();
    }
  };

  // "All" is a real option with an empty value, mirroring what the chip row
  // opposite it does, so both controls express the same set of choices.
  const categoryOptions = useMemo(
    () => [
      { value: '', label: 'All categories' },
      ...(categories?.categories ?? []).map((c) => ({ value: c.id, label: c.name })),
    ],
    [categories],
  );

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-display font-semibold text-content">Products</h1>
        <p className="mt-1.5 text-body text-content-muted">Browse the catalogue.</p>
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
          <span id="category-label" className="sr-only">Filter by category</span>
          <Select
            id="category"
            aria-labelledby="category-label"
            value={category}
            onChange={(v) => setParam('category', v)}
            options={categoryOptions}
          />
        </div>

        <div className="hidden flex-wrap items-center gap-2 md:flex">
          <button
            type="button"
            onClick={() => setParam('category', '')}
            aria-pressed={!category}
            className={`badge min-h-[2.25rem] border px-3 py-1.5 ${
              !category ? 'border-primary-border bg-primary-soft text-primary-text' : 'border-line-strong bg-surface text-content-secondary'
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
                  ? 'border-primary-border bg-primary-soft text-primary-text'
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
        <p className="mb-4 text-meta text-content-muted" role="status" aria-live="polite">
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
          {/* Keyed on the query so the reveal replays when the result set
              actually changes, rather than only on first mount — paging or
              filtering otherwise swaps the cards with no acknowledgement. */}
          <div
            key={`${search}|${category}|${page}`}
            className="animate-rise grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
          >
            {items.map((p) => (
              <ProductCard key={p.id} product={p} onAdd={handleAdd} adding={Boolean(pending[p.id])} />
            ))}
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
