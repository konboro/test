/**
 * The lefta.app mark and wordmark.
 *
 * One definition, because the wordmark was pasted into five files and the header
 * of every reminder email — the kind of thing that stays consistent right up
 * until someone changes four of six.
 *
 * The mark is inline SVG rather than an image file for two reasons: it has to
 * render in a favicon slot where no font is guaranteed, and it has to stay sharp
 * from 16px in a browser tab to the hero on the landing page. The lambda is
 * stroked geometry, not a text node, so it looks identical everywhere.
 *
 * λ for λεφτά.
 */

/** The exact tile blue from the supplied artwork, a touch lighter than brand-500. */
export const MARK_BLUE = '#4c6ef5';

export function LeftaMark({
  className = 'h-8 w-8',
  title,
}: {
  className?: string;
  title?: string;
}) {
  return (
    <svg
      viewBox="0 0 32 32"
      className={className}
      role={title ? 'img' : 'presentation'}
      aria-label={title}
      aria-hidden={title ? undefined : true}
    >
      {title ? <title>{title}</title> : null}
      <rect width="32" height="32" rx="7.4" fill={MARK_BLUE} />
      <g
        fill="none"
        stroke="#ffffff"
        strokeWidth="3.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {/* Horizontal entry at the top left, the main diagonal, and the small
            foot it lands on. */}
        <path d="M9.7 9.2h2.2c1.3 0 2.05.7 2.55 1.9l5.15 10.9c.42.9.95 1.3 1.9 1.3h.5" />
        {/* The left leg, dropping from the middle of the diagonal. */}
        <path d="M15.5 15.9 10.6 22.7c-.5.7-.95 1-1.75 1" />
      </g>
    </svg>
  );
}

/**
 * The wordmark alone, for running prose.
 *
 * The debtor-facing payment page names the platform inside a sentence, where a
 * tile would read as a logo dropped mid-paragraph.
 */
export function LeftaWordmark({ className = '' }: { className?: string }) {
  return (
    <span className={`font-semibold ${className}`}>
      lefta<span className="text-brand-500">.app</span>
    </span>
  );
}

/**
 * Mark plus wordmark.
 *
 * The wordmark is live text, not outlines: it stays selectable, scales with the
 * user's font settings, and never ships a second copy of the glyphs.
 */
export function LeftaLogo({
  className = '',
  markClassName = 'h-7 w-7',
  textClassName = 'text-base',
}: {
  className?: string;
  markClassName?: string;
  textClassName?: string;
}) {
  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <LeftaMark className={markClassName} />
      <span className={`font-semibold tracking-tight text-ink-900 ${textClassName}`}>
        lefta<span className="text-brand-500">.app</span>
      </span>
    </span>
  );
}
