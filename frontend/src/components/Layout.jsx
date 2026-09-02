/**
 * App shell: header, navigation, cart indicator, mobile menu.
 *
 * Admin navigation is rendered only for admins — presentation only, since the
 * server refuses regardless (US-AUTH-6 design notes).
 */
import { useState } from 'react';
import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useCart } from '../context/CartContext';
import { BellIcon, CartIcon, CloseIcon, MenuIcon, StorefrontIcon } from './Icons';

function navClass({ isActive }) {
  return `rounded-control px-3 py-2 text-meta font-medium transition ${
    isActive
      ? 'bg-primary-soft text-primary-text'
      : 'text-content-secondary hover:bg-surface-hover hover:text-content'
  }`;
}

export default function Layout() {
  const { user, isAuthenticated, isAdmin, logout } = useAuth();
  const { itemCount } = useCart();
  const [menuOpen, setMenuOpen] = useState(false);
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    setMenuOpen(false);
    navigate('/login');
  };

  const links = [
    { to: '/products', label: 'Products' },
    ...(isAuthenticated ? [{ to: '/orders', label: 'My orders' }] : []),
    // One link out to the admin portal, which carries its own navigation.
    ...(isAdmin ? [{ to: '/admin', label: 'Admin portal' }] : []),
  ];

  return (
    <div className="flex min-h-screen flex-col">
      {/* Skip link: first tab stop, lets keyboard users bypass the nav. */}
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-control focus:bg-surface focus:px-4 focus:py-2 focus:shadow"
      >
        Skip to content
      </a>

      <header className="sticky top-0 z-40 border-b border-line bg-surface/80 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-7xl items-center gap-4 px-4 sm:px-6">
          <Link to="/products" className="flex items-center gap-2 font-semibold text-content">
            <span className="grid h-8 w-8 place-items-center rounded-control bg-primary text-on-primary">
              <StorefrontIcon className="h-5 w-5" />
            </span>
            <span className="hidden sm:inline">Order Platform</span>
          </Link>

          <nav className="ml-4 hidden items-center gap-1 md:flex" aria-label="Main">
            {links.map((l) => (
              <NavLink key={l.to} to={l.to} className={navClass}>
                {l.label}
              </NavLink>
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-2">
            {isAuthenticated && (
              <Link
                to="/notifications"
                className="grid h-11 w-11 place-items-center rounded-control text-content-secondary hover:bg-surface-hover"
                aria-label="Notifications"
              >
                <BellIcon className="h-5 w-5" />
              </Link>
            )}

            <Link
              to="/cart"
              className="relative grid h-11 w-11 place-items-center rounded-control text-content-secondary hover:bg-surface-hover"
              aria-label={`Cart, ${itemCount} item${itemCount === 1 ? '' : 's'}`}
            >
              <CartIcon className="h-5 w-5" />
              {itemCount > 0 && (
                <span className="absolute -right-0.5 -top-0.5 grid h-5 min-w-[1.25rem] place-items-center rounded-full bg-primary px-1 text-eyebrow font-semibold text-content-inverse">
                  {itemCount}
                </span>
              )}
            </Link>

            {isAuthenticated ? (
              <div className="hidden items-center gap-2 md:flex">
                <span className="max-w-[12rem] truncate text-meta text-content-secondary">{user.name}</span>
                {/* A button, not a link — it performs an action. */}
                <button type="button" onClick={handleLogout} className="btn-secondary py-2">
                  Log out
                </button>
              </div>
            ) : (
              <div className="hidden items-center gap-2 md:flex">
                <Link to="/login" className="btn-secondary py-2">Sign in</Link>
                <Link to="/register" className="btn-primary py-2">Register</Link>
              </div>
            )}

            <button
              type="button"
              onClick={() => setMenuOpen((v) => !v)}
              className="grid h-11 w-11 place-items-center rounded-control text-content-secondary hover:bg-surface-hover md:hidden"
              aria-expanded={menuOpen}
              aria-controls="mobile-menu"
              aria-label="Toggle menu"
            >
              {menuOpen ? <CloseIcon className="h-5 w-5" /> : <MenuIcon className="h-5 w-5" />}
            </button>
          </div>
        </div>

        {/* Mobile menu — logout is here too, never hover-only. */}
        {menuOpen && (
          <div id="mobile-menu" className="border-t border-line bg-surface px-4 py-3 md:hidden">
            <nav className="flex flex-col gap-1" aria-label="Mobile">
              {links.map((l) => (
                <NavLink key={l.to} to={l.to} className={navClass} onClick={() => setMenuOpen(false)}>
                  {l.label}
                </NavLink>
              ))}
              <div className="mt-2 border-t border-line pt-2">
                {isAuthenticated ? (
                  <button type="button" onClick={handleLogout} className="btn-secondary w-full">
                    Log out ({user.name})
                  </button>
                ) : (
                  <div className="flex flex-col gap-2">
                    <Link to="/login" className="btn-secondary" onClick={() => setMenuOpen(false)}>Sign in</Link>
                    <Link to="/register" className="btn-primary" onClick={() => setMenuOpen(false)}>Register</Link>
                  </div>
                )}
              </div>
            </nav>
          </div>
        )}
      </header>

      <main id="main" className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6 sm:py-8">
        <Outlet />
      </main>

      <footer className="border-t border-line bg-surface py-6">
        <p className="mx-auto max-w-7xl px-4 text-meta text-content-muted sm:px-6">
          Order Management Platform — demonstration build.
        </p>
      </footer>
    </div>
  );
}
