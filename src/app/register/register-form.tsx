'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';

import { signUp, type AuthState } from '@/app/auth/actions';
import { Button, Field, inputClass } from '@/components/ui';
import { useT } from '@/lib/i18n/provider';

function Submit() {
  const t = useT();
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending} className="w-full">
      {pending ? t.auth.creating : t.auth.registerLink}
    </Button>
  );
}

export function RegisterForm() {
  const t = useT();
  const [state, action] = useActionState<AuthState, FormData>(signUp, {});

  return (
    <form action={action} className="mt-6 space-y-4 rounded-xl border border-ink-200 bg-white p-6 shadow-sm">
      <Field label={t.auth.companyName}>
        <input name="company_name" required className={inputClass} />
      </Field>

      <Field label="Email">
        <input name="email" type="email" required autoComplete="email" className={inputClass} />
      </Field>

      <Field label={t.auth.password} hint={t.auth.passwordHint}>
        <input
          name="password"
          type="password"
          required
          minLength={8}
          autoComplete="new-password"
          className={inputClass}
        />
      </Field>

      {state.error ? (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {state.error}
        </p>
      ) : null}

      {state.notice ? (
        <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{state.notice}</p>
      ) : null}

      <Submit />
    </form>
  );
}
