'use client';

import { useActionState, useEffect, useState } from 'react';
import { useFormStatus } from 'react-dom';

import { Modal } from '@/components/modal';
import { Button } from '@/components/ui';
import { useT } from '@/lib/i18n/provider';

export interface DeleteState {
  error?: string;
  /** Set once the row is gone, so the dialog can get out of the way. */
  ok?: boolean;
}

/**
 * Deleting something, with the consequences named first.
 *
 * The dialog exists to state what else goes. Both of the things this deletes
 * cascade — an invoice takes its payment attempts and link activity, a customer
 * takes their invoices and every message ever sent to them — and none of that is
 * visible from the row the button sits on. "Are you sure?" asks the reader to
 * supply the facts; this supplies them.
 *
 * There is no undo behind it, so the copy does not promise one.
 */
function Confirm({ label }: { label: string }) {
  const t = useT();
  const { pending } = useFormStatus();

  return (
    <Button type="submit" variant="danger" disabled={pending}>
      {pending ? t.common.deleting : label}
    </Button>
  );
}

export function DeleteButton({
  action,
  id,
  trigger,
  title,
  body,
  warning,
  confirmLabel,
}: {
  action: (state: DeleteState, formData: FormData) => Promise<DeleteState>;
  id: string;
  /** The text on the row. Deliberately quiet: this is not a primary action. */
  trigger: string;
  title: string;
  /** What is about to happen, in counts rather than adjectives. */
  body: string;
  /** Shown louder, for the cases that destroy a record of money. */
  warning?: string;
  confirmLabel: string;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [state, formAction] = useActionState<DeleteState, FormData>(action, {});

  // Left open, the dialog sat over a list that had already lost the row and a
  // dashboard whose totals had already moved — so the delete looked like it had
  // done nothing. The action revalidates; this just gets out of the way.
  useEffect(() => {
    if (state.ok) setOpen(false);
  }, [state.ok]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex min-h-11 items-center sm:min-h-0 text-sm text-ink-500 underline-offset-2 transition hover:text-red-600 hover:underline"
      >
        {trigger}
      </button>

      {open ? (
        <Modal
          title={title}
          onClose={() => setOpen(false)}
          footer={
            <>
              {state.error ? (
                <p
                  role="alert"
                  className="w-full rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700"
                >
                  {state.error}
                </p>
              ) : null}

              <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
                {t.common.cancel}
              </Button>

              <form action={formAction}>
                <input type="hidden" name="id" value={id} />
                {/* A delete should not be one stray request away. The dialog is
                    the only thing that sets this. */}
                <input type="hidden" name="confirm" value="yes" />
                <Confirm label={confirmLabel} />
              </form>
            </>
          }
        >
          <p className="text-sm leading-relaxed text-ink-700">{body}</p>

          {warning ? (
            <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
              {warning}
            </p>
          ) : null}

          <p className="mt-3 text-xs text-ink-500">{t.common.deleteIrreversible}</p>
        </Modal>
      ) : null}
    </>
  );
}
