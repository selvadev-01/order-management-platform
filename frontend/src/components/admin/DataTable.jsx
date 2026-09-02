/**
 * Responsive data table.
 *
 * The single biggest source of duplication in the previous admin screens was
 * that each one hand-wrote a desktop <table> *and* a parallel stack of mobile
 * cards, plus its own loading, empty and error branches. That is four copies of
 * the same logic per screen, kept in sync by hand.
 *
 * Here a screen declares its columns once. Each column carries how it renders
 * and, optionally, where it belongs on a narrow screen:
 *
 *   { key, header, cell, mobile: 'title' | 'meta' | 'trailing' | 'badge' | false,
 *     align, className }
 *
 * Desktop gets the table; below `breakpoint` the same column definitions are
 * reassembled into cards. Neither view can go stale, because there is only one
 * definition.
 */
import { LoadingRows, EmptyState, ErrorState } from '../States';

/**
 * @param {object} p
 * @param {Array}  p.columns    Column definitions (see above).
 * @param {Array}  p.rows       Row data.
 * @param {Function} p.rowKey   Row → stable key.
 * @param {'loading'|'error'|'success'} p.state
 * @param {string} p.breakpoint Tailwind prefix at which the table appears.
 */
export default function DataTable({
  columns,
  rows,
  rowKey,
  state = 'success',
  error,
  onRetry,
  empty,
  breakpoint = 'md',
  rowClassName,
  caption,
}) {
  if (state === 'loading') return <LoadingRows count={5} />;
  if (state === 'error') return <ErrorState error={error} onRetry={onRetry} />;
  if (!rows?.length) return empty ?? <EmptyState title="Nothing here yet" />;

  // Tailwind cannot see interpolated class names, so the pairs are written out
  // in full for the two breakpoints this table is used at.
  const vis = breakpoint === 'lg'
    ? { table: 'hidden lg:block', cards: 'lg:hidden' }
    : { table: 'hidden md:block', cards: 'md:hidden' };

  const pick = (where) => columns.filter((c) => c.mobile === where);
  const align = (c) => (c.align === 'right' ? 'text-right' : c.align === 'center' ? 'text-center' : 'text-left');

  return (
    <>
      {/* Desktop: a real table, so screen readers announce row/column context. */}
      <div className={`${vis.table} admin-panel overflow-hidden`}>
        <table className="w-full text-meta">
          {caption && <caption className="sr-only">{caption}</caption>}
          <thead className="border-b border-line bg-surface-sunken">
            <tr>
              {columns.map((c) => (
                <th
                  key={c.key}
                  scope="col"
                  className={`px-4 py-3 text-eyebrow font-semibold uppercase tracking-wide text-content-muted ${align(c)}`}
                >
                  {c.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-line-subtle">
            {rows.map((row) => (
              <tr
                key={rowKey(row)}
                className={`transition hover:bg-surface-sunken/75 focus-within:bg-surface-sunken/75 ${rowClassName?.(row) ?? ''}`}
              >
                {columns.map((c) => (
                  <td key={c.key} className={`px-4 py-3 align-middle ${align(c)} ${c.className ?? ''}`}>
                    {c.cell(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Narrow: the same columns, regrouped. No horizontal scrolling. */}
      <div className={`${vis.cards} space-y-3`}>
        {rows.map((row) => (
          <div key={rowKey(row)} className={`admin-panel p-4 ${rowClassName?.(row) ?? ''}`}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 space-y-1">
                {pick('title').map((c) => (
                  <div key={c.key} className="font-medium text-content">{c.cell(row)}</div>
                ))}
                {pick('meta').map((c) => (
                  <div key={c.key} className="text-eyebrow text-content-muted">{c.cell(row)}</div>
                ))}
              </div>
              <div className="shrink-0 text-right">
                {pick('trailing').map((c) => (
                  <div key={c.key} className="font-semibold tabular-nums text-content">{c.cell(row)}</div>
                ))}
              </div>
            </div>

            {(pick('badge').length > 0 || pick('actions').length > 0) && (
              <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-line-subtle pt-3">
                {pick('badge').map((c) => (
                  <div key={c.key}>{c.cell(row)}</div>
                ))}
                {pick('actions').length > 0 && (
                  <div className="ml-auto flex items-center gap-2">
                    {pick('actions').map((c) => (
                      <div key={c.key}>{c.cell(row)}</div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </>
  );
}

/* ------------------------------------------------- shared cell renderers */

/** Primary identifier cell: a bold line with optional muted second line. */
export function CellStack({ primary, secondary }) {
  return (
    <div className="min-w-0">
      <span className="block truncate font-medium text-content">{primary}</span>
      {secondary && <span className="block truncate text-eyebrow text-content-muted">{secondary}</span>}
    </div>
  );
}

/** Right-aligned action cluster, so every table's buttons line up alike. */
export function CellActions({ children }) {
  return <div className="flex items-center justify-end gap-1.5">{children}</div>;
}

/**
 * Icon-only table button.
 *
 * `label` is required — an icon button with no accessible name is unusable with
 * a screen reader, so the API does not allow omitting it.
 */
export function IconButton({ icon: IconCmp, label, onClick, disabled, tone = 'default' }) {
  const tones = {
    default: 'text-content-muted hover:bg-surface-hover hover:text-content-secondary',
    danger: 'text-content-muted hover:bg-danger-soft hover:text-danger',
  };
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      /* 44px on touch, dropping to 36px from lg up — where the table view takes
         over and row density is worth more than an oversized hit area. */
      className={`grid h-11 w-11 cursor-pointer place-items-center rounded-control transition disabled:cursor-not-allowed disabled:opacity-40 lg:h-9 lg:w-9 ${tones[tone]}`}
    >
      <IconCmp className="h-4 w-4" />
    </button>
  );
}
