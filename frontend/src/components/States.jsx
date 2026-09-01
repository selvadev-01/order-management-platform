/**
 * The six required UI states (docx §10, US-SYS-8).
 *
 * Built once here and reused by every list screen — the listing, cart, orders,
 * notifications, and both admin tables — so the states are genuinely
 * consistent rather than reimplemented per page.
 */
import { AlertIcon, BoxIcon, PlugOffIcon } from './Icons';

/**
 * Skeleton cards matching real card dimensions, so the layout does not shift
 * when data arrives (US-PROD-5 design notes).
 */
export function LoadingGrid({ count = 8 }) {
  return (
    <div
      className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
      role="status"
      aria-label="Loading products"
    >
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="card overflow-hidden">
          <div className="aspect-[4/3] animate-pulse bg-surface-active" />
          <div className="space-y-2 p-4">
            <div className="h-4 w-3/4 animate-pulse rounded bg-surface-active" />
            <div className="h-3 w-full animate-pulse rounded bg-surface-hover" />
            <div className="h-5 w-1/3 animate-pulse rounded bg-surface-active" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function LoadingRows({ count = 5 }) {
  return (
    <div className="space-y-3" role="status" aria-label="Loading">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="card flex items-center gap-4 p-4">
          <div className="h-14 w-14 shrink-0 animate-pulse rounded-lg bg-surface-active" />
          <div className="flex-1 space-y-2">
            <div className="h-4 w-1/3 animate-pulse rounded bg-surface-active" />
            <div className="h-3 w-1/4 animate-pulse rounded bg-surface-hover" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function Spinner({ className = 'h-4 w-4' }) {
  return (
    <svg className={`animate-spin ${className}`} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
    </svg>
  );
}

/**
 * Empty state.
 *
 * `filtered` selects the wording: an empty catalogue and a search that matched
 * nothing are different situations and must read differently (US-PROD-5 AC2 vs AC3).
 */
export function EmptyState({ title, message, action, icon: IconCmp = BoxIcon }) {
  return (
    <div className="card flex flex-col items-center px-6 py-16 text-center" role="status">
      <span className="mb-4 grid h-12 w-12 place-items-center rounded-full bg-surface-hover text-content-subtle">
        <IconCmp className="h-6 w-6" />
      </span>
      <h3 className="text-base font-semibold text-content">{title}</h3>
      {message && <p className="mt-1.5 max-w-sm text-sm text-content-muted">{message}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

/**
 * Compact empty state for a panel body.
 *
 * The full EmptyState card is a page-level surface — inside an admin panel that
 * already has its own border and heading, it reads as a card within a card. This
 * keeps the semantics (`role="status"`, so "nothing here" is announced) without
 * the chrome.
 */
export function EmptyNotice({ message, icon: IconCmp }) {
  return (
    <div className="flex flex-col items-center gap-2 py-6 text-center text-sm text-content-muted" role="status">
      {IconCmp && <IconCmp className="h-5 w-5 text-content-subtle" />}
      <p>{message}</p>
    </div>
  );
}

/** Error state with a retry route (US-PROD-5 AC4/AC5). */
export function ErrorState({ error, onRetry, retrying }) {
  const offline = error?.status === 0;
  return (
    <div className="card flex flex-col items-center px-6 py-16 text-center" role="alert">
      <span className="mb-4 grid h-12 w-12 place-items-center rounded-full bg-danger-soft text-danger">
        {offline ? <PlugOffIcon className="h-6 w-6" /> : <AlertIcon className="h-6 w-6" />}
      </span>
      <h3 className="text-base font-semibold text-content">
        {offline ? 'Cannot reach the server' : 'Something went wrong'}
      </h3>
      <p className="mt-1.5 max-w-sm text-sm text-content-muted">
        {error?.message ?? 'Please try again.'}
      </p>
      {onRetry && (
        <button type="button" onClick={onRetry} disabled={retrying} className="btn-secondary mt-5">
          {retrying && <Spinner />}
          {retrying ? 'Retrying…' : 'Try again'}
        </button>
      )}
    </div>
  );
}

/** Inline form-level error banner, announced to screen readers. */
export function FormError({ message }) {
  if (!message) return null;
  return (
    <div className="rounded-lg border border-danger-border bg-danger-soft px-3.5 py-2.5 text-sm text-danger-text" role="alert">
      {message}
    </div>
  );
}

/**
 * Field-level validation message, linked to its input via aria-describedby.
 *
 * `role="alert"` is load-bearing, not decoration: the element is mounted only
 * once a message exists, and adding a description to an input that already has
 * focus is not re-announced by most screen readers without it.
 */
export function FieldError({ id, message }) {
  if (!message) return null;
  return (
    <p id={id} className="mt-1.5 text-sm text-danger" role="alert">
      {message}
    </p>
  );
}

/** Status pill — text plus colour, never colour alone (accessibility). */
export function StatusBadge({ status, className = '' }) {
  return <span className={`badge ${className}`}>{status}</span>;
}
