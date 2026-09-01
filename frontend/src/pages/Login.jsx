/**
 * Login page (US-AUTH-2).
 */
import { useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { FormError, FieldError, Spinner } from '../components/States';
import { useDocumentTitle } from "../hooks/useDocumentTitle";

export default function Login() {
  useDocumentTitle("Sign in");
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [form, setForm] = useState({ email: '', password: '' });
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const emailRef = useRef(null);

  const from = location.state?.from ?? '/products';
  const redirected = location.state?.reason === 'auth';

  const change = (e) => {
    setForm((f) => ({ ...f, [e.target.name]: e.target.value }));
    setErrors((x) => ({ ...x, [e.target.name]: undefined }));
  };

  const submit = async (e) => {
    e.preventDefault();
    const next = {};
    if (!form.email.trim()) next.email = 'Email is required';
    if (!form.password) next.password = 'Password is required';
    if (Object.keys(next).length) {
      setErrors(next);
      emailRef.current?.focus();
      return;
    }

    setSubmitting(true);
    setFormError(null);
    try {
      await login(form.email.trim(), form.password);
      // Continue to the originally requested page (US-AUTH-2 AC1).
      navigate(from, { replace: true });
    } catch (err) {
      // One message above the form — never duplicated per field, which would
      // imply the app knows which of the two was wrong.
      setFormError(err.message);
      setErrors(err.fieldErrors ?? {});
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="mx-auto max-w-md py-8">
      <div className="card p-6 sm:p-8">
        <h1 className="text-xl font-semibold text-content">Sign in</h1>
        <p className="mt-1 text-sm text-content-muted">Welcome back.</p>

        {redirected && (
          <p className="mt-4 rounded-lg bg-brand-50 px-3.5 py-2.5 text-sm text-brand-900" role="status">
            Please sign in to continue.
          </p>
        )}

        <form onSubmit={submit} className="mt-6 space-y-4" noValidate>
          <FormError message={formError} />

          <div>
            <label htmlFor="email" className="label">Email</label>
            <input
              ref={emailRef}
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              value={form.email}
              onChange={change}
              className={`input ${errors.email ? 'input-error' : ''}`}
              aria-invalid={Boolean(errors.email)}
              aria-describedby={errors.email ? 'email-error' : undefined}
            />
            <FieldError id="email-error" message={errors.email} />
          </div>

          <div>
            <label htmlFor="password" className="label">Password</label>
            <div className="relative">
              <input
                id="password"
                name="password"
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                value={form.password}
                onChange={change}
                className={`input pr-16 ${errors.password ? 'input-error' : ''}`}
                aria-invalid={Boolean(errors.password)}
                aria-describedby={errors.password ? 'password-error' : undefined}
              />
              {/* A real button with an accessible name, reachable by keyboard. */}
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded px-2 py-1 text-xs font-medium text-content-secondary hover:bg-surface-hover"
              >
                {showPassword ? 'Hide' : 'Show'}
              </button>
            </div>
            <FieldError id="password-error" message={errors.password} />
          </div>

          <button type="submit" disabled={submitting} className="btn-primary w-full">
            {submitting && <Spinner />}
            {submitting ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        <p className="mt-6 text-center text-sm text-content-secondary">
          No account?{' '}
          <Link to="/register" className="font-medium text-brand-600 hover:underline">
            Create one
          </Link>
        </p>
      </div>
    </div>
  );
}
