/**
 * Cart context (US-CART-1..4, US-PDP-3).
 *
 * The server computes totals and flags unavailable lines; this holds the last
 * server response and exposes the mutations. The client never calculates
 * money itself, so the two can never disagree (US-CART-1 technical notes).
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api } from '../services/api';
import { useAuth } from './AuthContext';

const CartContext = createContext(null);

const EMPTY = { items: [], itemCount: 0, subtotal: 0, total: 0, checkoutBlocked: true, issues: [] };

export function CartProvider({ children }) {
  const { isAuthenticated } = useAuth();
  const [cart, setCart] = useState(EMPTY);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  /** Per-product pending flags, so one line updating does not disable the page. */
  const [pending, setPending] = useState({});

  const refresh = useCallback(async () => {
    if (!isAuthenticated) {
      setCart(EMPTY);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      setCart(await api.get('/api/cart'));
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [isAuthenticated]);

  // Load on sign-in; clear on sign-out so the next user sees nothing.
  useEffect(() => {
    if (isAuthenticated) refresh();
    else setCart(EMPTY);
  }, [isAuthenticated, refresh]);

  const withPending = useCallback(async (productId, fn) => {
    setPending((p) => ({ ...p, [productId]: true }));
    try {
      // Every mutation returns the whole updated cart, so state comes from the
      // server rather than from an optimistic local guess.
      const updated = await fn();
      setCart(updated);
      return updated;
    } finally {
      setPending((p) => {
        const next = { ...p };
        delete next[productId];
        return next;
      });
    }
  }, []);

  const addItem = useCallback(
    (productId, quantity = 1) =>
      withPending(productId, () => api.post('/api/cart', { productId, quantity })),
    [withPending],
  );

  const setQuantity = useCallback(
    (productId, quantity) =>
      withPending(productId, () => api.patch(`/api/cart/${productId}`, { quantity })),
    [withPending],
  );

  const removeItem = useCallback(
    (productId) => withPending(productId, () => api.del(`/api/cart/${productId}`)),
    [withPending],
  );

  const value = useMemo(
    () => ({
      cart,
      loading,
      error,
      pending,
      itemCount: cart.itemCount ?? 0,
      refresh,
      addItem,
      setQuantity,
      removeItem,
      clearLocal: () => setCart(EMPTY),
    }),
    [cart, loading, error, pending, refresh, addItem, setQuantity, removeItem],
  );

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart() {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error('useCart must be used inside CartProvider');
  return ctx;
}
