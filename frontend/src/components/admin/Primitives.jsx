/**
 * Admin UI primitives.
 *
 * The vocabulary every admin screen is built from. Nothing here knows about
 * products, orders or queues — screens compose these, so a change to (say)
 * panel padding or modal focus behaviour happens once rather than five times.
 *
 * Kept deliberately small: a primitive earns its place only when at least two
 * screens need it.
 */
import { useId, useRef } from 'react';
import { Spinner } from '../States';
import { useDialogBehavior } from '../../hooks/useDialogBehavior';
import { Tone } from '../../utils/status';
import { CloseIcon, ChevronLeftIcon, ChevronRightIcon, SearchIcon } from '../Icons';

/* ------------------------------------------------------------------ layout */

/**
 * A titled surface. `actions` sit opposite the title; `bodyClass` is escape
 * hatch enough for the one case (tables) that needs zero padding.
 */
export function Panel({ title, description, actions, children, bodyClass = 'p-4 sm:p-5' }) {
  return (
    <section className="admin-panel">
      {(title || actions) && (
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3.5 sm:px-5">
          <div className="min-w-0">
            {title && <h2 className="text-meta font-semibold text-content">{title}</h2>}
            {description && <p className="mt-0.5 text-eyebrow text-content-muted">{description}</p>}
          </div>
          {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={bodyClass}>{children}</div>
    </section>
  );
}

/** Page title block. Every admin route opens with exactly this. */
export function PageHeader({ title, description, actions }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3 sm:mb-6">
      <div>
        <h1 className="text-title font-semibold text-content">{title}</h1>
        {description && <p className="mt-1 text-meta text-content-muted">{description}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

/**
 * Filter/search bar above a table. Children are the filter controls; `search`
 * renders the debounced-input slot on the left when a screen wants one.
 */
export function Toolbar({ children }) {
  return <div className="mb-4 flex flex-wrap items-center gap-2">{children}</div>;
}

/** Labelled search input used by the toolbar. Controlled by the caller. */
export function SearchInput({ value, onChange, placeholder = 'Search…', label = 'Search' }) {
  const id = useId();
  return (
    <div className="relative min-w-0 flex-1 sm:max-w-xs">
      <label htmlFor={id} className="sr-only">{label}</label>
      <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-content-subtle" />
      <input
        id={id}
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="input h-10 py-0 pl-9"
      />
    </div>
  );
}

/**
 * Segmented filter, e.g. the order-status row.
 *
 * A real button group with aria-pressed rather than styled divs, so the current
 * filter is announced and reachable by keyboard.
 */
export function FilterChips({ options, value, onChange, label }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label={label}>
      {options.map((o) => {
        const active = value === o.value;
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            aria-pressed={active}
            className={`inline-flex cursor-pointer items-center gap-1.5 rounded-control border px-3 py-1.5 text-meta font-medium transition ${
              active
                ? 'border-primary-border bg-primary-soft text-primary-text'
                : 'border-line-strong bg-surface text-content-secondary hover:bg-surface-sunken'
            }`}
          >
            {o.label}
            {o.count != null && (
              <span className={`tabular-nums ${active ? 'text-primary' : 'text-content-subtle'}`}>{o.count}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ metrics */

/**
 * KPI tile.
 *
 * `tone` colours only the icon chip — never the number, which stays high
 * contrast. `loading` renders a same-size skeleton so the row does not reflow
 * when figures arrive.
 */
/**
 * Icon-chip styling per semantic tone.
 *
 * Keyed by the shared `Tone` vocabulary from utils/status.js, so a StatCard and
 * a status badge that both say "warning" cannot disagree about what warning
 * looks like.
 */
const TONES = {
  [Tone.PRIMARY]: 'bg-primary-soft text-primary-text',
  [Tone.SUCCESS]: 'bg-success-soft text-success',
  [Tone.WARNING]: 'bg-warning-soft text-warning-text',
  [Tone.DANGER]: 'bg-danger-soft text-danger-text',
  [Tone.NEUTRAL]: 'bg-surface-hover text-content-secondary',
};

export function StatCard({ label, value, hint, icon: IconCmp, tone = Tone.PRIMARY, loading }) {
  return (
    <div className="admin-panel p-4">
      <div className="flex items-start justify-between gap-3">
        <p className="text-eyebrow font-semibold uppercase text-content-muted">{label}</p>
        {IconCmp && (
          <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-control ${TONES[tone]}`}>
            <IconCmp className="h-4 w-4" />
          </span>
        )}
      </div>
      {loading ? (
        <div className="mt-2 h-8 w-24 animate-pulse rounded bg-surface-active" />
      ) : (
        // Tabular figures: the numbers sit in a grid and must not jitter as
        // they update.
        <p className="mt-1.5 text-title font-semibold tabular-nums text-content">{value}</p>
      )}
      {hint && !loading && <p className="mt-1 text-eyebrow text-content-muted">{hint}</p>}
    </div>
  );
}

/* ------------------------------------------------------------------- dialog */

/**
 * Modal dialog.
 *
 * Owns the behaviour that is easy to get wrong and must not be re-typed per
 * screen: focus moves in on open and returns to the trigger on close, Escape
 * and backdrop-click dismiss, Tab is trapped, and the page behind cannot
 * scroll.
 */
export function Modal({ open, onClose, title, description, children, footer, size = 'md', role = 'dialog' }) {
  const panelRef = useRef(null);
  const titleId = useId();
  const descId = useId();

  // Focus entry, tab trap, Escape and focus restore — shared with the admin
  // drawer so the two modal surfaces behave identically.
  useDialogBehavior(open, panelRef, onClose);

  if (!open) return null;

  const widths = { sm: 'max-w-sm', md: 'max-w-lg', lg: 'max-w-2xl' };

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-scrim/50 p-4 backdrop-blur-sm"
      // Backdrop click closes; the check keeps clicks inside the panel from
      // bubbling up as a dismissal.
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        ref={panelRef}
        role={role}
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descId : undefined}
        tabIndex={-1}
        className={`admin-panel w-full ${widths[size]} rounded-overlay shadow-overlay outline-none`}
      >
        <header className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
          <div>
            <h2 id={titleId} className="font-semibold text-content">{title}</h2>
            {description && <p id={descId} className="mt-1 text-meta text-content-muted">{description}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close dialog"
            className="-mr-1 -mt-1 cursor-pointer rounded-control p-1.5 text-content-subtle transition hover:bg-surface-hover hover:text-content-secondary"
          >
            <CloseIcon className="h-5 w-5" />
          </button>
        </header>

        {/* Omitted entirely when there is no body — a confirm dialog carries
            all its text in the header, and an empty padded div would leave a
            visible gap above the footer. */}
        {children && <div className="px-5 py-4">{children}</div>}

        {footer && (
          <footer className="flex justify-end gap-2 border-t border-line bg-surface-sunken px-5 py-3.5">
            {footer}
          </footer>
        )}
      </div>
    </div>
  );
}

/**
 * Destructive-action confirmation.
 *
 * Built on Modal so the one dangerous path in the panel cannot drift from the
 * dialog behaviour everywhere else. Cancel is focused first, deliberately.
 */
export function ConfirmDialog({ open, onCancel, onConfirm, title, message, confirmLabel = 'Delete', busy }) {
  return (
    <Modal
      open={open}
      onClose={busy ? () => {} : onCancel}
      title={title}
      // The consequence text is the whole point of the dialog, so it is passed
      // as the description — which wires aria-describedby — rather than as
      // loose children a screen reader would never announce on open.
      description={message}
      role="alertdialog"
      size="sm"
      footer={
        <>
          <button type="button" onClick={onCancel} disabled={busy} className="btn-secondary">
            Cancel
          </button>
          <button type="button" onClick={onConfirm} disabled={busy} className="btn-danger">
            {busy && <Spinner />}
            {busy ? 'Working…' : confirmLabel}
          </button>
        </>
      }
    />
  );
}

/* --------------------------------------------------------------- pagination */

/** Shared pager. Accepts the exact envelope the list endpoints return. */
export function Pagination({ page, totalPages, onChange, hasPrev, hasNext }) {
  if (!totalPages || totalPages <= 1) return null;

  const prevDisabled = hasPrev != null ? !hasPrev : page <= 1;
  const nextDisabled = hasNext != null ? !hasNext : page >= totalPages;

  return (
    <nav className="mt-5 flex items-center justify-between gap-3" aria-label="Pagination">
      <button
        type="button"
        className="btn-secondary h-9 px-3 py-0"
        disabled={prevDisabled}
        onClick={() => onChange(page - 1)}
      >
        <ChevronLeftIcon className="h-4 w-4" />
        Previous
      </button>
      <p className="text-meta tabular-nums text-content-secondary" aria-live="polite">
        Page {page} of {totalPages}
      </p>
      <button
        type="button"
        className="btn-secondary h-9 px-3 py-0"
        disabled={nextDisabled}
        onClick={() => onChange(page + 1)}
      >
        Next
        <ChevronRightIcon className="h-4 w-4" />
      </button>
    </nav>
  );
}