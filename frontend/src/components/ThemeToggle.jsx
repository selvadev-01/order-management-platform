/**
 * Light / dark switch.
 *
 * A single button rather than a three-way control. The stored preference does
 * have three states (see hooks/useTheme.js), but 'system' is the default a user
 * arrives on rather than something they need to select — and a tri-state
 * control in the header would spend a lot of width explaining a distinction
 * most people never think about. Pressing this simply flips what is on screen.
 *
 * The icon shows the mode being *switched to*, not the current one: an icon on
 * a control reads as the outcome of pressing it. The accessible name says so
 * explicitly, since the icon alone is ambiguous either way round.
 */
import { useTheme } from '../hooks/useTheme';
import { MoonIcon, SunIcon } from './Icons';

export default function ThemeToggle({ className = '' }) {
  const { resolved, toggle } = useTheme();
  const next = resolved === 'dark' ? 'light' : 'dark';

  return (
    <button
      type="button"
      onClick={toggle}
      // Not aria-pressed: this is not a control that stays "on". It performs a
      // switch, and the name changes to describe the next switch.
      aria-label={`Switch to ${next} theme`}
      title={`Switch to ${next} theme`}
      className={`grid h-11 w-11 place-items-center rounded-control text-content-secondary transition-colors hover:bg-surface-hover hover:text-content ${className}`}
    >
      {resolved === 'dark' ? <SunIcon className="h-5 w-5" /> : <MoonIcon className="h-5 w-5" />}
    </button>
  );
}
