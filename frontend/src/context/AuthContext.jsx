/**
 * Authentication context (US-AUTH-2..6).
 *
 * Owns session restoration, login, logout, and the role the app reads for
 * conditional navigation. Screens read from here rather than each touching
 * storage themselves.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, getToken, setToken, onUnauthorized } from '../services/api';
import { autoEnablePush, disablePush } from '../services/push';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  /**
   * Starts as true so the app renders a loading state until the session is
   * resolved. Without this, a logged-in user briefly sees the login page on
   * every refresh — the flash US-AUTH-4 AC3 forbids.
   */
  const [restoring, setRestoring] = useState(true);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      if (!getToken()) {
        setRestoring(false);
        return;
      }
      try {
        const { user: me } = await api.get('/api/users/me');
        if (!cancelled) setUser(me);
      } catch {
        // Expired, malformed, or belonging to a deleted user — cleared without
        // throwing (US-AUTH-4 AC2 and edge cases).
        setToken(null);
        if (!cancelled) setUser(null);
      } finally {
        if (!cancelled) setRestoring(false);
      }
    })();

    return () => { cancelled = true; };
  }, []);

  // A 401 from any request clears the session once, centrally.
  useEffect(() => onUnauthorized(() => setUser(null)), []);

  /**
   * Subscribe this device to push as soon as there is a user (US-NOTIF-5).
   *
   * Runs on login, registration, and session restore alike, because all three
   * end with `user` set. Keyed on the user id so switching accounts on a
   * shared device re-subscribes under the new one.
   *
   * Deliberately not awaited: the session must not wait on a permission
   * prompt, and autoEnablePush never throws.
   */
  useEffect(() => {
    if (!user) return;
    autoEnablePush();
  }, [user?.id]);

  const login = useCallback(async (email, password) => {
    const { token, user: me } = await api.post('/api/auth/login', { email, password }, { auth: false });
    setToken(token);
    setUser(me);
    return me;
  }, []);

  const register = useCallback(async (name, email, password) => {
    const { token, user: me } = await api.post(
      '/api/auth/register',
      { name, email, password },
      { auth: false },
    );
    setToken(token);
    setUser(me);
    return me;
  }, []);

  /**
   * Clears the token and user. Cart state is keyed off `user`, so it clears
   * with it and the next person on this device sees nothing (US-AUTH-3 AC1).
   */
  const logout = useCallback(() => {
    /**
     * Stop push to this device before clearing the session.
     *
     * The subscription is tied to the browser, not the token, so leaving it in
     * place would deliver one customer's order updates to whoever logs in
     * next on a shared device. Not awaited — logout must not block on it.
     */
    disablePush().catch(() => {});
    setToken(null);
    setUser(null);
  }, []);

  const value = useMemo(
    () => ({
      user,
      restoring,
      isAuthenticated: Boolean(user),
      isAdmin: user?.role === 'ADMIN',
      login,
      register,
      logout,
    }),
    [user, restoring, login, register, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
