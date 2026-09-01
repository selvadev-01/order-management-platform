/**
 * Register page (US-AUTH-1).
 */
import { useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { FormError, FieldError, Spinner } from '../components/States';
import { useDocumentTitle } from "../hooks/useDocumentTitle";

export default function Register() {
  useDocumentTitle("Create account");
  const { register } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const refs = { name: useRef(null), email: useRef(null), password: useRef(null) };

  const change = (e) => {
    setForm((f) => ({ ...f, [e.target.name]: e.target.value }));
    setErrors((x) => ({ ...x, [e.target.name]: undefined }));
  };

  /** Mirrors the server rules. The server check is still the real one. */
  const validate = () => {
    const next = {};
    if (form.name.trim().length < 2) next.name = 'Name must be at least 2 characters';
    if (!/^\S+@\S+\.\S+$/.test(form.email.trim())) next.email = 'Must be a valid email address';
    if (form.password.length < 8) next.password = 'Password must be at least 8 characters';
    else if (!/[a-z]/.test(form.password)) next.password = 'Include a lowercase letter';
    else if (!/[A-Z]/.test(form.password)) next.password = 'Include an uppercase letter';
    else if (!/[0-9]/.test(form.password)) next.password = 'Include a number';
    return next;
  };

  const submit = async (e) => {
    e.preventDefault();
    const next = validate();
    if (Object.keys(next).length) {
      setErrors(next);
      // Focus the first offending field (US-AUTH-1 design notes).
      refs[Object.keys(next)[0]]?.current?.focus();
      return;
    }

    setSubmitting(true);
    setFormError(null);
    try {
      await register(form.name.trim(), form.email.trim(), form.password);
      navigate('/products', { replace: true });
    } catch (err) {
      setFormError(err.message);
      const fields = err.fieldErrors ?? {};
      setErrors(fields);
      const first = Object.keys(fields)[0];
      if (first && refs[first]) refs[first].current?.focus();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="mx-auto max-w-md py-8">
      <div className="card p-6 sm:p-8">
        <h1 className="text-xl font-semibold text-content">Create an account</h1>
        <p className="mt-1 text-sm text-content-muted">It only takes a moment.</p>

        <form onSubmit={submit} className="mt-6 space-y-4" noValidate>
          <FormError message={formError} />

          <div>
            <label htmlFor="name" className="label">Full name</label>
            <input
              ref={refs.name}
              id="name"
              name="name"
              autoComplete="name"
              value={form.name}
              onChange={change}
              className={`input ${errors.name ? 'input-error' : ''}`}
              aria-invalid={Boolean(errors.name)}
              aria-describedby={errors.name ? 'name-error' : undefined}
            />
            <FieldError id="name-error" message={errors.name} />
          </div>

          <div>
            <label htmlFor="email" className="label">Email</label>
            <input
              ref={refs.email}
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
                ref={refs.password}
                id="password"
                name="password"
                type={showPassword ? 'text' : 'password'}
                autoComplete="new-password"
                value={form.password}
                onChange={change}
                className={`input pr-16 ${errors.password ? 'input-error' : ''}`}
                aria-invalid={Boolean(errors.password)}
                aria-describedby={errors.password ? 'password-error' : 'password-hint'}
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded px-2 py-1 text-xs font-medium text-content-secondary hover:bg-surface-hover"
              >
                {showPassword ? 'Hide' : 'Show'}
              </button>
            </div>
            {errors.password ? (
              <FieldError id="password-error" message={errors.password} />
            ) : (
              <p id="password-hint" className="mt-1.5 text-xs text-content-muted">
                At least 8 characters, with upper and lower case letters and a number.
              </p>
            )}
          </div>

          <button type="submit" disabled={submitting} className="btn-primary w-full">
            {submitting && <Spinner />}
            {submitting ? 'Creating account…' : 'Create account'}
          </button>
        </form>

        <p className="mt-6 text-center text-sm text-content-secondary">
          Already registered?{' '}
          <Link to="/login" className="font-medium text-brand-600 hover:underline">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
