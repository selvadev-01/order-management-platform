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
import { LoadingRows, EmptyState, ErrorState } from '../components/States';
import { pushSupport, permissionState } from '../services/push';
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
      <h1 className="mb-6 text-2xl font-semibold text-content">My orders</h1>

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
                className="card block p-4 transition hover:shadow-md sm:p-5"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium text-content">Order {o.id.slice(-8)}</p>
                    <p className="mt-0.5 text-sm text-content-muted">
                      {formatDateTime(o.createdAt)} · {o.itemCount} item{o.itemCount === 1 ? '' : 's'}
                    </p>
                    {o.firstItem && (
                      <p className="mt-1 truncate text-sm text-content-secondary">
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
              <span className="text-sm text-content-secondary" role="status" aria-live="polite">
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
function PushNotice() {
  const { supported, reason } = pushSupport();
  const [permission, setPermission] = useState(permissionState());

  // The user may change the site setting in another tab; re-read on focus so
  // a resolved block stops being reported as one.
  useEffect(() => {
    const sync = () => setPermission(permissionState());
    window.addEventListener('focus', sync);
    return () => window.removeEventListener('focus', sync);
  }, []);

  if (!supported) {
    return (
      <div className="card mb-6 p-4">
        <p className="flex items-start gap-2 text-sm text-content-secondary">
          <BellOffIcon className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{reason} Your notifications are still listed below.</span>
        </p>
      </div>
    );
  }

  if (permission !== 'denied') return null;

  return (
    <div className="card mb-6 p-4">
      <p className="font-medium text-content">Notifications are blocked</p>
      <p className="mt-0.5 text-sm text-content-secondary">
        Your browser is blocking notifications for this site, so order updates will not reach this
        device. Allow notifications in your browser’s site settings to receive them. They are still
        listed below.
      </p>
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
      <h1 className="mb-6 text-2xl font-semibold text-content">Notifications</h1>

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
                  <span className="shrink-0 text-xs text-content-subtle">{formatDateTime(n.createdAt)}</span>
                </div>
                <p className="mt-1 text-sm text-content-secondary">{n.body}</p>
              </>
            );

            // A notification whose order was deleted renders without a link.
            return (
              <li key={n.id}>
                {n.orderId ? (
                  <Link to={`/orders/${n.orderId}`} className="card block p-4 transition hover:shadow-md">
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
