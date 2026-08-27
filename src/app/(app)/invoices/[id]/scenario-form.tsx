'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';

import { Button } from '@/components/ui';
import type { Scenario } from '@/lib/dunning/scenario';
import { useT } from '@/lib/i18n/provider';
import type { InvoiceScenarioMode } from '@/types/database';

import { InvoiceScenarioEditor } from '../scenario-editor';
import { saveInvoiceScenario, type InvoiceScenarioState } from '../scenario-actions';

function Submit() {
  const t = useT();
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending} className="w-full sm:w-auto">
      {pending ? t.common.saving : t.common.save}
    </Button>
  );
}

/** The same editor as the create form, with a save of its own. */
export function InvoiceScenarioForm({
  invoiceId,
  scenario,
  mode,
}: {
  invoiceId: string;
  scenario: Scenario;
  mode: InvoiceScenarioMode;
}) {
  const [state, action] = useActionState<InvoiceScenarioState, FormData>(saveInvoiceScenario, {});

  return (
    <form action={action} className="space-y-4 px-4 py-4 sm:px-5">
      <input type="hidden" name="id" value={invoiceId} />

      <InvoiceScenarioEditor scenario={scenario} mode={mode} />

      {state.error ? (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {state.error}
        </p>
      ) : null}
      {state.success ? (
        <p role="status" className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          {state.success}
        </p>
      ) : null}

      <Submit />
    </form>
  );
}
