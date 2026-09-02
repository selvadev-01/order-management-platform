/**
 * My orders (US-PAY-5) and notifications (US-NOTIF-6).
 *
 * Both reuse the shared list-state components rather than reimplementing the
 * four states.
 */
import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, qs } from '../services/api';
import { useFetch } from '../hooks/useFetch';
import { formatMoney, formatDateTime, statusClasses } from '../utils/format';
import { LoadingRows, EmptyState, ErrorState, Spinner } from '../components/States';
import { pushSupport, permissionState, currentSubscription, enablePush } from '../services/push';
import { useDocumentTitle } from "../hooks/useDocumentTitle";
import { BellIcon, BellOffIcon, OrdersIcon } from '../components/Icons';

export default function Orders() {
  useDocumentTitle("My orders");
  const [params, setParams] = useSearchParams();
  const page = Number(params.get('page') ?? 1);

  const { data, state, error, refetch } = useFetch(
    ({ signal }) => api.get(`/api/orders${qs({ page, limit: 10 })}`, { signal }),
    [page],
  );

  const items = data?.items ?? [];

  // Built from the existing params rather than replacing them wholesale, so
  // paging cannot silently drop any other query state on the URL.
  const goToPage = (next) => {
    const updated = new URLSearchParams(params);
    updated.set('page', String(next));
    setParams(updated);
  };

  return (
    <div>
      <h1 className="mb-6 text-display font-semibold text-content">My orders</h1>

      {state === 'loading' && <LoadingRows count={4} />}
      {state === 'error' && <ErrorState error={error} onRetry={refetch} />}

      {state === 'success' && items.length === 0 && (
        <EmptyState
          icon={OrdersIcon}
          title="No orders yet"
          message="Your orders will appear here once you place one."
          action={<Link to="/products" className="btn-primary">Browse products</Link>}
        />
      )}

      {state === 'success' && items.length > 0 && (
        <>
          <div className="space-y-3">
            {items.map((o) => (
              <Link
                key={o.id}
                to={`/orders/${o.id}`}
                className="card block p-4 transition hover:shadow-floating sm:p-5"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium text-content">Order {o.id.slice(-8)}</p>
                    <p className="mt-0.5 text-meta text-content-muted">
                      {formatDateTime(o.createdAt)} · {o.itemCount} item{o.itemCount === 1 ? '' : 's'}
                    </p>
                    {o.firstItem && (
                      <p className="mt-1 truncate text-meta text-content-secondary">
                        {o.firstItem}
                        {o.itemCount > 1 && ` and ${o.itemCount - 1} more`}
                      </p>
                    )}
                  </div>

                  <div className="flex flex-col items-end gap-2">
                    <span className="font-semibold text-content">{formatMoney(o.totalAmount)}</span>
                    <div className="flex flex-wrap justify-end gap-1.5">
                      <span className={statusClasses(o.orderStatus)}>{o.orderStatus}</span>
                      <span className={statusClasses(o.paymentStatus)}>
                        {o.paymentStatus === 'Paid' ? 'Paid' : `Payment ${o.paymentStatus}`}
                      </span>
                    </div>
                  </div>
                </div>
              </Link>
            ))}
          </div>

          {data.totalPages > 1 && (
            <nav className="mt-8 flex items-center justify-center gap-3" aria-label="Pagination">
              <button
                type="button"
                className="btn-secondary"
                disabled={!data.hasPrev || state === 'loading'}
                onClick={() => goToPage(page - 1)}
              >
                Previous
              </button>
              {/* A status, not a link: aria-current on static text says nothing,
                  but announcing the change of page does. */}
              <span className="text-meta text-content-secondary" role="status" aria-live="polite">
                Page {data.page} of {data.totalPages}
              </span>
              <button
                type="button"
                className="btn-secondary"
                disabled={!data.hasNext || state === 'loading'}
                onClick={() => goToPage(page + 1)}
              >
                Next
              </button>
            </nav>
          )}
        </>
      )}
    </div>
  );
}

/**
 * Push status notice (US-NOTIF-5).
 *
 * Push is enabled automatically on login, so there is no control here. This
 * surfaces only the state the user must resolve themselves: a browser that has
 * blocked notifications cannot be re-prompted by the page — only site settings
 * can undo it — so saying nothing would leave the silence unexplained.
 */
/**
 * Push delivery status for this device (docx §10 — the required states made
 * visible for a feature that otherwise fails silently).
 *
 * `autoEnablePush()` deliberately swallows every failure so a declined or
 * unavailable push never disturbs the session. That is right for the session
 * but leaves the user — and anyone debugging — unable to tell "push is working"
 * from "push never subscribed". This surfaces the distinction.
 *
 * The load-bearing case is `unsubscribed`: permission is granted and the
 * browser is capable, yet no subscription reached the server. That is what an
 * unreachable API or an unconfigured VAPID key looks like, and without a state
 * for it the failure is invisible.
 */
function PushNotice() {
  const { supported, reason } = pushSupport();
  const [permission, setPermission] = useState(permissionState());
  /** 'checking' | 'subscribed' | 'unsubscribed' — server-side truth. */
  const [subscription, setSubscription] = useState('checking');
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState(null);

  /**
   * Re-read both the permission and the subscription.
   *
   * Permission can change in another tab, and the subscription can appear
   * asynchronously — `autoEnablePush()` runs unawaited on login, so a mount
   * that happens first would otherwise cache "unsubscribed" forever.
   */
  useEffect(() => {
    if (!supported) return undefined;

    let cancelled = false;

    const sync = async () => {
      setPermission(permissionState());
      const sub = await currentSubscription().catch(() => null);
      if (!cancelled) setSubscription(sub ? 'subscribed' : 'unsubscribed');
    };

    sync();
    window.addEventListener('focus', sync);
    return () => {
      cancelled = true;
      window.removeEventListener('focus', sync);
    };
  }, [supported]);

  /** Manual retry — the path out of every recoverable failure above. */
  const enable = async () => {
    setBusy(true);
    setFailure(null);
    try {
      await enablePush();
      setPermission(permissionState());
      setSubscription('subscribed');
    } catch (err) {
      setPermission(permissionState());
      setFailure(err?.message ?? 'Could not enable notifications.');
    } finally {
      setBusy(false);
    }
  };

  // Nothing this browser can do — IE and any pre-service-worker browser, or a
  // page served over plain HTTP.
  if (!supported) {
    return (
      <Notice icon={BellOffIcon}>
        {reason} Your notifications are still listed below.
      </Notice>
    );
  }

  // Only the user can undo this, and only in site settings — no button helps.
  if (permission === 'denied') {
    return (
      <Notice icon={BellOffIcon} title="Notifications are blocked">
        Your browser is blocking notifications for this site, so order updates will not reach this
        device. Allow notifications in your browser’s site settings, then reload. They are still
        listed below.
      </Notice>
    );
  }

  // Working as intended: say nothing rather than adding permanent chrome.
  if (subscription === 'subscribed' && !failure) return null;

  // Avoid flashing a prompt during the initial check.
  if (subscription === 'checking' && !failure) return null;

  return (
    <Notice icon={BellIcon} title="Push notifications are off on this device">
      {failure ?? 'Order and payment updates will only appear in this list until you turn them on.'}
      <div className="mt-3">
        <button type="button" onClick={enable} disabled={busy} className="btn-secondary">
          {busy && <Spinner />}
          {busy ? 'Enabling…' : 'Enable notifications'}
        </button>
      </div>
    </Notice>
  );
}

/** Shared shell for the notices above, so all three read identically. */
function Notice({ icon: IconCmp, title, children }) {
  return (
    <div className="card mb-6 p-4" role="status">
      <div className="flex items-start gap-2">
        <IconCmp className="mt-0.5 h-4 w-4 shrink-0 text-content-subtle" />
        <div>
          {title && <p className="font-medium text-content">{title}</p>}
          <div className={`text-meta text-content-secondary${title ? ' mt-0.5' : ''}`}>{children}</div>
        </div>
      </div>
    </div>
  );
}

export function Notifications() {
  const { data, state, error, refetch } = useFetch(
    ({ signal }) => api.get('/api/notifications?limit=20', { signal }),
    [],
  );

  const items = data?.items ?? [];

  return (
    <div>
      <h1 className="mb-6 text-display font-semibold text-content">Notifications</h1>

      <PushNotice />

      {state === 'loading' && <LoadingRows count={4} />}
      {state === 'error' && <ErrorState error={error} onRetry={refetch} />}

      {state === 'success' && items.length === 0 && (
        <EmptyState
          icon={BellIcon}
          title="No notifications yet"
          message="Updates about your orders will appear here."
        />
      )}

      {state === 'success' && items.length > 0 && (
        <ul className="space-y-3">
          {items.map((n) => {
            const body = (
              <>
                <div className="flex items-start justify-between gap-3">
                  <p className="font-medium text-content">{n.title}</p>
                  <span className="shrink-0 text-eyebrow text-content-subtle">{formatDateTime(n.createdAt)}</span>
                </div>
                <p className="mt-1 text-meta text-content-secondary">{n.body}</p>
              </>
            );

            // A notification whose order was deleted renders without a link.
            return (
              <li key={n.id}>
                {n.orderId ? (
                  <Link to={`/orders/${n.orderId}`} className="card block p-4 transition hover:shadow-floating">
                    {body}
                  </Link>
                ) : (
                  <div className="card p-4">{body}</div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
