/**
 * Checkout (US-PAY-1, US-PAY-2, US-PAY-3).
 *
 * The five sections the brief requires: customer information, delivery
 * address, order summary, total amount, payment option.
 *
 * Note there is no total field posted to the server — the total is computed
 * server-side from live prices, so the client cannot propose what it pays.
 */
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../services/api';
import { loadRazorpay, openCheckout } from '../services/razorpay';
import { useCart } from '../context/CartContext';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { formatMoney } from '../utils/format';
import { FormError, FieldError, EmptyState, ErrorState, LoadingRows, Spinner } from '../components/States';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { CartIcon } from '../components/Icons';

const FIELDS = {
  name: 'Name is required',
  email: 'A valid email is required',
  phone: 'A valid phone number is required',
  line1: 'Address line 1 is required',
  city: 'City is required',
  state: 'State is required',
  postalCode: 'Postal code is required',
};

export default function Checkout() {
  const { cart, loading, error, refresh } = useCart();
  const { user } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  useDocumentTitle('Checkout');

  const [form, setForm] = useState({
    name: user?.name ?? '',
    email: user?.email ?? '',
    phone: '',
    line1: '',
    line2: '',
    city: '',
    state: '',
    postalCode: '',
    country: 'India',
  });
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState(null);
  const [stage, setStage] = useState('idle'); // idle | creating | paying | verifying
  // Declared one per line rather than built by mapping over FIELDS: calling
  // useRef inside a loop callback breaks the Rules of Hooks, and `country` is
  // posted to the server so it needs a ref too even though it is never invalid.
  const refs = {
    name: useRef(null),
    email: useRef(null),
    phone: useRef(null),
    line1: useRef(null),
    line2: useRef(null),
    city: useRef(null),
    state: useRef(null),
    postalCode: useRef(null),
    country: useRef(null),
  };

  // Re-fetch the cart rather than trusting values carried through client state
  // — this is what guarantees the total matches (US-CART-4 AC4).
  useEffect(() => { refresh(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { loadRazorpay(); }, []);

  const change = (e) => {
    setForm((f) => ({ ...f, [e.target.name]: e.target.value }));
    setErrors((x) => ({ ...x, [e.target.name]: undefined }));
  };

  const validate = () => {
    const next = {};
    if (form.name.trim().length < 2) next.name = FIELDS.name;
    if (!/^\S+@\S+\.\S+$/.test(form.email.trim())) next.email = FIELDS.email;
    if (!/^[0-9+\-\s()]{7,20}$/.test(form.phone.trim())) next.phone = FIELDS.phone;
    if (form.line1.trim().length < 3) next.line1 = FIELDS.line1;
    if (form.city.trim().length < 2) next.city = FIELDS.city;
    if (form.state.trim().length < 2) next.state = FIELDS.state;
    if (form.postalCode.trim().length < 4) next.postalCode = FIELDS.postalCode;
    return next;
  };

  /**
   * Order → payment → gateway.
   *
   * After the gateway closes we do NOT mark anything paid; we send the
   * customer to the confirmation page, which polls the server for the real
   * status set by the webhook (US-PAY-3 AC5).
   */
  const submit = async (e) => {
    e.preventDefault();
    const invalid = validate();
    if (Object.keys(invalid).length) {
      setErrors(invalid);
      refs[Object.keys(invalid)[0]]?.current?.focus();
      return;
    }

    setFormError(null);
    setStage('creating');

    let order;
    try {
      const res = await api.post('/api/orders', {
        customerInfo: { name: form.name.trim(), email: form.email.trim(), phone: form.phone.trim() },
        deliveryAddress: {
          line1: form.line1.trim(),
          line2: form.line2.trim(),
          city: form.city.trim(),
          state: form.state.trim(),
          postalCode: form.postalCode.trim(),
          country: form.country.trim(),
        },
      });
      order = res.order;
    } catch (err) {
      setStage('idle');
      setFormError(err.message);
      const rejected = err.fieldErrors ?? {};
      setErrors(rejected);
      // Move focus the same way the client-side path does, so a server
      // rejection is not a silent failure for a screen reader user.
      refs[Object.keys(rejected)[0]]?.current?.focus();
      // Stock or availability changed since the cart loaded.
      if (err.status === 409) refresh();
      return;
    }

    let payment;
    try {
      payment = await api.post('/api/payments/create', { orderId: order.id });
    } catch (err) {
      // The order exists and stays Pending — payment is retryable from the
      // order page rather than lost (US-PAY-2 AC4).
      setStage('idle');
      toast.error('Could not start payment. Your order was saved — you can retry from My orders.');
      navigate(`/orders/${order.id}`);
      return;
    }

    setStage('paying');

    const ready = await loadRazorpay();
    if (!ready) {
      setStage('idle');
      toast.error('Could not load the payment gateway. Retry from My orders.');
      navigate(`/orders/${order.id}`);
      return;
    }

    const result = await openCheckout({
      keyId: payment.keyId,
      gatewayOrderId: payment.gatewayOrderId,
      amount: payment.amount,
      currency: payment.currency,
      orderId: order.id,
      customer: { name: form.name, email: form.email, phone: form.phone },
    });

    if (result.status === 'dismissed') {
      setStage('idle');
      toast.error('Payment cancelled. Your order is saved and can be paid later.');
      navigate(`/orders/${order.id}`);
      return;
    }

    if (result.status === 'failed') {
      setStage('idle');
      navigate(`/orders/${order.id}`);
      return;
    }

    // Success from the gateway is advisory. The confirmation page waits for
    // the webhook-verified status.
    await refresh();
    navigate(`/orders/${order.id}?awaiting=1`);
  };

  // Order matters. The cart is re-fetched on mount, so it is momentarily empty
  // while that request is in flight — checking `items.length` first would flash
  // "your cart is empty" at every customer who reaches checkout.
  if (loading && cart.items.length === 0) {
    return <LoadingRows count={3} />;
  }

  // Never let the customer submit against a cart we failed to refresh: the
  // totals shown would be stale, and the whole point of the refresh is that
  // what is displayed matches what is charged.
  if (error) {
    return <ErrorState error={error} onRetry={refresh} />;
  }

  if (cart.items.length === 0) {
    return (
      <EmptyState
        icon={CartIcon}
        title="Your cart is empty"
        message="Add something before checking out."
        action={<Link to="/products" className="btn-primary">Browse products</Link>}
      />
    );
  }

  const busy = stage !== 'idle';

  const field = (name, label, opts = {}) => (
    <div className={opts.span ? 'sm:col-span-2' : ''}>
      <label htmlFor={name} className="label">{label}</label>
      <input
        ref={refs[name]}
        id={name}
        name={name}
        type={opts.type ?? 'text'}
        inputMode={opts.inputMode}
        autoComplete={opts.autoComplete}
        value={form[name]}
        onChange={change}
        disabled={busy}
        className={`input ${errors[name] ? 'input-error' : ''}`}
        aria-invalid={Boolean(errors[name])}
        aria-describedby={errors[name] ? `${name}-error` : undefined}
      />
      <FieldError id={`${name}-error`} message={errors[name]} />
    </div>
  );

  return (
    <div>
      <h1 className="mb-6 text-2xl font-semibold text-content">Checkout</h1>

      <form onSubmit={submit} noValidate>
        <div className="grid gap-6 lg:grid-cols-3">
          <div className="space-y-6 lg:col-span-2">
            <FormError message={formError} />

            <fieldset className="card p-5" disabled={busy}>
              <legend className="px-1 font-semibold text-content">Customer information</legend>
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                {field('name', 'Full name', { autoComplete: 'name' })}
                {field('email', 'Email', { type: 'email', autoComplete: 'email' })}
                {field('phone', 'Phone', { type: 'tel', autoComplete: 'tel' })}
              </div>
            </fieldset>

            <fieldset className="card p-5" disabled={busy}>
              <legend className="px-1 font-semibold text-content">Delivery address</legend>
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                {field('line1', 'Address line 1', { autoComplete: 'address-line1', span: true })}
                {field('line2', 'Address line 2 (optional)', { autoComplete: 'address-line2', span: true })}
                {field('city', 'City', { autoComplete: 'address-level2' })}
                {field('state', 'State', { autoComplete: 'address-level1' })}
                {field('postalCode', 'Postal code', { autoComplete: 'postal-code', inputMode: 'numeric' })}
                {field('country', 'Country', { autoComplete: 'country-name' })}
              </div>
            </fieldset>
          </div>

          <div className="lg:col-span-1">
            <div className="card sticky top-20 p-5">
              <h2 className="font-semibold text-content">Order summary</h2>

              <ul className="mt-4 space-y-3">
                {cart.items.map((l) => (
                  <li key={l.productId} className="flex justify-between gap-3 text-sm">
                    <span className="min-w-0">
                      <span className="block truncate text-content">{l.name}</span>
                      <span className="text-content-muted">Qty {l.quantity}</span>
                    </span>
                    <span className="shrink-0 font-medium">{formatMoney(l.lineTotal)}</span>
                  </li>
                ))}
              </ul>

              <div className="mt-4 flex items-baseline justify-between border-t border-line pt-4">
                <span className="font-semibold text-content">Total</span>
                <span className="text-xl font-semibold text-content">{formatMoney(cart.total)}</span>
              </div>

              <button type="submit" disabled={busy || cart.checkoutBlocked} className="btn-primary mt-5 w-full">
                {busy && <Spinner />}
                {stage === 'creating' && 'Creating order…'}
                {stage === 'paying' && 'Opening payment…'}
                {stage === 'idle' && `Pay ${formatMoney(cart.total)}`}
              </button>

              <Link to="/cart" className="btn-secondary mt-2 w-full">Back to cart</Link>
            </div>
          </div>
        </div>
      </form>
    </div>
  );
}
