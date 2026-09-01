/**
 * Status → token mapping.
 *
 * The one place that decides what a status *means* semantically. Previously
 * this judgement was made in three separate hand-written maps (the formatter,
 * the admin StatCard tones, the queue job dots), which is how "amber means
 * warning" ends up stated three times and drifting.
 *
 * Nothing here names a colour. A status maps to a semantic tone; the tone maps
 * to a token in index.css / tokens.css. Restyling "Paid" is a token edit.
 */

/**
 * Semantic tones available to statuses and metrics.
 *
 * Adding a tone means three coordinated edits, because the class name is built
 * at runtime and Tailwind cannot see it:
 *   1. here,
 *   2. a `.badge-<tone>` rule in index.css,
 *   3. that class name in `safelist` in tailwind.config.js — without it the
 *      rule is purged from the build and the badge renders colourless.
 */
export const Tone = {
  SUCCESS: 'success',
  DANGER: 'danger',
  WARNING: 'warning',
  NEUTRAL: 'neutral',
  SHIPPED: 'shipped',
  PROCESSING: 'processing',
  CONFIRMED: 'confirmed',
  PRIMARY: 'primary',
};

/**
 * Order and payment statuses.
 *
 * Fulfilment stages get their own tones rather than all collapsing to
 * "neutral", so Processing and Shipped stay distinguishable at a glance.
 */
const STATUS_TONE = {
  // Payment
  Paid: Tone.SUCCESS,
  Failed: Tone.DANGER,
  Pending: Tone.NEUTRAL,
  Created: Tone.NEUTRAL,
  Refunded: Tone.WARNING,

  // Fulfilment
  Confirmed: Tone.CONFIRMED,
  Processing: Tone.PROCESSING,
  Shipped: Tone.SHIPPED,
  Delivered: Tone.SUCCESS,
  Cancelled: Tone.DANGER,
};

/** The tone for a status, defaulting to neutral for anything unrecognised. */
export function statusTone(status) {
  return STATUS_TONE[status] ?? Tone.NEUTRAL;
}

/**
 * Badge class for a status.
 *
 * Returns a single component class defined in index.css rather than a pair of
 * utilities, so the background and its text colour cannot be mismatched at the
 * call site.
 */
export function statusBadge(status) {
  return `badge badge-${statusTone(status)}`;
}

/**
 * Stock level → tone.
 *
 * `out` and `low` are different situations and read differently; the caller
 * pairs the tone with text, never relying on colour alone.
 */
export function stockTone(stock, { lowAt = 5 } = {}) {
  if (stock === 0) return Tone.DANGER;
  if (stock <= lowAt) return Tone.WARNING;
  return Tone.NEUTRAL;
}

export function stockBadge(stock, options) {
  return `badge badge-${stockTone(stock, options)}`;
}
