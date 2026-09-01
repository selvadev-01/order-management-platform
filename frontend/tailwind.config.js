/** @type {import('tailwindcss').Config} */

/**
 * Maps a semantic token to a Tailwind colour that still accepts opacity
 * modifiers (`bg-surface/75`). Tailwind passes `<alpha-value>`, which the
 * channel-triplet form of the variable can absorb; a hex value could not.
 */
const token = (name) => `rgb(var(--color-${name}) / <alpha-value>)`;

export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],

  /*
   * Status pill tones.
   *
   * utils/status.js composes these names at runtime (`badge-${tone}`), so
   * Tailwind's scanner — which only matches literal strings in source — cannot
   * see them and would purge every one, leaving colourless badges. The set is
   * small, closed, and mirrors the `Tone` enum, so listing it is safe.
   */
  safelist: [
    'badge-success',
    'badge-danger',
    'badge-warning',
    'badge-neutral',
    'badge-shipped',
    'badge-processing',
    'badge-confirmed',
  ],

  theme: {
    extend: {
      /*
       * Semantic colours only.
       *
       * Tailwind's default palette stays available, but application code is
       * expected to use these roles — `bg-surface`, `text-muted`,
       * `bg-warning-soft` — rather than naming a hue and a step. Roles are
       * defined in src/styles/tokens.css.
       */
      colors: {
        // Brand scale, kept for the few places that genuinely want a ramp.
        brand: {
          50: 'rgb(var(--palette-brand-50) / <alpha-value>)',
          100: 'rgb(var(--palette-brand-100) / <alpha-value>)',
          500: 'rgb(var(--palette-brand-500) / <alpha-value>)',
          600: 'rgb(var(--palette-brand-600) / <alpha-value>)',
          700: 'rgb(var(--palette-brand-700) / <alpha-value>)',
          900: 'rgb(var(--palette-brand-900) / <alpha-value>)',
        },

        // Surfaces
        canvas: token('canvas'),
        surface: {
          DEFAULT: token('surface'),
          sunken: token('surface-sunken'),
          hover: token('surface-hover'),
          active: token('surface-active'),
          inverse: token('surface-inverse'),
          'inverse-hover': token('surface-inverse-hover'),
          'inverse-muted': token('surface-inverse-muted'),
        },

        // Text
        content: {
          DEFAULT: token('text'),
          secondary: token('text-secondary'),
          muted: token('text-muted'),
          subtle: token('text-subtle'),
          inverse: token('text-inverse'),
          'on-inverse': token('text-on-inverse'),
          'on-inverse-muted': token('text-on-inverse-muted'),
        },

        // Lines
        line: {
          DEFAULT: token('border'),
          strong: token('border-strong'),
          subtle: token('border-subtle'),
          inverse: token('border-inverse'),
        },

        // Primary action
        primary: {
          DEFAULT: token('primary'),
          hover: token('primary-hover'),
          soft: token('primary-soft'),
          text: token('primary-text'),
          border: token('primary-border'),
        },
        'on-primary': token('on-primary'),

        // Status
        danger: {
          DEFAULT: token('danger'),
          hover: token('danger-hover'),
          soft: token('danger-soft'),
          'soft-alt': token('danger-soft-alt'),
          text: token('danger-text'),
          strong: token('danger-strong'),
          border: token('danger-border'),
          'border-strong': token('danger-border-strong'),
        },
        'on-danger': token('on-danger'),

        warning: {
          DEFAULT: token('warning'),
          soft: token('warning-soft'),
          'soft-alt': token('warning-soft-alt'),
          text: token('warning-text'),
          'text-strong': token('warning-text-strong'),
          border: token('warning-border'),
        },

        success: {
          DEFAULT: token('success'),
          soft: token('success-soft'),
          'soft-alt': token('success-soft-alt'),
          text: token('success-text'),
        },

        info: {
          DEFAULT: token('info'),
          soft: token('info-soft'),
        },

        // Fulfilment stages
        stage: {
          'shipped-soft': token('stage-shipped-soft'),
          'shipped-text': token('stage-shipped-text'),
          'processing-soft': token('stage-processing-soft'),
          'processing-text': token('stage-processing-text'),
          'confirmed-soft': token('stage-confirmed-soft'),
          'confirmed-text': token('stage-confirmed-text'),
        },

        neutral: {
          soft: token('neutral-soft'),
          text: token('neutral-text'),
        },

        scrim: token('scrim'),
      },

      ringColor: {
        DEFAULT: token('ring'),
        focus: token('ring'),
      },
    },
  },
  plugins: [],
};
