'use client';

import { useEffect, useRef, type ReactNode } from 'react';

/**
 * The one dialog in the product.
 *
 * Separate from `ui.tsx` because it needs hooks, and marking that whole module
 * `'use client'` would drag every card and badge in the app into the client
 * bundle for no reason.
 *
 * Handles the things a hand-rolled overlay usually forgets: Escape closes it,
 * clicking the backdrop closes it, the page behind does not scroll while it is
 * open, and focus lands inside rather than staying on the button that opened it.
 */
export function Modal({
  title,
  subtitle,
  onClose,
  children,
  footer,
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }

    document.addEventListener('keydown', onKey);

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    panel.current?.focus();

    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-ink-900/50 p-4 backdrop-blur-[2px] sm:items-center"
      onMouseDown={(event) => {
        // mousedown, not click: a drag that starts inside the panel and ends on
        // the backdrop would otherwise close the dialog mid-text-selection.
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className="w-full max-w-2xl rounded-2xl border border-ink-200 bg-white text-left shadow-xl outline-none"
      >
        <div className="flex items-start justify-between gap-4 border-b border-ink-200 px-5 py-4">
          <div>
            <h2 className="text-sm font-semibold text-ink-900">{title}</h2>
            {subtitle ? <p className="mt-0.5 text-xs text-ink-500">{subtitle}</p> : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Κλείσιμο"
            className="-m-1.5 rounded-lg p-1.5 text-ink-400 transition hover:bg-ink-100 hover:text-ink-700"
          >
            <svg viewBox="0 0 20 20" fill="none" className="h-4 w-4" aria-hidden="true">
              <path
                d="M5 5l10 10M15 5L5 15"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>

        <div className="max-h-[70vh] space-y-4 overflow-y-auto px-5 py-4">{children}</div>

        {footer ? (
          <div className="flex flex-wrap justify-end gap-2 border-t border-ink-200 bg-ink-50 px-5 py-4">
            {footer}
          </div>
        ) : null}
      </div>
    </div>
  );
}
