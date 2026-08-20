'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';

import { Button, Field, inputClass } from '@/components/ui';
import { useT } from '@/lib/i18n/provider';

import { createOrganization, type CompanyState } from '../actions';

function Submit() {
  const t = useT();
  const { pending } = useFormStatus();

  return (
    <Button type="submit" disabled={pending}>
      {pending ? t.fields.saving : t.companies.createCta}
    </Button>
  );
}

export function CompanyForm() {
  const t = useT();
  const [state, action] = useActionState<CompanyState, FormData>(createOrganization, {});

  return (
    <form action={action} className="space-y-4">
      {state.error ? (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {state.error}
        </p>
      ) : null}

      <Field label={t.fields.companyName}>
        <input name="company_name" required autoFocus className={inputClass} />
      </Field>

      <Field label={t.fields.vat} hint={t.companies.vatHint}>
        <input name="vat_number" className={inputClass} />
      </Field>

      <Submit />
    </form>
  );
}
