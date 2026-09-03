/**
 * Light / dark theme, with the OS as the default.
 *
 * Three states, not two. `'system'` is a real, distinct choice — it means "keep
 * following the OS", which is different from having picked light on a machine
 * that currently happens to be light. Collapsing it to a boolean would strand
 * anyone who switches their OS theme on a schedule: they would be pinned to
 * whatever the setting was the first time they loaded the page.
 *
 * The *resolved* theme is always written to `data-theme` on <html> — a concrete
 * 'light' or 'dark', never absent. CSS therefore has one condition to describe
 * instead of two, which is what lets styles/tokens.css hold a single copy of
 * the dark palette rather than one per trigger.
 *
 * The distinction between "chose light" and "following an OS that is light"
 * lives in localStorage, not in the DOM: an explicit choice is stored, and
 * 'system' is represented by the absence of a stored value.
 *
 * The pre-paint application lives in index.html; this hook owns changes made
 * after load, including reacting to the OS flipping while the tab is open.
 */
import { useCallback, useEffect, useState } from 'react';

const STORAGE_KEY = 'theme';

/** Reads the stored choice, tolerating unavailable or junk-filled storage. */
function readStored() {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return value === 'dark' || value === 'light' ? value : 'system';
  } catch {
    // Private mode, or storage blocked by policy. Following the OS is the
    // right fallback: it is the only preference we can still observe.
    return 'system';
  }
}

/** True when the OS currently asks for a dark interface. */
function prefersDark() {
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-color-scheme: dark)').matches;
}

export function useTheme() {
  const [theme, setThemeState] = useState(readStored);

  // `resolved` is what the user actually sees, which is what a toggle's label
  // and icon must describe — under 'system' the stored value alone cannot say
  // whether the screen is currently dark.
  const [systemDark, setSystemDark] = useState(prefersDark);
  const resolved = theme === 'system' ? (systemDark ? 'dark' : 'light') : theme;

  // Track OS changes so a toggle sitting on screen relabels itself when the
  // machine flips theme (a scheduled switch at sunset, for instance).
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return undefined;
    const query = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (event) => setSystemDark(event.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);

  // Mirror the *resolved* theme onto <html>, and the *choice* into storage.
  // Depends on `resolved` rather than `theme` so that an OS flip while sitting
  // on 'system' repaints the page, not just the toggle's label.
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', resolved);

    try {
      // Absence of a stored value is how 'system' is represented, so the key is
      // removed rather than set to the resolved colour — otherwise choosing
      // "follow the OS" would silently pin the current colour forever.
      if (theme === 'system') localStorage.removeItem(STORAGE_KEY);
      else localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      // Preference is lost on reload but correct for this session. Not worth
      // surfacing an error to the user over.
    }
  }, [theme, resolved]);

  /**
   * Flips to the opposite of what is on screen right now.
   *
   * Deliberately resolves against `resolved` rather than `theme`: from
   * 'system' on a dark machine, the user pressing the control expects light,
   * not the alphabetically-next value.
   */
  const toggle = useCallback(() => {
    setThemeState(resolved === 'dark' ? 'light' : 'dark');
  }, [resolved]);

  return { theme, resolved, setTheme: setThemeState, toggle };
}
