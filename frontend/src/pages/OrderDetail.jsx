/**
 * Order detail / confirmation (US-PAY-3, US-PAY-5).
 *
 * When arriving from checkout with `?awaiting=1`, the page polls for the real
 * payment status rather than declaring success from the browser callback. The
 * order is only "confirmed" once the webhook has verified it (US-PAY-3 AC5).
 */
import { useEffect, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { api } from '../services/api';
import { useFetch } from '../hooks/useFetch';
import { loadRazorpay, openCheckout } from '../services/razorpay';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { formatMoney, formatDateTime, statusClasses } from '../utils/format';
import { ErrorState, EmptyState, Spinner } from '../components/States';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { CheckIcon, ChevronRightIcon, SearchIcon } from '../components/Icons';

const STEPS = ['Pending', 'Confirmed', 'Processing', 'Shipped', 'Delivered'];

/** The single next status, matching the admin list (US-ADMIN-8). */
function nextStatus(current) {
  const i = STEPS.indexOf(current);
  return i >= 0 && i < STEPS.length - 1 ? STEPS[i + 1] : null;
}

/**
 * Admin-only status control, mirroring the advance button on the admin orders
 * list so the same rules apply wherever an admin lands on an order: one step at
 * a time, blocked past Confirmed until payment lands, Delivered terminal.
 */
function AdminStatusPanel({ order, onAdvance, busy }) {
  const next = nextStatus(order.orderStatus);
  const blocked = next && next !== 'Confirmed' && order.paymentStatus !== 'Paid';

  return (
    <div className="mt-5 flex flex-wrap items-center gap-3 rounded-lg border border-line bg-surface-hover px-4 py-3">
      <div className="flex-1 min-w-[12rem]">
        <p className="text-sm font-medium text-content">Order status</p>
        <p className="text-sm text-content-muted">
          {next
            ? blocked
              ? 'Payment must be completed before this order can advance.'
              : `Currently ${order.orderStatus}. Next step is ${next}.`
            : 'This order has completed the fulfilment pipeline.'}
        </p>
      </div>
      {next ? (
        <button
          type="button"
          onClick={() => onAdvance(next)}
          disabled={busy || blocked}
          className="btn-primary"
          title={blocked ? 'Payment must be completed first' : `Advance to ${next}`}
          aria-label={`Mark order ${order.id.slice(-8)} as ${next}`}
        >
          {busy ? <Spinner /> : <ChevronRightIcon className="h-4 w-4" />}
          {`Mark ${next}`}
        </button>
      ) : (
        <span className="inline-flex items-center gap-1.5 text-sm font-medium text-success">
          <CheckIcon className="h-4 w-4" />
          Complete
        </span>
      )}
    </div>
  );
}

function StatusStepper({ current }) {
  const index = STEPS.indexOf(current);
  return (
    <ol className="flex flex-wrap items-center gap-x-2 gap-y-2 text-sm" aria-label="Order progress">
      {STEPS.map((s, i) => {
        const done = i <= index;
        return (
          <li key={s} className="flex items-center gap-2">
            <span
              className={`badge gap-1 ${done ? 'bg-brand-600 text-content-inverse' : 'bg-surface-hover text-content-muted'}`}
              aria-current={i === index ? 'step' : undefined}
            >
              {done && <CheckIcon className="h-3.5 w-3.5" />}
              {s}
              {/* Reached and not-yet-reached differ only by colour and a tick
                  visually, neither of which a screen reader conveys. */}
              <span className="sr-only">{done ? ' — completed' : ' — not yet reached'}</span>
            </span>
            {i < STEPS.length - 1 && (
              <ChevronRightIcon className="h-4 w-4 text-content-subtle" />
            )}
          </li>
        );
      })}
    </ol>
  );
}

export default function OrderDetail() {
  const { id } = useParams();
  const [params, setParams] = useSearchParams();
  const toast = useToast();
  const { isAdmin } = useAuth();
  const awaiting = params.get('awaiting') === '1';

  const [polling, setPolling] = useState(awaiting);
  const [retrying, setRetrying] = useState(false);
  const [advancing, setAdvancing] = useState(false);
  const pollCount = useRef(0);

  const { data, state, error, refetch } = useFetch(
    ({ signal }) => api.get(`/api/orders/${id}`, { signal }),
    [id],
  );

  const order = data?.order;

  // Same short form the heading shows, so the tab and the page agree.
  useDocumentTitle(order ? `Order ${order.id.slice(-8)}` : 'Order');

  /**
   * Poll while the webhook settles.
   *
   * Bounded: the webhook usually lands in seconds, and an unbounded poll would
   * spin forever if it never arrives. After ~30s we stop and show the order as
   * it stands — payment can be retried.
   */
  useEffect(() => {
    if (!polling || !order) return;

    if (order.paymentStatus === 'Paid' || order.paymentStatus === 'Failed') {
      setPolling(false);
      const next = new URLSearchParams(params);
      next.delete('awaiting');
      setParams(next, { replace: true });
      if (order.paymentStatus === 'Paid') toast.success('Payment confirmed');
      return;
    }

    if (pollCount.current >= 15) {
      setPolling(false);
      return;
    }

    const t = setTimeout(() => {
      pollCount.current += 1;
      refetch();
    }, 2000);
    return () => clearTimeout(t);
  }, [polling, order, refetch]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Advance the order one stage — admin only; the server re-checks the role. */
  const advanceStatus = async (next) => {
    setAdvancing(true);
    try {
      await api.patch(`/api/orders/${id}/status`, { status: next });
      toast.success(`Order ${order.id.slice(-8)} marked ${next}`);
      refetch();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setAdvancing(false);
    }
  };

  /** Retry payment for an order that is still unpaid (US-PAY-3 AC3/AC4). */
  const retryPayment = async () => {
    setRetrying(true);
    try {
      const payment = await api.post('/api/payments/create', { orderId: id });
      const ready = await loadRazorpay();
      if (!ready) throw new Error('Could not load the payment gateway');

      const result = await openCheckout({
        keyId: payment.keyId,
        gatewayOrderId: payment.gatewayOrderId,
        amount: payment.amount,
        currency: payment.currency,
        orderId: id,
        customer: order.customerInfo,
      });

      if (result.status === 'success') {
        pollCount.current = 0;
        setPolling(true);
        refetch();
      }
    } catch (err) {
      toast.error(err.message);
    } finally {
      setRetrying(false);
    }
  };

  if (state === 'loading' && !order) {
    return (
      <div className="space-y-4">
        <div className="h-8 w-1/3 animate-pulse rounded bg-surface-active" />
        <div className="h-40 animate-pulse rounded-xl bg-surface-hover" />
      </div>
    );
  }

  if (state === 'error') {
    if (error?.status === 404 || error?.status === 403) {
      return (
        <EmptyState
          icon={SearchIcon}
          title="Order not found"
          message="This order does not exist, or you do not have permission to view it."
          action={
            <Link to={isAdmin ? '/admin/orders' : '/orders'} className="btn-primary">
              {isAdmin ? 'All orders' : 'My orders'}
            </Link>
          }
        />
      );
    }
    return <ErrorState error={error} onRetry={refetch} />;
  }

  const unpaid = order.paymentStatus === 'Pending' || order.paymentStatus === 'Failed';

  return (
    <div>
      <nav className="mb-6 text-sm text-content-muted" aria-label="Breadcrumb">
        {/* Admins reach this page from the admin list, so send them back there. */}
        <Link to={isAdmin ? '/admin/orders' : '/orders'} className="hover:text-content">
          {isAdmin ? 'All orders' : 'My orders'}
        </Link>
        <span className="mx-2" aria-hidden="true">/</span>
        <span className="text-content">Order {order.id.slice(-8)}</span>
      </nav>

      {/* The awaiting state must not look like a failure (US-PAY-3 AC5). */}
      {polling && (
        <div
          className="mb-6 flex items-center gap-3 rounded-xl border border-brand-100 bg-brand-50 px-4 py-3.5"
          role="status"
          aria-live="polite"
        >
          <Spinner className="h-5 w-5 text-brand-600" />
          <div>
            <p className="font-medium text-brand-900">Confirming your payment…</p>
            <p className="text-sm text-brand-700">
              We are waiting for the payment gateway to confirm. This usually takes a few seconds.
            </p>
          </div>
        </div>
      )}

      <div className="card p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold text-content">Order {order.id.slice(-8)}</h1>
            <p className="mt-1 text-sm text-content-muted">Placed {formatDateTime(order.createdAt)}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {/* Two separate fields — they can legitimately disagree. */}
            <span className={statusClasses(order.orderStatus)}>
              Order: {order.orderStatus}
            </span>
            <span className={statusClasses(order.paymentStatus)}>
              Payment: {order.paymentStatus}
            </span>
          </div>
        </div>

        <div className="mt-5 border-t border-line pt-5">
          <StatusStepper current={order.orderStatus} />
        </div>

        {isAdmin && (
          <AdminStatusPanel order={order} onAdvance={advanceStatus} busy={advancing} />
        )}

        {/* Payment is the customer's action — an admin cannot pay on their behalf. */}
        {unpaid && !polling && !isAdmin && (
          <div className="mt-5 flex flex-wrap items-center gap-3 rounded-lg border border-warning-border bg-warning-soft px-4 py-3">
            <p className="flex-1 text-sm text-warning-text-strong">
              This order has not been paid yet.
            </p>
            <button type="button" onClick={retryPayment} disabled={retrying} className="btn-primary">
              {retrying && <Spinner />}
              {retrying ? 'Opening…' : 'Pay now'}
            </button>
          </div>
        )}
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <div className="card p-5 lg:col-span-2">
          <h2 className="font-semibold text-content">Items</h2>
          <ul className="mt-4 divide-y divide-line-subtle">
            {order.items.map((item) => (
              <li key={item.productId} className="flex items-center justify-between gap-4 py-3">
                <div className="min-w-0">
                  <p className="truncate font-medium text-content">{item.name}</p>
                  <p className="text-sm text-content-muted">
                    {formatMoney(item.unitPrice)} × {item.quantity}
                  </p>
                </div>
                <span className="shrink-0 font-medium">{formatMoney(item.lineTotal)}</span>
              </li>
            ))}
          </ul>
          <div className="mt-4 flex items-baseline justify-between border-t border-line pt-4">
            <span className="font-semibold">Total</span>
            <span className="text-xl font-semibold">{formatMoney(order.totalAmount)}</span>
          </div>
        </div>

        <div className="space-y-6">
          <div className="card p-5">
            <h2 className="font-semibold text-content">Delivery address</h2>
            <address className="mt-3 not-italic text-sm leading-relaxed text-content-secondary">
              {order.customerInfo?.name}<br />
              {order.deliveryAddress?.line1}<br />
              {order.deliveryAddress?.line2 && <>{order.deliveryAddress.line2}<br /></>}
              {order.deliveryAddress?.city}, {order.deliveryAddress?.state}<br />
              {order.deliveryAddress?.postalCode}<br />
              {order.deliveryAddress?.country}
            </address>
          </div>

          <div className="card p-5">
            <h2 className="font-semibold text-content">Contact</h2>
            <p className="mt-3 text-sm text-content-secondary">
              {order.customerInfo?.email}<br />
              {order.customerInfo?.phone}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
