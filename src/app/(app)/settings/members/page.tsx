import { redirect } from 'next/navigation';

import { DeleteButton } from '@/components/delete-button';
import { Badge, Card, CardHeader, EmptyState } from '@/components/ui';
import { getDictionary } from '@/lib/i18n';
import { formatDate } from '@/lib/money';
import { requireOrganization } from '@/lib/orgs/active';
import { canManageMembers } from '@/lib/orgs/roles';
import { createClient } from '@/lib/supabase/server';

import { deleteOrganization } from '../../companies/actions';
import { removeMember, revokeInvite } from '../member-actions';
import { InviteForm, RoleSelect } from './members-forms';

export async function generateMetadata() {
  return { title: (await getDictionary()).members.title };
}
export const dynamic = 'force-dynamic';

/**
 * Who can act for this company.
 *
 * Visible to everyone in it, not only to owners: a person whose books are being
 * worked on by an accountant is entitled to see that, and hiding the list would
 * make "who else can send letters in my name" an unanswerable question from
 * inside the product.
 */
export default async function MembersPage() {
  const t = await getDictionary();
  const org = await requireOrganization();

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const manages = canManageMembers(org.role);

  const [{ data: members }, { data: invites }] = await Promise.all([
    supabase
      .from('organization_members')
      .select('member_id, member_email, role, created_at')
      .eq('organization_id', org.id)
      .order('created_at'),
    supabase
      .from('organization_invites')
      .select('id, email, role, created_at, expires_at')
      .eq('organization_id', org.id)
      .is('accepted_at', null)
      .order('created_at'),
  ]);

  const people = members ?? [];
  const pending = invites ?? [];
  const owners = people.filter((person) => person.role === 'owner').length;

  return (
    <div className="space-y-4">
      {/* No heading and no way back: the tab strip above is both. This page
          had neither a link into it nor a place in the navigation — it was
          reachable only by typing the URL — so it carried its own title and a
          link home to stand in for the frame it now sits inside. */}
      <p className="max-w-2xl text-sm leading-relaxed text-ink-500">
        {t.members.subtitle(org.name ?? t.companies.unnamed)}
      </p>

      <Card>
        <CardHeader title={t.members.listTitle(people.length)} />

        <ul className="divide-y divide-ink-100">
          {people.map((person) => {
            const isSelf = person.member_id === user.id;
            // The last owner cannot be demoted or removed — the database
            // refuses it, and offering the control anyway would be a button
            // whose only outcome is an error.
            const lastOwner = person.role === 'owner' && owners === 1;

            return (
              <li key={person.member_id} className="flex flex-wrap items-center gap-3 px-5 py-4">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="truncate text-sm font-medium text-ink-900">
                      {person.member_email}
                    </span>
                    {isSelf ? <Badge tone="info">{t.members.you}</Badge> : null}
                  </div>
                  <p className="mt-0.5 text-xs text-ink-500">
                    {t.members.joined(formatDate(person.created_at))}
                  </p>
                </div>

                {manages && !lastOwner ? (
                  <RoleSelect memberId={person.member_id} role={person.role} />
                ) : (
                  <Badge tone="neutral">
                    {person.role === 'owner'
                      ? t.members.roleOwner
                      : person.role === 'viewer'
                        ? t.members.roleViewer
                        : t.members.roleMember}
                  </Badge>
                )}

                {(manages || isSelf) && !lastOwner ? (
                  <form action={removeMember}>
                    <input type="hidden" name="member_id" value={person.member_id} />
                    <button
                      type="submit"
                      className="inline-flex min-h-11 items-center sm:min-h-0 text-sm text-ink-500 underline-offset-2 transition hover:text-red-600 hover:underline"
                    >
                      {isSelf ? t.members.leave : t.members.remove}
                    </button>
                  </form>
                ) : null}
              </li>
            );
          })}
        </ul>
      </Card>

      {pending.length ? (
        <Card>
          <CardHeader title={t.members.pendingTitle} subtitle={t.members.pendingSubtitle} />
          <ul className="divide-y divide-ink-100">
            {pending.map((invite) => (
              <li key={invite.id} className="flex flex-wrap items-center gap-3 px-5 py-4">
                <div className="min-w-0 flex-1">
                  <span className="truncate text-sm text-ink-800">{invite.email}</span>
                  <p className="mt-0.5 text-xs text-ink-500">
                    {t.members.expires(formatDate(invite.expires_at))}
                  </p>
                </div>
                <Badge tone="neutral">
                  {invite.role === 'owner'
                    ? t.members.roleOwner
                    : invite.role === 'viewer'
                      ? t.members.roleViewer
                      : t.members.roleMember}
                </Badge>
                {manages ? (
                  <form action={revokeInvite}>
                    <input type="hidden" name="id" value={invite.id} />
                    <button
                      type="submit"
                      className="inline-flex min-h-11 items-center sm:min-h-0 text-sm text-ink-500 underline-offset-2 transition hover:text-red-600 hover:underline"
                    >
                      {t.members.revoke}
                    </button>
                  </form>
                ) : null}
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      {manages ? (
        <Card>
          <CardHeader title={t.members.inviteTitle} subtitle={t.members.inviteSubtitle} />
          <div className="p-5">
            <InviteForm />
          </div>
        </Card>
      ) : (
        <EmptyState title={t.members.notOwnerTitle} body={t.members.notOwnerBody} />
      )}

      {manages ? (
        <Card>
          <CardHeader title={t.members.dangerTitle} subtitle={t.members.dangerSubtitle} />
          <div className="flex flex-wrap items-center justify-between gap-3 p-4 sm:p-5">
            <p className="text-sm text-ink-600">
              {t.members.deleteBody(org.name ?? t.companies.unnamed)}
            </p>
            <DeleteButton
              action={deleteOrganization}
              id={org.id}
              trigger={t.members.deleteTrigger}
              title={t.members.deleteTitle}
              body={t.members.deleteConfirm(org.name ?? t.companies.unnamed)}
              warning={t.members.deleteWarning}
              confirmLabel={t.members.deleteTrigger}
            />
          </div>
        </Card>
      ) : null}
    </div>
  );
}
