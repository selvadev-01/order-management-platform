/**
 * Toast notifications — the success and API-failure states (docx §10).
 *
 * Rendered into aria-live regions so asynchronous outcomes are announced to
 * screen reader users, not just shown visually (US-PDP-3 design notes). Errors
 * and successes get separate regions with different urgencies; see the render
 * below for why.
 *
 * Dismissal is timer-based but pauses while a toast is hovered or focused, so a
 * toast carrying an action cannot vanish mid-reach (WCAG 2.2.1).
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { CloseIcon } from '../components/Icons';

const ToastContext = createContext(null);

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  // Timers are held here rather than left to fire blindly, so a toast the user
  // is currently reading or tabbing through can have its dismissal paused.
  const timers = useRef(new Map());

  const dismiss = useCallback((id) => {
    const timer = timers.current.get(id);
    if (timer) {
      clearTimeout(timer.handle);
      timers.current.delete(id);
    }
    setToasts((t) => t.filter((x) => x.id !== id));
  }, []);

  const schedule = useCallback((id, duration) => {
    if (!duration) return;
    const handle = setTimeout(() => dismiss(id), duration);
    timers.current.set(id, { handle, duration });
  }, [dismiss]);

  /** Hold a toast open while the pointer or keyboard focus is inside it. */
  const hold = useCallback((id) => {
    const timer = timers.current.get(id);
    if (!timer) return;
    clearTimeout(timer.handle);
    timers.current.set(id, { handle: null, duration: timer.duration });
  }, []);

  /** Restart the full duration once the user moves away — never a remainder,
   *  which would give them less time than the toast originally promised. */
  const release = useCallback((id) => {
    const timer = timers.current.get(id);
    if (!timer || timer.handle) return;
    schedule(id, timer.duration);
  }, [schedule]);

  const push = useCallback((message, { type = 'success', action, duration = 4000 } = {}) => {
    const id = Math.random().toString(36).slice(2);
    setToasts((t) => [...t, { id, message, type, action }]);
    schedule(id, duration);
    return id;
  }, [schedule]);

  // Clear every outstanding timer if the provider goes away mid-flight.
  useEffect(() => {
    const pending = timers.current;
    return () => {
      pending.forEach((t) => t.handle && clearTimeout(t.handle));
      pending.clear();
    };
  }, []);

  const value = useMemo(() => ({
    toast: push,
    success: (m, o) => push(m, { ...o, type: 'success' }),
    error: (m, o) => push(m, { ...o, type: 'error' }),
    dismiss,
  }), [push, dismiss]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      {/*
        * Two regions, not one. A failure ("Payment cancelled") must interrupt
        * whatever the screen reader is saying; a success may politely wait its
        * turn. A single region would force both to the same urgency.
        */}
      <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-full max-w-sm flex-col gap-2 px-4 sm:px-0">
        <div className="flex flex-col gap-2" role="alert" aria-live="assertive">
          {toasts.filter((t) => t.type === 'error').map((t) => (
            <Toast key={t.id} toast={t} onDismiss={dismiss} onHold={hold} onRelease={release} />
          ))}
        </div>
        <div className="flex flex-col gap-2" role="status" aria-live="polite">
          {toasts.filter((t) => t.type !== 'error').map((t) => (
            <Toast key={t.id} toast={t} onDismiss={dismiss} onHold={hold} onRelease={release} />
          ))}
        </div>
      </div>
    </ToastContext.Provider>
  );
}

/**
 * A single toast.
 *
 * Pointer and focus both pause the dismissal timer: a toast can carry an
 * interactive control ("View cart"), and having it vanish out from under
 * someone tabbing toward it is exactly the WCAG 2.2.1 failure to avoid.
 */
function Toast({ toast, onDismiss, onHold, onRelease }) {
  return (
    <div
      className={`pointer-events-auto flex items-start gap-3 rounded-control px-4 py-3 shadow-floating ${
        toast.type === 'error' ? 'bg-danger text-content-inverse' : 'bg-surface-inverse text-content-inverse'
      }`}
      onMouseEnter={() => onHold(toast.id)}
      onMouseLeave={() => onRelease(toast.id)}
      onFocus={() => onHold(toast.id)}
      onBlur={() => onRelease(toast.id)}
    >
      <p className="flex-1 py-2 text-meta">{toast.message}</p>
      {toast.action}
      {/* Sized to a real touch target rather than the glyph's own bounds. */}
      <button
        type="button"
        onClick={() => onDismiss(toast.id)}
        className="-mr-2 grid h-11 w-11 shrink-0 place-items-center rounded-control text-content-inverse/70 transition hover:bg-white/10 hover:text-content-inverse"
        aria-label="Dismiss notification"
      >
        <CloseIcon className="h-4 w-4" />
      </button>
    </div>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside ToastProvider');
  return ctx;
}
