/**
 * Razorpay Checkout loader (US-PAY-3).
 *
 * Loads the gateway script on demand and opens the modal. The success handler
 * is ADVISORY ONLY — the order becomes paid when the webhook reaches the
 * backend and its signature verifies, never because this callback fired.
 */

const SCRIPT_URL = 'https://checkout.razorpay.com/v1/checkout.js';
let loading = null;

/** Fallback if the variable cannot be read — matches --palette-brand-600. */
const BRAND_FALLBACK = '#3b55e0';

/**
 * The brand colour as a hex string, read from the design token.
 *
 * Tokens are stored as `R G B` channels for Tailwind's opacity modifiers, so
 * they need converting for any consumer that wants hex — here, the gateway's
 * own iframe, which our stylesheet cannot reach.
 */
function brandHex() {
  try {
    const raw = getComputedStyle(document.documentElement)
      .getPropertyValue('--palette-brand-600')
      .trim();
    if (!raw) return BRAND_FALLBACK;

    const [r, g, b] = raw.split(/[\s,]+/).map(Number);
    if ([r, g, b].some((n) => !Number.isFinite(n))) return BRAND_FALLBACK;

    return `#${[r, g, b].map((n) => n.toString(16).padStart(2, '0')).join('')}`;
  } catch {
    return BRAND_FALLBACK;
  }
}

export function loadRazorpay() {
  if (window.Razorpay) return Promise.resolve(true);
  if (loading) return loading;

  loading = new Promise((resolve) => {
    const script = document.createElement('script');
    script.src = SCRIPT_URL;
    script.async = true;
    script.onload = () => resolve(true);
    script.onerror = () => {
      loading = null;
      resolve(false);
    };
    document.body.appendChild(script);
  });

  return loading;
}

/**
 * Open the checkout modal.
 *
 * @returns {Promise<{status:'success'|'dismissed'|'failed', payload?:object}>}
 *   `success` means the customer completed the gateway flow — NOT that the
 *   payment is verified. The caller must poll the server for real status.
 */
export function openCheckout({ keyId, gatewayOrderId, amount, currency, customer, orderId, orderRef }) {
  return new Promise((resolve) => {
    const rzp = new window.Razorpay({
      key: keyId,
      order_id: gatewayOrderId,
      amount,
      currency,
      name: 'Order Management Platform',
      // The customer reads this in the gateway modal, so it shows the readable
      // reference; `orderId` stays the internal correlation value.
      description: `Order ${orderRef ?? orderId}`,
      prefill: {
        name: customer?.name ?? '',
        email: customer?.email ?? '',
        contact: customer?.phone ?? '',
      },
      // The gateway's iframe is outside our stylesheet, so it needs a literal
      // hex rather than a class. Read from the token so the checkout matches
      // the app's brand colour instead of duplicating it as a constant that
      // silently goes stale when the token changes.
      theme: { color: brandHex() },
      handler(payload) {
        // Customer completed the flow. Verification still happens server-side.
        resolve({ status: 'success', payload });
      },
      modal: {
        // Dismissing changes nothing: the order stays Pending and is
        // retryable (US-PAY-3 AC3).
        ondismiss: () => resolve({ status: 'dismissed' }),
      },
    });

    rzp.on('payment.failed', (response) => {
      resolve({ status: 'failed', payload: response?.error });
    });

    rzp.open();
  });
}
