/**
 * Routes and provider composition.
 *
 * Provider order matters: Auth wraps Cart, because the cart loads and clears
 * in response to the session.
 */
import { Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import { CartProvider } from './context/CartContext';
import { ToastProvider } from './context/ToastContext';
import { RequireAuth, RequireAdmin, RedirectIfAuthenticated } from './components/RouteGuards';
import Layout from './components/Layout';
import Login from './pages/Login';
import Register from './pages/Register';
import ProductList from './pages/ProductList';
import ProductDetail from './pages/ProductDetail';
import Cart from './pages/Cart';
import Checkout from './pages/Checkout';
import Orders, { Notifications } from './pages/Orders';
import OrderDetail from './pages/OrderDetail';
import AdminLayout from './components/admin/AdminLayout';
import Dashboard from './pages/admin/Dashboard';
import AdminProducts from './pages/admin/Products';
import AdminCategories from './pages/admin/Categories';
import AdminOrders from './pages/admin/Orders';
import AdminQueue from './pages/admin/Queue';
import { NotFound, Forbidden } from './pages/NotFound';

export default function App() {
  return (
    <ToastProvider>
      <AuthProvider>
        <CartProvider>
          <Routes>
            <Route element={<Layout />}>
              <Route index element={<Navigate to="/products" replace />} />

              {/* Public catalogue (US-PROD-1 AC5, US-PDP-1 AC5) */}
              <Route path="/products" element={<ProductList />} />
              <Route path="/products/:id" element={<ProductDetail />} />

              <Route path="/login" element={<RedirectIfAuthenticated><Login /></RedirectIfAuthenticated>} />
              <Route path="/register" element={<RedirectIfAuthenticated><Register /></RedirectIfAuthenticated>} />

              {/* Requires a session */}
              <Route path="/cart" element={<RequireAuth><Cart /></RequireAuth>} />
              <Route path="/checkout" element={<RequireAuth><Checkout /></RequireAuth>} />
              <Route path="/orders" element={<RequireAuth><Orders /></RequireAuth>} />
              <Route path="/orders/:id" element={<RequireAuth><OrderDetail /></RequireAuth>} />
              <Route path="/notifications" element={<RequireAuth><Notifications /></RequireAuth>} />

              <Route path="/forbidden" element={<Forbidden />} />
              <Route path="*" element={<NotFound />} />
            </Route>

            {/*
              Admin portal — its own shell, outside the storefront layout, so it
              reads as a separate application rather than a section of the shop.
              The guard wraps the layout, so every child route inherits it; the
              server enforces the same rule on each endpoint (US-AUTH-6).
            */}
            <Route path="/admin" element={<RequireAdmin><AdminLayout /></RequireAdmin>}>
              <Route index element={<Dashboard />} />
              <Route path="products" element={<AdminProducts />} />
              <Route path="categories" element={<AdminCategories />} />
              <Route path="orders" element={<AdminOrders />} />
              <Route path="queue" element={<AdminQueue />} />
              <Route path="*" element={<NotFound />} />
            </Route>
          </Routes>
        </CartProvider>
      </AuthProvider>
    </ToastProvider>
  );
}
