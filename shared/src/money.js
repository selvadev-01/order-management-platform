/**
 * Money is stored and computed in integer MINOR units (paise) throughout, and
 * converted only at the display boundary. No float ever reaches a total
 * (US-SYS-6, US-CART-1).
 */

export const CURRENCY = 'INR';
const MINOR_PER_MAJOR = 100;

export function toMinor(major) {
  return Math.round(Number(major) * MINOR_PER_MAJOR);
}

export function toMajor(minor) {
  return Number(minor) / MINOR_PER_MAJOR;
}

/** Sum of line totals, in minor units. */
export function lineTotal(unitPriceMinor, quantity) {
  return unitPriceMinor * quantity;
}

export function sumMinor(amounts) {
  return amounts.reduce((total, amount) => total + amount, 0);
}

/**
 * Display formatting. The single source of truth for money on screen — the
 * frontend re-exports this rather than calling toFixed ad hoc (US-PROD-1).
 */
export function formatMoney(minor, { currency = CURRENCY, locale = 'en-IN' } = {}) {
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
  }).format(toMajor(minor));
}
