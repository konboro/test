'use client';

/**
 * The on/off control used wherever something is switched on or off for real.
 *
 * Extracted from the settings automation switch when customers needed the same
 * control. A second one drawn by hand would drift — and a toggle that looks
 * subtly different in two places makes people wonder whether it does something
 * subtly different.
 */

const SIZES = {
  lg: { track: 'h-9 w-16', thumb: 'h-7 w-7', on: 'translate-x-8', off: 'translate-x-1' },
  sm: { track: 'h-7 w-12', thumb: 'h-5 w-5', on: 'translate-x-6', off: 'translate-x-1' },
} as const;

export function Switch({
  on,
  label,
  title,
  size = 'lg',
  submit = true,
  disabled = false,
  onClick,
}: {
  on: boolean;
  /** Read out by a screen reader in place of the shape itself. */
  label: string;
  /**
   * Hover text, when it should say something the label does not.
   *
   * The two diverge where the label names the thing being switched — "reminders
   * for invoice A 1042" — and the hint names what pressing it will do. Defaults
   * to the label, which is right whenever there is nothing extra to add.
   */
  title?: string;
  size?: keyof typeof SIZES;
  /**
   * Whether pressing it submits the surrounding form. False when the press has
   * to be intercepted first — a confirmation, say — and something else submits.
   */
  submit?: boolean;
  disabled?: boolean;
  onClick?: () => void;
}) {
  const s = SIZES[size];

  return (
    <button
      type={submit ? 'submit' : 'button'}
      onClick={onClick}
      role="switch"
      aria-checked={on}
      aria-label={label}
      // Same text as a tooltip: in a dense list the shape alone does not say
      // what it governs, and only a screen reader was being told.
      title={title ?? label}
      disabled={disabled}
      className={`relative inline-flex ${s.track} shrink-0 items-center rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 disabled:opacity-60 ${
        on ? 'bg-emerald-500' : 'bg-ink-300'
      }`}
    >
      <span
        aria-hidden
        className={`inline-block ${s.thumb} transform rounded-full bg-white shadow-sm transition-transform duration-200 ${
          on ? s.on : s.off
        }`}
      />
    </button>
  );
}
