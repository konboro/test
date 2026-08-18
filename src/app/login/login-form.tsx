'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';

import { signIn, type AuthState } from '@/app/auth/actions';
import { Button, Field, inputClass } from '@/components/ui';
import { useT } from '@/lib/i18n/provider';

function Submit() {
  const t = useT();
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending} className="w-full">
      {pending ? t.auth.signingIn : t.auth.signInTitle}
    </Button>
  );
}

export function LoginForm({ next }: { next?: string }) {
  const t = useT();
  const [state, action] = useActionState<AuthState, FormData>(signIn, {});

  return (
    <form action={action} className="mt-6 space-y-4 rounded-xl border border-ink-200 bg-white p-6 shadow-sm">
      {next ? <input type="hidden" name="next" value={next} /> : null}

      <Field label="Email">
        <input name="email" type="email" required autoComplete="email" className={inputClass} />
      </Field>

      <Field label={t.auth.password}>
        <input
          name="password"
          type="password"
          required
          autoComplete="current-password"
          className={inputClass}
        />
      </Field>

      {state.error ? (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {state.error}
        </p>
      ) : null}

      <Submit />
    </form>
  );
}
