/**
 * Admin portal shell (docx §9).
 *
 * Deliberately a different frame from the storefront: a persistent sidebar
 * rather than a top bar, denser spacing, no cart. Someone dropped into a
 * screenshot should be able to tell which of the two applications they are
 * looking at.
 *
 * Adaptive navigation — sidebar from lg up, off-canvas drawer below — rather
 * than a bottom bar, because this is a desk tool with five destinations.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useDialogBehavior } from '../../hooks/useDialogBehavior';
import {
  DashboardIcon, ProductsIcon, CategoriesIcon, OrdersIcon, QueueIcon,
  MenuIcon, CloseIcon, LogoutIcon, StorefrontIcon,
} from '../Icons';

const NAV = [
  { to: '/admin', end: true, label: 'Dashboard', icon: DashboardIcon },
  { to: '/admin/products', label: 'Products', icon: ProductsIcon },
  { to: '/admin/categories', label: 'Categories', icon: CategoriesIcon },
  { to: '/admin/orders', label: 'Orders', icon: OrdersIcon },
  { to: '/admin/queue', label: 'Queue', icon: QueueIcon },
];

function navClass({ isActive }) {
  return `group flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition ${
    isActive
      ? 'bg-primary text-on-primary shadow-sm'
      : 'text-content-on-inverse hover:bg-surface-inverse-hover hover:text-content-inverse'
  }`;
}

/** Nav list, rendered into both the fixed rail and the mobile drawer. */
function NavList({ onNavigate }) {
  return (
    <nav className="flex-1 space-y-1 px-3" aria-label="Admin sections">
      {NAV.map(({ to, end, label, icon: IconCmp }) => (
        <NavLink key={to} to={to} end={end} className={navClass} onClick={onNavigate}>
          <IconCmp className="h-5 w-5 shrink-0" />
          {label}
        </NavLink>
      ))}
    </nav>
  );
}

function Brand() {
  return (
    <div className="flex h-16 items-center gap-2.5 px-5">
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-primary text-sm font-bold text-on-primary">
        A
      </span>
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold text-content-inverse">Admin Portal</p>
        <p className="truncate text-[11px] text-content-on-inverse-muted">Order Management</p>
      </div>
    </div>
  );
}

/** Signed-in admin plus the two ways out: back to the shop, or log out. */
function SidebarFooter({ user, onLogout, onNavigate }) {
  return (
    <div className="space-y-1 border-t border-line-inverse p-3">
      <Link
        to="/products"
        onClick={onNavigate}
        className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-content-on-inverse transition hover:bg-surface-inverse-hover hover:text-content-inverse"
      >
        <StorefrontIcon className="h-5 w-5 shrink-0" />
        View storefront
      </Link>

      <div className="flex items-center gap-3 rounded-lg px-3 py-2.5">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-surface-inverse-muted text-xs font-semibold text-content-inverse">
          {user?.name?.charAt(0)?.toUpperCase() ?? 'A'}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-content-inverse">{user?.name}</p>
          <p className="truncate text-[11px] text-content-on-inverse-muted">{user?.email}</p>
        </div>
        {/* Destructive-ish action kept visually apart from navigation. */}
        <button
          type="button"
          onClick={onLogout}
          aria-label="Log out"
          title="Log out"
          className="grid h-9 w-9 shrink-0 cursor-pointer place-items-center rounded-lg text-content-on-inverse-muted transition hover:bg-surface-inverse-hover hover:text-content-inverse"
        >
          <LogoutIcon className="h-5 w-5" />
        </button>
      </div>
    </div>
  );
}

export default function AdminLayout() {
  const { user, logout } = useAuth();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();

  // Close the drawer on navigation, so a tap never leaves it covering the page
  // it just moved to.
  useEffect(() => { setDrawerOpen(false); }, [location.pathname]);

  // Below lg this drawer is the only navigation, which makes it genuinely
  // modal — so it gets the same trap, scroll lock and focus restore as every
  // dialog in the panel, not just an Escape handler.
  const drawerRef = useRef(null);
  const closeDrawer = useCallback(() => setDrawerOpen(false), []);
  useDialogBehavior(drawerOpen, drawerRef, closeDrawer);

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  return (
    <div className="min-h-dvh bg-surface-sunken">
      <a
        href="#admin-main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[60] focus:rounded-lg focus:bg-surface focus:px-4 focus:py-2 focus:shadow"
      >
        Skip to content
      </a>

      {/* Fixed rail, lg and up. */}
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-64 flex-col bg-surface-inverse lg:flex">
        <Brand />
        <NavList />
        <SidebarFooter user={user} onLogout={handleLogout} />
      </aside>

      {/* Off-canvas drawer below lg. */}
      {drawerOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div
            className="absolute inset-0 bg-scrim/60 backdrop-blur-sm"
            onClick={() => setDrawerOpen(false)}
            aria-hidden="true"
          />
          <aside
            ref={drawerRef}
            tabIndex={-1}
            className="absolute inset-y-0 left-0 flex w-64 flex-col bg-surface-inverse shadow-xl outline-none"
            role="dialog"
            aria-modal="true"
            aria-label="Navigation"
          >
            <div className="flex items-center justify-between pr-3">
              <Brand />
              <button
                type="button"
                onClick={() => setDrawerOpen(false)}
                aria-label="Close navigation"
                className="cursor-pointer rounded-lg p-2 text-content-on-inverse-muted transition hover:bg-surface-inverse-hover hover:text-content-inverse"
              >
                <CloseIcon className="h-5 w-5" />
              </button>
            </div>
            <NavList onNavigate={() => setDrawerOpen(false)} />
            <SidebarFooter user={user} onLogout={handleLogout} onNavigate={() => setDrawerOpen(false)} />
          </aside>
        </div>
      )}

      <div className="lg:pl-64">
        {/* Mobile top bar. Hidden on lg, where the rail carries the identity. */}
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-line bg-surface/95 px-4 backdrop-blur lg:hidden">
          <button
            type="button"
            onClick={() => setDrawerOpen(true)}
            aria-label="Open navigation"
            aria-expanded={drawerOpen}
            className="cursor-pointer rounded-lg p-2 text-content-secondary transition hover:bg-surface-hover"
          >
            <MenuIcon className="h-5 w-5" />
          </button>
          <span className="font-semibold text-content">Admin Portal</span>
        </header>

        <main id="admin-main" className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 sm:py-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
