/**
 * Web Push subscription (docx §8, US-NOTIF-5).
 *
 * The browser half of the delivery chain: registers the service worker,
 * obtains a push subscription from the browser's push service, and hands the
 * endpoint to the Notification Service so the worker can deliver to it.
 *
 * The VAPID public key is fetched from the API rather than baked in at build
 * time, so rotating keys does not require rebuilding the frontend.
 */
import { api } from './api';

/**
 * Push needs a secure context.
 *
 * Browsers expose neither the service worker nor the push API over plain HTTP
 * (localhost excepted), so an unsupported environment must be reported rather
 * than failing at subscribe time with an opaque error.
 */
export function pushSupport() {
  if (!window.isSecureContext) {
    return { supported: false, reason: 'Push requires HTTPS. Open the app over https:// or localhost.' };
  }
  if (!('serviceWorker' in navigator)) {
    return { supported: false, reason: 'This browser does not support service workers.' };
  }
  if (!('PushManager' in window)) {
    return { supported: false, reason: 'This browser does not support push notifications.' };
  }
  if (!('Notification' in window)) {
    return { supported: false, reason: 'This browser does not support notifications.' };
  }
  return { supported: true, reason: null };
}

/** Current browser permission: 'granted' | 'denied' | 'default' | 'unsupported'. */
export function permissionState() {
  if (!('Notification' in window)) return 'unsupported';
  return Notification.permission;
}

/**
 * VAPID keys travel as base64url but the push API wants raw bytes.
 */
function urlBase64ToUint8Array(base64) {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const normalised = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(normalised);
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) output[i] = raw.charCodeAt(i);
  return output;
}

/**
 * Marks an error as "the user said no", distinct from a failure.
 *
 * A flag rather than message matching, so the caller can tell a decision from
 * a fault without depending on wording.
 */
function declined(message) {
  const err = new Error(message);
  err.pushDeclined = true;
  return err;
}

export function registerServiceWorker() {
  return navigator.serviceWorker.register('/sw.js', { scope: '/' });
}

/** The existing push subscription for this browser, if any. */
export async function currentSubscription() {
  const { supported } = pushSupport();
  if (!supported) return null;
  const reg = await navigator.serviceWorker.getRegistration('/');
  if (!reg) return null;
  return reg.pushManager.getSubscription();
}

/**
 * Enable push for this device (US-NOTIF-5 AC2).
 *
 * Throws with a human-readable message; the caller renders it directly.
 */
export async function enablePush() {
  const { supported, reason } = pushSupport();
  if (!supported) throw new Error(reason);

  const { publicKey, enabled } = await api.get('/api/notifications/vapid-key');
  if (!enabled || !publicKey) {
    throw new Error('Push is not configured on the server.');
  }

  const permission = await Notification.requestPermission();
  if (permission === 'denied') {
    // Once denied, requestPermission() resolves 'denied' without prompting
    // again — only the user can undo it in site settings.
    throw declined('Notifications are blocked. Enable them in your browser’s site settings, then retry.');
  }
  if (permission !== 'granted') {
    throw declined('Notification permission was dismissed.');
  }

  const reg = await registerServiceWorker();
  // Registration is not usable until it is active.
  await navigator.serviceWorker.ready;

  // Reuse an existing subscription if present: subscribing twice with the same
  // key returns the same endpoint, but this avoids the round trip.
  const existing = await reg.pushManager.getSubscription();
  const sub =
    existing ??
    (await reg.pushManager.subscribe({
      // Required to be true by every current browser: the push must be shown.
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    }));

  const json = sub.toJSON();
  await api.post('/api/notifications/subscribe', {
    endpoint: json.endpoint,
    keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
    userAgent: navigator.userAgent.slice(0, 300),
  });

  return { endpoint: json.endpoint };
}

/**
 * Subscribe automatically once a user is authenticated (US-NOTIF-5).
 *
 * Push is on by default as far as the product is concerned: the customer is
 * asked once, on login, rather than having to find a setting. Browsers forbid
 * granting notification permission without a user action, so `default` can
 * only ever be turned into `granted` by the prompt itself — this triggers it
 * at the earliest point where the app knows who the user is.
 *
 * Never throws: a declined or unavailable push must not disturb the session,
 * because the in-app notification list still works without it.
 */
export async function autoEnablePush() {
  try {
    const { supported } = pushSupport();
    if (!supported) return { ok: false, reason: 'unsupported' };

    // A denied permission cannot be re-prompted; only site settings can undo
    // it, so asking again on every login would be pointless.
    if (permissionState() === 'denied') return { ok: false, reason: 'denied' };

    // Already subscribed on this device — nothing to do.
    if (await currentSubscription()) return { ok: true, reason: 'already' };

    /**
     * Respect a previous decline (server-held).
     *
     * Checked only when a prompt would actually be shown: a user whose
     * permission is already granted needs no preference lookup, so the common
     * path costs no request.
     */
    if (permissionState() === 'default') {
      const { shouldPrompt } = await api.get('/api/notifications/push-preference');
      if (!shouldPrompt) return { ok: false, reason: 'declined-previously' };
    }

    await enablePush();
    return { ok: true, reason: 'subscribed' };
  } catch (err) {
    /**
     * A prompt the user dismissed or denied is a decision, not an error:
     * record it so they are not asked again on their next login or device.
     * Anything else (offline, VAPID unset) leaves the preference untouched so
     * the prompt is retried once the cause is fixed.
     */
    if (permissionState() !== 'granted' && err?.pushDeclined) {
      await api.post('/api/notifications/push-preference/decline', {}).catch(() => {});
      return { ok: false, reason: 'declined' };
    }
    return { ok: false, reason: 'unavailable' };
  }
}

/**
 * Disable push for this device.
 *
 * Unsubscribes locally and tells the server, so the worker stops delivering to
 * an endpoint the user has turned off.
 */
export async function disablePush() {
  const sub = await currentSubscription();
  if (!sub) return { unsubscribed: false };

  const endpoint = sub.endpoint;
  await sub.unsubscribe();

  try {
    await api.post('/api/notifications/unsubscribe', { endpoint });
  } catch {
    // The local unsubscribe already stopped delivery to this browser; a failed
    // server call leaves a row the worker will mark expired on first 404/410.
  }

  return { unsubscribed: true };
}