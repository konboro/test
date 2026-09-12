'use client';

import { useT } from '@/lib/i18n/provider';

/**
 * Ticks every row box in one go.
 *
 * The selection itself is plain form state — each row carries a checkbox named
 * `ids`, so the browser submits it without help and the table stays a server
 * component. This is the one part that genuinely needs the client, and if the
 * script never loads the operator can still tick rows by hand.
 */
export function SelectAll({ form }: { form: string }) {
  return (
    <input
      type="checkbox"
      aria-label={useT().invoices.bulk.selectAll}
      className="h-5 w-5 cursor-pointer rounded border-ink-300 text-brand-600 focus-visible:ring-2 focus-visible:ring-brand-500"
      onChange={(event) => {
        const owner = document.getElementById(form);
        if (!(owner instanceof HTMLFormElement)) return;

        const checked = event.currentTarget.checked;

        // `form.elements`, not a query on the form's subtree. The row boxes sit
        // inside the table and join this form by the `form` attribute, so they
        // are associated with it without being descendants of it — which is why
        // searching the subtree found none of them and ticking this box did
        // nothing at all.
        for (const element of Array.from(owner.elements)) {
          if (element instanceof HTMLInputElement && element.name === 'ids') {
            element.checked = checked;
          }
        }
      }}
    />
  );
}
