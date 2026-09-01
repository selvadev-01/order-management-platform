/**
 * API client.
 *
 * One place that knows how to talk to the gateway, so no screen builds a fetch
 * by hand. Carries the token, unwraps the shared error shape, and maps 401 to
 * a single session-cleared path (US-AUTH-4 technical notes).
 */

const BASE = import.meta.env.VITE_API_BASE_URL ?? '';
const TOKEN_KEY = 'oms.token';

export function getToken() {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* private mode / storage disabled — the session simply won't persist */
  }
}

/**
 * Raised for any non-2xx response, carrying the server's status, code and
 * per-field details so forms can render inline validation errors.
 */
export class ApiError extends Error {
  constructor(message, { status, code, details } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details ?? [];
  }

  /** Field errors keyed by field name, for form rendering. */
  get fieldErrors() {
    const map = {};
    for (const d of this.details) {
      const key = String(d.field).split('.').pop();
      if (!map[key]) map[key] = d.message;
    }
    return map;
  }
}

/** Listeners notified when the session is rejected, so the app can redirect. */
const unauthorizedHandlers = new Set();
export function onUnauthorized(fn) {
  unauthorizedHandlers.add(fn);
  return () => unauthorizedHandlers.delete(fn);
}

export async function request(path, { method = 'GET', body, signal, auth = true } = {}) {
  const token = auth ? getToken() : null;

  let res;
  try {
    res = await fetch(`${BASE}${path}`, {
      method,
      signal,
      headers: {
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    // Distinguishes a connection problem from a server error where possible
    // (US-PROD-5 edge case).
    throw new ApiError('Cannot reach the server. Check your connection.', { status: 0 });
  }

  if (res.status === 204) return null;

  const text = await res.text();
  const payload = text ? safeParse(text) : null;

  if (!res.ok) {
    // One place maps 401 to "clear session and redirect", rather than every
    // call site reimplementing it (US-AUTH-4 technical notes).
    if (res.status === 401 && auth) {
      setToken(null);
      unauthorizedHandlers.forEach((fn) => fn());
    }

    throw new ApiError(payload?.error?.message ?? `Request failed (${res.status})`, {
      status: res.status,
      code: payload?.error?.code,
      details: payload?.error?.details,
    });
  }

  return payload;
}

function safeParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export const api = {
  get: (p, o) => request(p, { ...o, method: 'GET' }),
  post: (p, body, o) => request(p, { ...o, method: 'POST', body }),
  put: (p, body, o) => request(p, { ...o, method: 'PUT', body }),
  patch: (p, body, o) => request(p, { ...o, method: 'PATCH', body }),
  del: (p, o) => request(p, { ...o, method: 'DELETE' }),
};

/** Build a query string, omitting empty values. */
export function qs(params) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') q.set(k, String(v));
  }
  const s = q.toString();
  return s ? `?${s}` : '';
}
