import { Link, useLocation } from 'react-router-dom';
import { EmptyState } from '../components/States';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { CompassIcon, LockIcon } from '../components/Icons';

export function NotFound() {
  useDocumentTitle('Page not found');
  // This component is the catch-all for the admin routes as well as the
  // storefront. Sending an admin to /products would eject them from the portal
  // entirely, so the way back is chosen from where they actually are.
  const inAdmin = useLocation().pathname.startsWith('/admin');

  return (
    <EmptyState
      icon={CompassIcon}
      title="Page not found"
      message="That page does not exist."
      action={
        inAdmin ? (
          <Link to="/admin" className="btn-primary">Back to dashboard</Link>
        ) : (
          <Link to="/products" className="btn-primary">Back to products</Link>
        )
      }
    />
  );
}

/** Shown when a signed-in customer reaches an admin route (US-AUTH-6). */
export function Forbidden() {
  useDocumentTitle('Not authorised');
  return (
    <EmptyState
      icon={LockIcon}
      title="Not authorised"
      message="You do not have permission to view that page."
      action={<Link to="/products" className="btn-primary">Back to products</Link>}
    />
  );
}
