'use client';

import { useFormStatus } from 'react-dom';

/**
 * The bulk bar's buttons, aware that a send is in flight.
 *
 * A bulk press walks the selection one invoice at a time — the daily contact
 * guarantee is a unique index, so concurrent sends to one customer would race
 * into it — and fifty invoices take real seconds. Until now the page did nothing
 * visible while that ran, which reads as "the click missed" and invites a second
 * press. That second press is not harmless: it re-submits the whole selection.
 *
 * `useFormStatus` reports the pending state of the form this sits inside, so
 * both buttons disable together. Whichever one was pressed says what it is
 * doing; the other simply greys out, because starting the other action mid-run
 * would submit the same rows twice under a different cadence.
 */
export function BulkActions({
  sendLabel,
  sendingLabel,
  scenarioLabel,
  paidLabel,
  paidConfirm,
  runScenario,
  markPaid,
}: {
  sendLabel: string;
  sendingLabel: string;
  scenarioLabel: string;
  paidLabel: string;
  /** Asked before settling a batch, because nothing in the app un-settles one. */
  paidConfirm: string;
  /** The alternative server actions, each bound to its own button. */
  runScenario: (formData: FormData) => void | Promise<void>;
  markPaid: (formData: FormData) => void | Promise<void>;
}) {
  const { pending } = useFormStatus();

  return (
    <>
      <button
        type="submit"
        disabled={pending}
        className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-3.5 py-1.5 text-sm font-medium text-white shadow-sm outline-none transition hover:bg-brand-700 focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {pending ? <Spinner /> : null}
        {pending ? sendingLabel : sendLabel}
      </button>

      {/* Same selection, but the cadence decides what goes out rather than the
          picker beside it. */}
      <button
        type="submit"
        formAction={runScenario}
        disabled={pending}
        className="rounded-lg border border-ink-300 bg-white px-3.5 py-1.5 text-sm font-medium text-ink-700 outline-none transition hover:bg-ink-50 focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {scenarioLabel}
      </button>

      {/* Settling a batch is the one action here with no way back — nothing in
          the product marks an invoice unpaid again — so it asks first. */}
      <button
        type="submit"
        formAction={markPaid}
        disabled={pending}
        onClick={(event) => {
          if (!window.confirm(paidConfirm)) event.preventDefault();
        }}
        className="rounded-lg border border-ink-300 bg-white px-3.5 py-1.5 text-sm font-medium text-ink-700 outline-none transition hover:bg-ink-50 focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {paidLabel}
      </button>
    </>
  );
}

/** Respects reduced motion by holding still rather than spinning. */
function Spinner() {
  return (
    <svg
      viewBox="0 0 16 16"
      aria-hidden="true"
      className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none"
    >
      <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="2" fill="none" opacity="0.3" />
      <path
        d="M8 2a6 6 0 0 1 6 6"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        fill="none"
      />
    </svg>
  );
}
