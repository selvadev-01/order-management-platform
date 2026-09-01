/**
 * Service-to-service HTTP client (US-SYS-5 AC3).
 *
 * Services fetch each other's data over defined interfaces rather than reading
 * another service's collections directly. This is what makes the separation
 * real rather than cosmetic — the Order Service asks the Product Service for
 * prices and stock instead of querying `products` itself.
 */
import { badGateway, AppError, ErrorCode } from './errors.js';

export class ServiceClient {
  /**
   * @param {object} opts
   * @param {string} opts.baseUrl   target service base URL
   * @param {string} opts.name      target name, for logs and errors
   * @param {object} opts.logger
   * @param {number} [opts.timeoutMs] bounded so a slow dependency cannot
   *   exhaust this service's connections (US-SYS-4 edge case)
   */
  constructor({ baseUrl, name, logger, timeoutMs = 5000 }) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.name = name;
    this.logger = logger;
    this.timeoutMs = timeoutMs;
  }

  async request(path, { method = 'GET', body, token, headers = {} } = {}) {
    const url = `${this.baseUrl}${path}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const res = await fetch(url, {
        method,
        signal: controller.signal,
        headers: {
          ...(body ? { 'Content-Type': 'application/json' } : {}),
          // The caller's token is forwarded so the target service enforces its
          // own authorization — the gateway is not the security boundary.
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...headers,
        },
        body: body ? JSON.stringify(body) : undefined,
      });

      const text = await res.text();
      const payload = text ? safeParse(text) : null;

      if (!res.ok) {
        // Propagate the upstream's meaning rather than flattening everything
        // to 502: a 404 from the Product Service is a genuine 404 here.
        throw new AppError(payload?.error?.message ?? `${this.name} request failed`, {
          status: res.status,
          code: payload?.error?.code ?? ErrorCode.BAD_GATEWAY,
          details: payload?.error?.details,
        });
      }

      return payload;
    } catch (err) {
      if (err instanceof AppError) throw err;

      if (err.name === 'AbortError') {
        this.logger?.error({ service: this.name, path }, 'upstream timeout');
        throw badGateway(`${this.name} did not respond in time`);
      }

      this.logger?.error({ err, service: this.name, path }, 'upstream unreachable');
      throw badGateway(`${this.name} is unavailable`);
    } finally {
      clearTimeout(timer);
    }
  }

  get(path, opts) {
    return this.request(path, { ...opts, method: 'GET' });
  }

  post(path, body, opts) {
    return this.request(path, { ...opts, method: 'POST', body });
  }

  patch(path, body, opts) {
    return this.request(path, { ...opts, method: 'PATCH', body });
  }
}

function safeParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
