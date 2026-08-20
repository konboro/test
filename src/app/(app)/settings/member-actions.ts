'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { sendEmail } from '@/lib/email/send';
import { appUrl } from '@/lib/env';
import { formError, getDictionary } from '@/lib/i18n';
import { requireOrganization } from '@/lib/orgs/active';
import { ORG_ROLES } from '@/lib/orgs/roles';
import { createClient } from '@/lib/supabase/server';
import type { MemberRole } from '@/types/database';

export interface MemberState {
  error?: string;
  success?: string;
}

const inviteSchema = z.object({
  email: z.string().trim().min(1, 'emailRequired').max(200).email('invalidEmail'),
  role: z.enum(['owner', 'member', 'viewer']),
});

/**
 * Invite someone into the company that is currently active.
 *
 * The token comes back from the database exactly once — only its hash is
 * stored — so the email is sent here, in the same request, or the invitation is
 * lost and has to be re-issued. A send failure is reported as such rather than
 * swallowed: an invitation nobody received is worse than an error message,
 * because the screen would show it as pending forever.
 */
export async function inviteMember(
  _prev: MemberState,
  formData: FormData,
): Promise<MemberState> {
  const t = await getDictionary();

  const parsed = inviteSchema.safeParse({
    email: formData.get('email'),
    role: formData.get('role'),
  });

  if (!parsed.success) return { error: formError(t, parsed.error.issues[0]?.message) };

  const org = await requireOrganization();
  const supabase = await createClient();

  const { data: token, error } = await supabase.rpc('invite_member', {
    p_email: parsed.data.email,
    p_role: parsed.data.role as MemberRole,
  });

  if (error) return { error: error.message };
  if (!token) return { error: t.members.inviteFailed };

  const link = `${appUrl()}/join/${token}`;
  const company = org.name ?? t.members.unnamedCompany;

  const sent = await sendEmail({
    to: parsed.data.email,
    subject: t.members.inviteSubject(company),
    text: t.members.inviteText(company, link),
    html: t.members.inviteHtml(company, link),
  });

  if (!sent.ok) return { error: t.members.inviteEmailFailed };

  revalidatePath('/settings/members');
  return { success: t.members.inviteSent(parsed.data.email) };
}

export async function revokeInvite(formData: FormData) {
  const id = String(formData.get('id') ?? '');
  if (!id) return;

  const supabase = await createClient();
  await supabase.rpc('revoke_invite', { p_invite: id });
  revalidatePath('/settings/members');
}

export async function removeMember(formData: FormData) {
  const id = String(formData.get('member_id') ?? '');
  if (!id) return;

  const supabase = await createClient();
  await supabase.rpc('remove_member', { p_member: id });

  // Removing yourself changes which companies exist for you everywhere.
  revalidatePath('/', 'layout');
}

export async function setMemberRole(formData: FormData) {
  const id = String(formData.get('member_id') ?? '');
  const role = String(formData.get('role') ?? '');

  if (!id || !(ORG_ROLES as readonly string[]).includes(role)) return;

  const supabase = await createClient();
  await supabase.rpc('set_member_role', { p_member: id, p_role: role as MemberRole });
  revalidatePath('/settings/members');
}
