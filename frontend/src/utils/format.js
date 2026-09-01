/**
 * Display formatting. The single source of truth for money and dates on the
 * client, mirroring shared/src/money.js on the server (US-PROD-1).
 *
 * Amounts arrive as integer minor units and are only converted here.
 */
export function formatMoney(minor, { currency = 'INR', locale = 'en-IN' } = {}) {
  if (minor == null || Number.isNaN(Number(minor))) return '—';
  return new Intl.NumberFormat(locale, {
    style: 'currency', currency, minimumFractionDigits: 2,
  }).format(Number(minor) / 100);
}

export function formatDate(value, { locale = 'en-IN' } = {}) {
  if (!value) return '—';
  return new Intl.DateTimeFormat(locale, {
    day: 'numeric', month: 'short', year: 'numeric',
  }).format(new Date(value));
}

export function formatDateTime(value, { locale = 'en-IN' } = {}) {
  if (!value) return '—';
  return new Intl.DateTimeFormat(locale, {
    day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  }).format(new Date(value));
}

/**
 * Badge classes per order/payment status. Never colour alone — always paired
 * with the status text.
 *
 * Re-exported from utils/status.js, which owns the status → tone decision, so
 * the mapping lives in one place. Kept here as a named export because callers
 * across the app already import it from this module.
 */
export { statusBadge as statusClasses } from './status';
