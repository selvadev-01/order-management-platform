/**
 * Shared data-fetching state machine (US-PROD-5, US-SYS-8).
 *
 * State is modelled explicitly as idle | loading | success | error, so "empty"
 * and "not yet loaded" can never be confused — the distinction the loading and
 * empty states depend on.
 *
 * Every list screen uses this rather than reimplementing the four states.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

export function useFetch(fetcher, deps = [], { immediate = true } = {}) {
  const [state, setState] = useState(immediate ? 'loading' : 'idle');
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const abortRef = useRef(null);
  const mounted = useRef(true);

  // Re-arm on mount, not just tear down on unmount: StrictMode's dev-mode
  // mount/unmount/remount would otherwise leave the flag false for the
  // remounted instance, and every response would be discarded as stale.
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const run = useCallback(async () => {
    // Cancel any in-flight request so a stale response cannot overwrite a
    // newer one — the out-of-order case when typing quickly (US-PROD-2).
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setState('loading');
    setError(null);

    try {
      const result = await fetcher({ signal: controller.signal });
      if (!mounted.current || controller.signal.aborted) return;
      setData(result);
      setState('success');
    } catch (err) {
      if (err.name === 'AbortError' || !mounted.current) return;
      setError(err);
      setState('error');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => {
    if (immediate) run();
    return () => abortRef.current?.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run, immediate]);

  return {
    data, error, state, refetch: run,
    isLoading: state === 'loading',
    isError: state === 'error',
    isSuccess: state === 'success',
  };
}

/** Debounce a rapidly-changing value, e.g. a search box (US-PROD-2 AC5). */
export function useDebounced(value, delay = 300) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}
