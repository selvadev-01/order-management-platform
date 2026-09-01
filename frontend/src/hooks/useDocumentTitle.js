/**
 * Sets the browser tab title per route.
 *
 * index.html carries one static title, so without this every route is
 * indistinguishable in browser history, in the tab strip, and — the reason it
 * matters most — in the page-change announcement a screen reader makes on
 * navigation.
 *
 * The suffix is appended here rather than at each call site so pages pass only
 * their own name and the product name can never drift between routes.
 */
import { useEffect } from 'react';

const SUFFIX = 'Order Platform';

export function useDocumentTitle(title) {
  useEffect(() => {
    const previous = document.title;
    document.title = title ? `${title} — ${SUFFIX}` : SUFFIX;
    // Restore on unmount so a route that sets no title of its own cannot
    // inherit the previous route's.
    return () => { document.title = previous; };
  }, [title]);
}