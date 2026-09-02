/**
 * Route guards (US-AUTH-5, US-AUTH-6).
 *
 * Presentation-layer protection only. The server enforces the same rules on
 * every endpoint — hiding a route is a convenience, not a control.
 */
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Spinner } from './States';

function FullPageLoading() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center" role="status">
      <Spinner className="h-8 w-8 text-primary" />
      <span className="sr-only">Loading</span>
    </div>
  );
}

/** Requires a session; preserves the attempted path so login can return here. */
export function RequireAuth({ children }) {
  const { isAuthenticated, restoring } = useAuth();
  const location = useLocation();

  // Waiting for restoration prevents a logged-in user being bounced to login
  // on refresh (US-AUTH-4 AC3).
  if (restoring) return <FullPageLoading />;

  if (!isAuthenticated) {
    return (
      <Navigate
        to="/login"
        replace
        // Full path + query preserved through the round trip (US-AUTH-5 AC2).
        state={{ from: location.pathname + location.search, reason: 'auth' }}
      />
    );
  }
  return children;
}

/** Requires the ADMIN role. */
export function RequireAdmin({ children }) {
  const { isAuthenticated, isAdmin, restoring } = useAuth();
  const location = useLocation();

  if (restoring) return <FullPageLoading />;
  if (!isAuthenticated) {
    return <Navigate to="/login" replace state={{ from: location.pathname, reason: 'auth' }} />;
  }
  if (!isAdmin) return <Navigate to="/forbidden" replace />;
  return children;
}

/** Keeps signed-in users away from the login/register forms. */
export function RedirectIfAuthenticated({ children }) {
  const { isAuthenticated, restoring } = useAuth();
  if (restoring) return <FullPageLoading />;
  if (isAuthenticated) return <Navigate to="/products" replace />;
  return children;
}
