/**
 * Product details (US-PDP-1..4).
 */
import { useId, useState } from 'react';
import { Link, useNavigate, useParams, useLocation } from 'react-router-dom';
import { api } from '../services/api';
import { useFetch } from '../hooks/useFetch';
import { useCart } from '../context/CartContext';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { formatMoney } from '../utils/format';
import { ErrorState, EmptyState, Spinner } from '../components/States';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { BoxIcon, SearchIcon } from '../components/Icons';

/**
 * Quantity stepper (US-PDP-2).
 *
 * Clamping here is a convenience; the server re-checks stock on add, so a
 * tampered value cannot oversell.
 */
export function QuantityStepper({ value, onChange, max, disabled, label = 'Quantity' }) {
  const [notice, setNotice] = useState(null);
  // Generated, not the literal "qty": this component is exported, and two on
  // one page would otherwise share an id and break both label associations.
  const id = useId();

  const clamp = (n) => {
    if (!Number.isFinite(n) || n < 1) return 1;
    if (max != null && n > max) {
      setNotice(`Only ${max} available`);
      return max;
    }
    setNotice(null);
    return Math.floor(n);
  };

  return (
    <div>
      <label htmlFor={id} className="label">{label}</label>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => onChange(clamp(value - 1))}
          disabled={disabled || value <= 1}
          className="btn-secondary h-11 w-11 p-0 text-heading"
          aria-label="Decrease quantity"
        >
          −
        </button>
        <input
          id={id}
          /* `text` + inputMode, not `type="number"`: iOS shows a full keyboard
             for number inputs, and their spinner arrows duplicate the −/+
             buttons either side. */
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          /* min/max do not apply to a text input, so the bounds are stated for
             assistive tech; clamp() in onChange is what actually enforces them. */
          aria-valuemin={1}
          aria-valuemax={max}
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(clamp(Number(e.target.value)))}
          className="input h-11 w-20 text-center"
        />
        <button
          type="button"
          onClick={() => onChange(clamp(value + 1))}
          disabled={disabled || (max != null && value >= max)}
          className="btn-secondary h-11 w-11 p-0 text-heading"
          aria-label="Increase quantity"
        >
          +
        </button>
      </div>
      {notice && (
        <p className="mt-1.5 text-meta text-warning-text" role="status" aria-live="polite">
          {notice}
        </p>
      )}
    </div>
  );
}

export default function ProductDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { isAuthenticated } = useAuth();
  const { addItem } = useCart();
  const toast = useToast();

  const [quantity, setQuantity] = useState(1);
  const [activeImage, setActiveImage] = useState(0);
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState(null);

  const { data, state, error, refetch } = useFetch(
    ({ signal }) => api.get(`/api/products/${id}`, { signal, auth: false }),
    [id],
  );

  const product = data?.product;
  const outOfStock = product?.stock === 0;

  useDocumentTitle(product?.name ?? 'Product');

  const handleAdd = async () => {
    // Unauthenticated: go to login and come back here afterwards (AC4).
    if (!isAuthenticated) {
      navigate('/login', { state: { from: location.pathname, reason: 'auth' } });
      return;
    }

    setAdding(true);
    setAddError(null);
    try {
      await addItem(product.id, quantity);
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
      // Inline near the button, not a modal.
      setAddError(err.message);
      // Stock may have moved since load — refresh so the figure is current.
      refetch();
    } finally {
      setAdding(false);
    }
  };

  if (state === 'loading') {
    return (
      <div className="grid gap-8 md:grid-cols-2">
        <div className="aspect-square animate-pulse rounded-panel bg-surface-active" />
        <div className="space-y-4">
          <div className="h-8 w-3/4 animate-pulse rounded bg-surface-active" />
          <div className="h-4 w-full animate-pulse rounded bg-surface-hover" />
          <div className="h-4 w-5/6 animate-pulse rounded bg-surface-hover" />
          <div className="h-10 w-1/3 animate-pulse rounded bg-surface-active" />
        </div>
      </div>
    );
  }

  if (state === 'error') {
    // A 404 is a different situation from a fetch failure (AC4).
    if (error?.status === 404) {
      return (
        <EmptyState
          icon={SearchIcon}
          title="Product not found"
          message="This product may have been removed."
          action={<Link to="/products" className="btn-primary">Back to products</Link>}
        />
      );
    }
    return <ErrorState error={error} onRetry={refetch} />;
  }

  const images = product.images ?? [];

  return (
    <div>
      <nav className="mb-6 text-meta text-content-muted" aria-label="Breadcrumb">
        <Link to="/products" className="hover:text-content">Products</Link>
        <span className="mx-2" aria-hidden="true">/</span>
        <span className="text-content">{product.name}</span>
      </nav>

      <div className="grid gap-8 md:grid-cols-2">
        <div>
          <div className="aspect-square overflow-hidden rounded-panel border border-line bg-surface-hover">
            {images[activeImage] ? (
              <img src={images[activeImage]} alt={product.name} className="h-full w-full object-cover" />
            ) : (
              <div className="grid h-full place-items-center text-content-subtle" aria-hidden="true">
                <BoxIcon className="h-16 w-16" />
              </div>
            )}
          </div>

          {images.length > 1 && (
            <div className="mt-3 flex gap-2">
              {images.map((src, i) => (
                <button
                  key={src}
                  type="button"
                  aria-label={`Show image ${i + 1} of ${images.length}`}
                  onClick={() => setActiveImage(i)}
                  aria-pressed={i === activeImage}
                  className={`h-16 w-16 overflow-hidden rounded-control border-2 ${
                    i === activeImage ? 'border-primary-border' : 'border-line'
                  }`}
                >
                  {/* Empty alt: the button already carries the name. */}
                  <img src={src} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover" />
                </button>
              ))}
            </div>
          )}
        </div>

        <div>
          {product.category && (
            <span className="text-eyebrow font-medium uppercase tracking-wide text-primary">
              {product.category.name}
            </span>
          )}
          <h1 className="mt-1 text-display font-semibold text-content">{product.name}</h1>

          <p className="mt-4 text-display font-semibold text-content">{formatMoney(product.price)}</p>

          <div className="mt-3">
            {outOfStock ? (
              <span className="badge badge-neutral">Out of stock</span>
            ) : (
              <span className="badge bg-success-soft-alt text-success-text">
                In stock — {product.stock} available
              </span>
            )}
          </div>

          {/* Full description here, unclamped, unlike the listing card. */}
          <p className="mt-5 whitespace-pre-line text-content-secondary">{product.description}</p>

          <div className="mt-8 space-y-4">
            <QuantityStepper
              value={quantity}
              onChange={setQuantity}
              max={product.stock}
              disabled={outOfStock || adding}
            />

            <button
              type="button"
              onClick={handleAdd}
              disabled={outOfStock || adding}
              className="btn-primary w-full sm:w-auto sm:px-8"
              aria-label={outOfStock ? 'Out of stock, cannot add to cart' : 'Add to cart'}
            >
              {adding && <Spinner />}
              {adding ? 'Adding…' : outOfStock ? 'Out of stock' : 'Add to cart'}
            </button>

            {addError && (
              <p className="text-meta text-danger" role="alert">{addError}</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
