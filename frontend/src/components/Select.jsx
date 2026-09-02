/**
 * Custom select (ARIA listbox).
 *
 * A native <select> renders its open list as an OS-level popup that no CSS can
 * reach, so the list never matches the rest of the product. This replaces it
 * with real DOM we control.
 *
 * That trade means taking on, by hand, everything the native control gave us
 * for free. All of it is implemented below and none of it is optional:
 *
 *   - roving `aria-activedescendant` rather than moving real focus, so the
 *     button keeps focus and the screen reader still announces each option
 *   - Up/Down/Home/End to move, Enter/Space to commit, Escape to cancel
 *   - type-ahead: typing "ho" jumps to "Home & Kitchen"
 *   - the highlighted option is always scrolled into view
 *   - outside pointer-down and Tab both close it
 *   - the list flips above the button when there is no room below
 *
 * `disabled` is honoured. `value`/`onChange` keep the same shape a native
 * select had, so call sites read almost identically.
 */
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { ChevronDownIcon } from './Icons';

/** Options are `{ value, label }`; `value` is matched by strict equality. */
export default function Select({
  options,
  value,
  onChange,
  id,
  disabled,
  placeholder = 'Select…',
  invalid,
  className = '',
  'aria-describedby': describedBy,
  'aria-labelledby': labelledBy,
}) {
  const generatedId = useId();
  const buttonId = id ?? generatedId;
  const listId = `${generatedId}-list`;

  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [flip, setFlip] = useState(false);

  const wrapRef = useRef(null);
  const buttonRef = useRef(null);
  const listRef = useRef(null);
  const typeahead = useRef({ term: '', at: 0 });

  const selectedIndex = options.findIndex((o) => o.value === value);
  const selected = selectedIndex >= 0 ? options[selectedIndex] : null;

  const close = useCallback(({ focusButton = true } = {}) => {
    setOpen(false);
    setActive(-1);
    if (focusButton) buttonRef.current?.focus();
  }, []);

  const commit = useCallback((index) => {
    const option = options[index];
    if (!option) return close();
    onChange(option.value);
    close();
  }, [options, onChange, close]);

  // Open with the current selection highlighted — or the first option when
  // nothing is selected yet, so Enter always has a sensible target.
  const openList = useCallback(() => {
    if (disabled) return;
    setActive(selectedIndex >= 0 ? selectedIndex : 0);
    setOpen(true);
  }, [disabled, selectedIndex]);

  /*
   * Decide direction before paint, not after: measuring in an effect that runs
   * post-paint would show the list in the wrong place for one frame.
   */
  useLayoutEffect(() => {
    if (!open) return;
    const rect = buttonRef.current?.getBoundingClientRect();
    if (!rect) return;
    const below = window.innerHeight - rect.bottom;
    // 16rem matches the list's max-height; flip only when below is too tight
    // *and* above is genuinely roomier.
    setFlip(below < 256 && rect.top > below);
  }, [open]);

  // Keep the highlighted row visible during keyboard navigation.
  useEffect(() => {
    if (!open || active < 0) return;
    listRef.current
      ?.querySelector(`[data-index="${active}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [open, active]);

  // Pointer-down rather than click: a click that starts inside and ends outside
  // should not count as an outside dismissal.
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      if (!wrapRef.current?.contains(e.target)) close({ focusButton: false });
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [open, close]);

  /** Jump to the next option matching what the user has typed so far. */
  const runTypeahead = (key) => {
    const now = Date.now();
    const state = typeahead.current;
    // A pause of ~1s starts a new search rather than extending the old one.
    state.term = now - state.at > 1000 ? key : state.term + key;
    state.at = now;

    const from = active >= 0 ? active : 0;
    const order = [
      ...options.slice(from + 1),
      ...options.slice(0, from + 1),
    ];
    const hit = order.find((o) => o.label.toLowerCase().startsWith(state.term));
    if (!hit) return;
    const index = options.indexOf(hit);
    if (open) setActive(index);
    else commit(index);
  };

  const onKeyDown = (e) => {
    if (disabled) return;

    // Printable single characters drive type-ahead, in both states.
    if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey && e.key !== ' ') {
      e.preventDefault();
      runTypeahead(e.key.toLowerCase());
      return;
    }

    if (!open) {
      if (['Enter', ' ', 'ArrowDown', 'ArrowUp'].includes(e.key)) {
        e.preventDefault();
        openList();
      }
      return;
    }

    switch (e.key) {
      case 'Escape':
        e.preventDefault();
        close();
        break;
      case 'Tab':
        // Let focus leave, but never leave an orphaned popup behind.
        close({ focusButton: false });
        break;
      case 'Enter':
      case ' ':
        e.preventDefault();
        commit(active);
        break;
      case 'ArrowDown':
        e.preventDefault();
        setActive((i) => Math.min(i + 1, options.length - 1));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setActive((i) => Math.max(i - 1, 0));
        break;
      case 'Home':
        e.preventDefault();
        setActive(0);
        break;
      case 'End':
        e.preventDefault();
        setActive(options.length - 1);
        break;
      default:
        break;
    }
  };

  return (
    <div ref={wrapRef} className={`relative ${className}`}>
      <button
        ref={buttonRef}
        id={buttonId}
        type="button"
        disabled={disabled}
        onClick={() => (open ? close() : openList())}
        onKeyDown={onKeyDown}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open && active >= 0 ? `${listId}-${active}` : undefined}
        aria-labelledby={labelledBy ? `${labelledBy} ${buttonId}` : undefined}
        aria-describedby={describedBy}
        aria-invalid={invalid || undefined}
        className={`input flex items-center justify-between gap-2 text-left ${
          invalid ? 'input-error' : ''
        } ${disabled ? 'cursor-not-allowed opacity-50' : ''}`}
      >
        <span className={`truncate ${selected ? '' : 'text-content-subtle'}`}>
          {selected ? selected.label : placeholder}
        </span>
        <ChevronDownIcon
          className={`h-4 w-4 shrink-0 text-content-subtle transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open && (
        <ul
          ref={listRef}
          id={listId}
          role="listbox"
          aria-labelledby={labelledBy}
          tabIndex={-1}
          className={`absolute z-50 max-h-64 w-full overflow-y-auto rounded-control border border-line bg-surface py-1 shadow-floating ${
            flip ? 'bottom-full mb-1' : 'top-full mt-1'
          }`}
        >
          {options.map((o, i) => {
            const isSelected = o.value === value;
            return (
              <li
                key={o.value}
                id={`${listId}-${i}`}
                data-index={i}
                role="option"
                aria-selected={isSelected}
                // Pointer-down, not click: the button must not lose focus
                // before the selection is committed.
                onPointerDown={(e) => { e.preventDefault(); commit(i); }}
                onPointerEnter={() => setActive(i)}
                className={`cursor-pointer px-3 py-2.5 text-meta ${
                  i === active ? 'bg-primary-soft text-primary-text' : 'text-content'
                } ${isSelected ? 'font-medium' : ''}`}
              >
                {o.label}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}