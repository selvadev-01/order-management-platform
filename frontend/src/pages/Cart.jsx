/**
 * Shopping cart (US-CART-1..4).
 *
 * Prices, totals and availability all come from the server. The client renders
 * them; it never calculates money itself.
 */
import { Link, useNavigate } from 'react-router-dom';
import { useCart } from '../context/CartContext';
import { useToast } from '../context/ToastContext';
import { formatMoney } from '../utils/format';
import { LoadingRows, EmptyState, ErrorState, Spinner } from '../components/States';
import { useDocumentTitle } from "../hooks/useDocumentTitle";
import { AlertIcon, BoxIcon, CartIcon, TrashIcon } from '../components/Icons';

/** Explains why a line cannot be purchased. */
function IssueNotice({ issue, available }) {
  if (!issue) return null;
  const text = {
    UNAVAILABLE: 'This product is no longer available',
    OUT_OF_STOCK: 'Out of stock',
    INSUFFICIENT_STOCK: `Only ${available} left — reduce the quantity`,
  }[issue];

  return (
    <p className="mt-1.5 flex items-center gap-1.5 text-sm text-warning-text" role="status">
      <AlertIcon className="h-4 w-4 shrink-0" />
      {text}
    </p>
  );
}

function CartLine({ line, pending, onQuantity, onRemove }) {
  const busy = Boolean(pending);
  return (
    <div
      className={`card flex flex-col gap-4 p-4 sm:flex-row sm:items-center ${
        busy ? 'opacity-60' : ''
      } ${!line.available ? 'border-warning-border bg-warning-soft/40' : ''}`}
    >
      <div className="grid h-16 w-16 shrink-0 place-items-center rounded-lg bg-surface-hover text-content-subtle" aria-hidden="true">
        <BoxIcon className="h-7 w-7" />
      </div>

      <div className="min-w-0 flex-1">
        <Link
          to={`/products/${line.productId}`}
          className="font-medium text-content hover:text-brand-600"
        >
          {line.name}
        </Link>
        <p className="mt-0.5 text-sm text-content-muted">{formatMoney(line.unitPrice)} each</p>
        <IssueNotice issue={line.issue} available={line.availableStock} />
      </div>

      {/* Stepper stays at least 44px on touch. */}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => onQuantity(line.quantity - 1)}
          disabled={busy || line.quantity <= 1}
          className="btn-secondary h-11 w-11 p-0 text-lg"
          aria-label={`Decrease quantity of ${line.name}`}
        >
          −
        </button>
        <span className="w-10 text-center font-medium">
          <span className="sr-only">Quantity </span>
          {line.quantity}
        </span>
        <button
          type="button"
          onClick={() => onQuantity(line.quantity + 1)}
          disabled={busy || (line.availableStock != null && line.quantity >= line.availableStock)}
          className="btn-secondary h-11 w-11 p-0 text-lg"
          aria-label={`Increase quantity of ${line.name}`}
        >
          +
        </button>
      </div>

      <div className="flex items-center justify-between gap-4 sm:w-40 sm:justify-end">
        <span className="font-semibold text-content">
          {line.available ? formatMoney(line.lineTotal) : '—'}
        </span>
        <button
          type="button"
          onClick={onRemove}
          disabled={busy}
          /* Full-size target, and `active:` alongside `hover:` so touch gets
             the same feedback a pointer does. Resting colour is `secondary`,
             not `subtle` — a destructive control should not be the faintest
             thing in the row. */
          className="grid h-11 w-11 place-items-center rounded-lg text-content-secondary transition hover:bg-danger-soft hover:text-danger active:bg-danger-soft active:text-danger"
          aria-label={`Remove ${line.name} from cart`}
        >
          {busy ? <Spinner /> : <TrashIcon className="h-5 w-5" />}
        </button>
      </div>
    </div>
  );
}

export default function Cart() {
  useDocumentTitle("Cart");
  const { cart, loading, error, pending, refresh, setQuantity, removeItem } = useCart();
  const toast = useToast();
  const navigate = useNavigate();

  const handleQuantity = async (productId, quantity, name) => {
    try {
      await setQuantity(productId, quantity);
    } catch (err) {
      toast.error(err.message);
    }
  };

  const handleRemove = async (productId, name) => {
    try {
      await removeItem(productId);
      toast.success(`${name} removed`);
    } catch (err) {
      toast.error(err.message);
    }
  };

  if (loading && cart.items.length === 0) {
    return (
      <div>
        <h1 className="mb-6 text-2xl font-semibold text-content">Your cart</h1>
        <LoadingRows count={3} />
      </div>
    );
  }

  // Error state, not an empty cart — an empty render would wrongly imply the
  // cart was cleared (US-CART-1 edge case).
  if (error && cart.items.length === 0) {
    return (
      <div>
        <h1 className="mb-6 text-2xl font-semibold text-content">Your cart</h1>
        <ErrorState error={error} onRetry={refresh} retrying={loading} />
      </div>
    );
  }

  if (cart.items.length === 0) {
    return (
      <div>
        <h1 className="mb-6 text-2xl font-semibold text-content">Your cart</h1>
        <EmptyState
          icon={CartIcon}
          title="Your cart is empty"
          message="Browse the catalogue to add something."
          action={<Link to="/products" className="btn-primary">Browse products</Link>}
        />
      </div>
    );
  }

  return (
    <div>
      <h1 className="mb-6 text-2xl font-semibold text-content">Your cart</h1>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-3 lg:col-span-2">
          {cart.items.map((line) => (
            <CartLine
              key={line.productId}
              line={line}
              pending={pending[line.productId]}
              onQuantity={(q) => handleQuantity(line.productId, q, line.name)}
              onRemove={() => handleRemove(line.productId, line.name)}
            />
          ))}
        </div>

        <div className="lg:col-span-1">
          <div className="card sticky top-20 p-5">
            <h2 className="font-semibold text-content">Order summary</h2>

            <dl className="mt-4 space-y-2 text-sm">
              <div className="flex justify-between">
                <dt className="text-content-secondary">Subtotal</dt>
                <dd className="font-medium">{formatMoney(cart.subtotal)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-content-secondary">Delivery</dt>
                <dd className="font-medium">Free</dd>
              </div>
            </dl>

            <div className="mt-4 flex items-baseline justify-between border-t border-line pt-4">
              <span className="font-semibold text-content">Total</span>
              {/* Announced so the financial consequence of a change is heard. */}
              <span className="text-xl font-semibold text-content" aria-live="polite">
                {formatMoney(cart.total)}
              </span>
            </div>

            {cart.checkoutBlocked && cart.issues.length > 0 && (
              <div className="mt-4 rounded-lg border border-warning-border bg-warning-soft px-3.5 py-2.5 text-sm text-warning-text" role="alert">
                Resolve the flagged items before checking out.
              </div>
            )}

            <button
              type="button"
              onClick={() => navigate('/checkout')}
              disabled={cart.checkoutBlocked}
              className="btn-primary mt-4 w-full"
            >
              Proceed to checkout
            </button>

            <Link to="/products" className="btn-secondary mt-2 w-full">
              Continue shopping
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
