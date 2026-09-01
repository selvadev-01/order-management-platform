/**
 * The behaviour every modal surface owes a keyboard user.
 *
 * Four things, which are only correct together:
 *   1. focus moves into the surface on open,
 *   2. Tab is trapped inside it,
 *   3. Escape closes it,
 *   4. focus returns to whatever opened it.
 *
 * Extracted from Modal so the admin drawer — which is equally modal on mobile,
 * where it is the only navigation — cannot drift from it. A drawer that traps
 * nothing is worse than no dialog role at all, because it claims a containment
 * that isn't there.
 */
import { useEffect } from 'react';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function useDialogBehavior(open, panelRef, onClose, { lockScroll = true } = {}) {
  useEffect(() => {
    if (!open) return undefined;

    const restore = document.activeElement;
    const { overflow } = document.body.style;
    if (lockScroll) document.body.style.overflow = 'hidden';

    const focusable = () => panelRef.current?.querySelectorAll(FOCUSABLE) ?? [];
    (focusable()[0] ?? panelRef.current)?.focus();

    const onKeyDown = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== 'Tab') return;

      const nodes = Array.from(focusable());
      if (nodes.length === 0) return;
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      if (lockScroll) document.body.style.overflow = overflow;
      restore?.focus?.();
    };
  }, [open, onClose, panelRef, lockScroll]);
}