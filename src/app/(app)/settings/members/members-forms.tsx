'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';

import { Button, Field, inputClass } from '@/components/ui';
import { useT } from '@/lib/i18n/provider';
import { ORG_ROLES, type OrgRole } from '@/lib/orgs/roles';

import { inviteMember, setMemberRole, type MemberState } from '../member-actions';

function roleLabel(t: ReturnType<typeof useT>, role: OrgRole) {
  return role === 'owner' ? t.members.roleOwner : role === 'viewer' ? t.members.roleViewer : t.members.roleMember;
}

function Submit() {
  const t = useT();
  const { pending } = useFormStatus();

  return (
    <Button type="submit" disabled={pending}>
      {pending ? t.fields.saving : t.members.inviteCta}
    </Button>
  );
}

export function InviteForm() {
  const t = useT();
  const [state, action] = useActionState<MemberState, FormData>(inviteMember, {});

  return (
    <form action={action} className="space-y-4">
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

      <div className="grid gap-4 sm:grid-cols-[1fr_auto_auto] sm:items-end">
        <Field label={t.fields.email} hint={t.members.inviteEmailHint}>
          <input name="email" type="email" required className={inputClass} />
        </Field>

        <Field label={t.members.roleLabel} hint={t.members.roleHint}>
          <select name="role" defaultValue="member" className={inputClass}>
            {ORG_ROLES.map((role) => (
              <option key={role} value={role}>
                {roleLabel(t, role)}
              </option>
            ))}
          </select>
        </Field>

        <Submit />
      </div>
    </form>
  );
}

/**
 * Changing someone's role.
 *
 * Submits on change rather than behind a save button: there is one field, and a
 * select that silently keeps its new value without applying it is how someone
 * ends up believing they revoked an access they did not.
 */
export function RoleSelect({ memberId, role }: { memberId: string; role: OrgRole }) {
  const t = useT();

  return (
    <form action={setMemberRole}>
      <input type="hidden" name="member_id" value={memberId} />
      <select
        name="role"
        defaultValue={role}
        aria-label={t.members.roleLabel}
        onChange={(event) => event.currentTarget.form?.requestSubmit()}
        className="rounded-lg border border-ink-300 bg-white min-h-11 px-2.5 text-sm sm:min-h-0 sm:py-1 text-ink-700 outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
      >
        {ORG_ROLES.map((option) => (
          <option key={option} value={option}>
            {roleLabel(t, option)}
          </option>
        ))}
      </select>
    </form>
  );
}
