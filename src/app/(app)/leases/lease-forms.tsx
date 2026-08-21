'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';

import { Button, Card, CardHeader, Field, inputClass } from '@/components/ui';
import { useT } from '@/lib/i18n/provider';

import { createLease, type LeaseState } from './actions';

function Submit() {
  const t = useT();
  const { pending } = useFormStatus();

  return (
    <Button type="submit" variant="brand" disabled={pending}>
      {pending ? t.leases.saving : t.leases.save}
    </Button>
  );
}

/**
 * Everything a lease is, on one screen.
 *
 * Seven fields, and two of them are dates the landlord will not think about —
 * so both carry a sensible default and an explanation rather than an empty box.
 * `generate_from` in particular decides whether entering an old tenancy quietly
 * bills two years of arrears, which is not a question to leave to a blank
 * field.
 */
export function CreateLeaseForm({
  debtors,
  today,
  defaultGenerateFrom,
}: {
  debtors: Array<{ id: string; name: string }>;
  today: string;
  defaultGenerateFrom: string;
}) {
  const t = useT();
  const [state, action] = useActionState<LeaseState, FormData>(createLease, {});
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <Button variant="brand" onClick={() => setOpen(true)} disabled={debtors.length === 0}>
        {t.leases.addTitle}
      </Button>
    );
  }

  return (
    <Card>
      <CardHeader title={t.leases.addTitle} />

      <form action={action} className="space-y-4 px-5 py-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t.leases.property} hint={t.leases.propertyHint}>
            <input name="property" required maxLength={200} className={inputClass} />
          </Field>

          <Field label={t.leases.tenant}>
            <select name="debtor_id" required defaultValue="" className={inputClass}>
              <option value="" disabled>
                {t.leases.chooseTenant}
              </option>
              {debtors.map((debtor) => (
                <option key={debtor.id} value={debtor.id}>
                  {debtor.name}
                </option>
              ))}
            </select>
          </Field>

          <Field label={t.leases.rent}>
            <input
              name="amount"
              type="number"
              step="0.01"
              min="0.01"
              required
              className={inputClass}
            />
          </Field>

          <Field label={t.leases.dueDay} hint={t.leases.dueDayHint}>
            <input
              name="due_day"
              type="number"
              min="1"
              max="31"
              defaultValue={1}
              required
              className={inputClass}
            />
          </Field>

          <Field label={t.leases.startsOn}>
            <input
              name="starts_on"
              type="date"
              defaultValue={today}
              required
              className={inputClass}
            />
          </Field>

          <Field label={t.leases.endsOn}>
            <input name="ends_on" type="date" className={inputClass} />
          </Field>

          <div className="sm:col-span-2">
            <Field label={t.leases.generateFrom} hint={t.leases.generateFromHint}>
              <input
                name="generate_from"
                type="date"
                defaultValue={defaultGenerateFrom}
                required
                className={inputClass}
              />
            </Field>
          </div>
        </div>

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

        <div className="flex flex-wrap gap-2">
          <Submit />
          <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
            {t.common.cancel}
          </Button>
        </div>
      </form>
    </Card>
  );
}
