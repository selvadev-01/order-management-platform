/**
 * Form field.
 *
 * Wires up the four things that must never be forgotten and were previously
 * retyped per input: a real <label for>, aria-invalid, aria-describedby
 * pointing at both the hint and the error, and the error rendered below its own
 * field rather than only in a summary at the top.
 *
 * One component covers input, textarea and select, because the wrapper is
 * identical for all three and splitting them would reintroduce the duplication
 * this replaces.
 */
import { useId } from 'react';
import { FieldError } from '../States';
import Select from '../Select';

export default function Field({
  label,
  name,
  value,
  onChange,
  error,
  hint,
  as = 'input',
  options,
  required,
  className = '',
  ...rest
}) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errId = `${id}-err`;

  const shared = {
    id,
    name,
    value,
    onChange,
    'aria-invalid': error ? true : undefined,
    // Both are referenced; the browser reads whichever exist.
    'aria-describedby': [hint && hintId, error && errId].filter(Boolean).join(' ') || undefined,
    className: `input ${error ? 'input-error' : ''} ${className}`,
    ...rest,
  };

  return (
    <div>
      <label htmlFor={id} className="label">
        {label}
        {required && (
          <span className="ml-0.5 text-danger" aria-hidden="true">*</span>
        )}
        {required && <span className="sr-only"> (required)</span>}
      </label>

      {as === 'textarea' && <textarea {...shared} />}

      {/* The shared listbox, not a native <select>: its popup is real DOM, so
          it matches the rest of the product on every platform. It takes the
          chosen value directly rather than an event. */}
      {as === 'select' && (
        <Select
          id={id}
          options={options}
          value={value}
          onChange={(v) => onChange({ target: { name, value: v } })}
          invalid={Boolean(error)}
          aria-describedby={shared['aria-describedby']}
          disabled={rest.disabled}
        />
      )}

      {as === 'input' && <input {...shared} />}

      {/* Hint stays visible rather than living in a placeholder that vanishes
          the moment the user starts typing. */}
      {hint && !error && <p id={hintId} className="mt-1.5 text-eyebrow text-content-muted">{hint}</p>}
      <FieldError id={errId} message={error} />
    </div>
  );
}
