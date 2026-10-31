import type { ReactNode } from 'react';
import { CheckIcon } from './Icons';

/** On/off switch with a visible label and hint. */
export function SwitchRow({
  id,
  label,
  hint,
  checked,
  onChange,
}: {
  id: string;
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <div className="switch-row">
      <div className="switch-row__text">
        <span id={`${id}-label`}>{label}</span>
        {hint && <small>{hint}</small>}
      </div>
      <button
        type="button"
        role="switch"
        className="switch"
        aria-checked={checked}
        aria-labelledby={`${id}-label`}
        onClick={() => onChange(!checked)}
      >
        <span className="switch__track">
          <span className="switch__knob" />
        </span>
      </button>
    </div>
  );
}

/** A row of mutually exclusive choices. */
export function Segmented<T extends string | number>({
  label,
  value,
  options,
  onChange,
  fill = true,
}: {
  label: string;
  value: T;
  options: { value: T; label: ReactNode }[];
  onChange: (v: T) => void;
  fill?: boolean;
}) {
  return (
    <div className={`segmented ${fill ? 'segmented--fill' : ''}`} role="group" aria-label={label}>
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          className="segmented__item"
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Color swatches plus an optional free color picker. */
export function ColorPicker({
  label,
  value,
  colors,
  onChange,
  customLabel,
  names,
}: {
  label: string;
  value: string;
  colors: readonly string[];
  onChange: (hex: string) => void;
  customLabel?: string;
  names?: string[];
}) {
  const isCustom = !colors.some((c) => c.toLowerCase() === value.toLowerCase());
  return (
    <div className="swatches" role="group" aria-label={label}>
      {colors.map((c, i) => {
        const on = c.toLowerCase() === value.toLowerCase();
        return (
          <button
            key={c}
            type="button"
            className="swatch"
            aria-pressed={on}
            aria-label={names?.[i] ?? c}
            title={names?.[i] ?? c}
            style={{ background: c }}
            onClick={() => onChange(c)}
          >
            {on && <CheckIcon size={16} />}
          </button>
        );
      })}
      {customLabel && (
        <label className={`swatch swatch--custom ${isCustom ? 'is-on' : ''}`} title={customLabel} style={isCustom ? { background: value } : undefined}>
          <span className="sr-only">{customLabel}</span>
          <input type="color" value={value} onChange={(e) => onChange(e.target.value)} />
          {!isCustom && <span aria-hidden="true">+</span>}
          {isCustom && <CheckIcon size={16} />}
        </label>
      )}
    </div>
  );
}
