-- lefta.app — many companies per login, many logins per company
--
-- Until now the tenant was the auth user: `users.id` *was* `auth.uid()`, and
-- every policy in the schema said so. That model has no answer for the two
-- things the accountant channel is made of — one person reaching two hundred
-- companies, and one company reached by two people.
--
-- The company was always the `public.users` row: it holds the company name, the
-- VAT number, the myDATA credentials, the payment keys, the SMS balance. What
-- changes here is that the row stops being required to be an auth user, and a
-- membership table decides who may act for it.
--
-- Scoping moves from "the row is mine" to "the row belongs to the company I am
-- acting for, and I am a member of it". The company travels as a request header
-- rather than as a filter in application code: an accountant may see two
-- hundred companies, so "everything I am allowed to see" stopped being the same
-- question as "what am I looking at" — and putting that distinction into 139
-- call sites means one forgotten `.eq()` mixes two clients' receivables on the
-- same screen. See docs/multi-company.md.
--
-- Migration is a no-op for everyone who exists today: their company id equals
-- their auth id, the backfill makes them its owner, and with no header at all
-- the resolver falls back to `auth.uid()`.

-- ---------------------------------------------------------------------------
-- a company row no longer has to be a person
-- ---------------------------------------------------------------------------

-- Dropped by lookup rather than by name: the constraint was created inline in
-- the initial schema, so its name is Postgres's to choose, not ours.
--
-- This also removes the cascade that deleted a tenant when its auth user was
-- deleted. That cascade is wrong once a company can have several members —
-- deleting one of them must not delete the company and everyone else's work.
-- The membership rows still cascade, so a deleted account stops being a member
-- of anything.
do $$
declare
  constraint_name text;
begin
  select conname into constraint_name
    from pg_constraint
   where conrelid = 'public.users'::regclass
     and contype = 'f'
     and confrelid = 'auth.users'::regclass;

  if constraint_name is not null then
    execute format('alter table public.users drop constraint %I', constraint_name);
  end if;
end
$$;

comment on table public.users is
  'One company (tenant). Named `users` for historical reasons — it holds companies, not people; who may act for a company is public.organization_members. Renaming is a follow-up, see docs/multi-company.md.';

-- One column in the schema meant a person rather than a company, and only
-- looked like the others because the two used to be the same row.
-- `bank_transactions.matched_by` records who confirmed a transfer against an
-- invoice by hand — an audit answer, and the question it answers is "which of
-- us", which is exactly the question the accountant channel introduces.
--
-- Every value in it today is both a company id and an auth user id, so
-- repointing the reference is safe on existing data.
do $$
declare
  constraint_name text;
begin
  select conname into constraint_name
    from pg_constraint
   where conrelid = 'public.bank_transactions'::regclass
     and contype = 'f'
     and confrelid = 'public.users'::regclass
     and conkey = array[(
       select attnum from pg_attribute
        where attrelid = 'public.bank_transactions'::regclass and attname = 'matched_by'
     )];

  if constraint_name is not null then
    execute format('alter table public.bank_transactions drop constraint %I', constraint_name);
  end if;
end
$$;

alter table public.bank_transactions
  add constraint bank_transactions_matched_by_fkey
  foreign key (matched_by) references auth.users (id) on delete set null;

comment on column public.bank_transactions.matched_by is
  'Which person confirmed the match by hand. Null when the sweep matched it automatically.';

-- ---------------------------------------------------------------------------
-- membership
-- ---------------------------------------------------------------------------

create table public.organization_members (
  organization_id uuid not null references public.users (id) on delete cascade,
  member_id       uuid not null references auth.users (id) on delete cascade,

  -- Denormalised so the members screen can name people without the browser
  -- ever reading auth.users, which is not exposed to `authenticated` at all.
  member_email    text not null,

  role            text not null default 'member'
                  check (role in ('owner', 'member', 'viewer')),

  invited_by      uuid references auth.users (id) on delete set null,
  created_at      timestamptz not null default now(),

  primary key (organization_id, member_id)
);

comment on column public.organization_members.role is
  'owner: everything, including members. member: everything operational. viewer: read only — the client the accountant works for, who should see their own ledger and send nothing.';

create index organization_members_member_idx
  on public.organization_members (member_id);

-- Everyone who exists today owns their own company.
insert into public.organization_members (organization_id, member_id, member_email, role, created_at)
select u.id, u.id, u.email, 'owner', u.created_at
  from public.users u
  join auth.users a on a.id = u.id
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- invitations
-- ---------------------------------------------------------------------------

create table public.organization_invites (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.users (id) on delete cascade,
  email           text not null,
  role            text not null check (role in ('owner', 'member', 'viewer')),

  -- The token is emailed once and never stored: what is kept is its SHA-256, so
  -- a leaked backup hands out no access.
  token_hash      text not null unique,

  invited_by      uuid references auth.users (id) on delete set null,
  created_at      timestamptz not null default now(),
  expires_at      timestamptz not null,
  accepted_at     timestamptz,
  accepted_by     uuid references auth.users (id) on delete set null
);

create index organization_invites_org_idx
  on public.organization_invites (organization_id)
  where accepted_at is null;

-- ---------------------------------------------------------------------------
-- who am I acting for
-- ---------------------------------------------------------------------------

-- The active company as asked for by the caller. Deliberately unauthenticated:
-- it reports what the header said, and nothing else. Everything that matters is
-- decided by current_org_id() below, which will only agree with a header that
-- names a company the caller is actually a member of.
--
-- Defensive to the point of paranoia because it runs inside every policy: a
-- header carrying junk, or no PostgREST request context at all (psql, a
-- migration, a direct connection), must return null rather than raise.
create or replace function public.requested_org_id()
returns uuid
language plpgsql
stable
as $$
declare
  raw text;
begin
  raw := nullif(current_setting('request.headers', true)::json ->> 'x-lefta-org', '');
  if raw is null then
    return null;
  end if;
  return raw::uuid;
exception
  when others then
    return null;
end;
$$;

-- The company the caller is acting for, or null.
--
-- Both halves are a lookup in the caller's own memberships, which is the whole
-- security model: a forged header can only ever select among companies the
-- caller already belongs to, so calling the REST API directly with someone
-- else's company id is answered with their own first company, never that one.
--
-- The second half also decides what a stale cookie does. A membership that was
-- revoked, or a company that was deleted, would otherwise leave the caller
-- looking at an application where every screen is empty and nothing says why.
-- Falling back to their oldest company is both recoverable and the same answer
-- the application computes for itself, so the header and the app never disagree
-- about which company is on screen.
create or replace function public.current_org_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select m.organization_id
       from public.organization_members m
      where m.member_id = (select auth.uid())
        and m.organization_id = coalesce(public.requested_org_id(), (select auth.uid()))),
    (select m.organization_id
       from public.organization_members m
      where m.member_id = (select auth.uid())
      order by m.created_at, m.organization_id
      limit 1)
  )
$$;

create or replace function public.current_org_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select m.role
    from public.organization_members m
   where m.member_id = (select auth.uid())
     and m.organization_id = public.current_org_id()
$$;

-- True when the caller may change things in the company they are acting for.
create or replace function public.current_org_writes()
returns boolean
language sql
stable
as $$
  select coalesce(public.current_org_role() in ('owner', 'member'), false)
$$;

-- Membership test that does not re-enter RLS on organization_members, which is
-- what a self-referencing policy would do — the classic recursion.
create or replace function public.is_org_member(p_org uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from public.organization_members m
     where m.organization_id = p_org
       and m.member_id = (select auth.uid())
  )
$$;

revoke all on function public.requested_org_id()  from public;
revoke all on function public.current_org_id()    from public;
revoke all on function public.current_org_role()  from public;
revoke all on function public.current_org_writes() from public;
revoke all on function public.is_org_member(uuid) from public;

grant execute on function public.requested_org_id()   to authenticated, service_role;
grant execute on function public.current_org_id()     to authenticated, service_role;
grant execute on function public.current_org_role()   to authenticated, service_role;
grant execute on function public.current_org_writes() to authenticated, service_role;
grant execute on function public.is_org_member(uuid)  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- policies: every table moves from "mine" to "the company I am acting for"
-- ---------------------------------------------------------------------------
--
-- Wrapped in (select …) so the resolver is an InitPlan evaluated once per
-- statement rather than once per row — the same reason the original policies
-- wrote (select auth.uid()).

alter table public.organization_members enable row level security;
alter table public.organization_invites enable row level security;

create policy organization_members_select on public.organization_members
  for select to authenticated
  using (public.is_org_member(organization_id));

-- Membership is changed through the functions at the bottom of this file, which
-- enforce who may do it and refuse to leave a company ownerless. Nothing about
-- it is writable from a browser.
revoke all on public.organization_members from anon, authenticated;
grant select (organization_id, member_id, member_email, role, created_at)
  on public.organization_members to authenticated;

create policy organization_invites_select on public.organization_invites
  for select to authenticated
  using (public.is_org_member(organization_id));

revoke all on public.organization_invites from anon, authenticated;
-- The token hash is never selectable: the link is emailed, and the screen only
-- needs to know an invitation is outstanding.
grant select (id, organization_id, email, role, created_at, expires_at, accepted_at)
  on public.organization_invites to authenticated;

-- users -----------------------------------------------------------------------

drop policy if exists users_select_own on public.users;
drop policy if exists users_update_own on public.users;

create policy users_select_active on public.users
  for select to authenticated
  using (id = (select public.current_org_id()));

create policy users_update_active on public.users
  for update to authenticated
  using (id = (select public.current_org_id()) and (select public.current_org_writes()))
  with check (id = (select public.current_org_id()) and (select public.current_org_writes()));

-- debtors ---------------------------------------------------------------------

drop policy if exists debtors_select_own on public.debtors;
drop policy if exists debtors_insert_own on public.debtors;
drop policy if exists debtors_update_own on public.debtors;
drop policy if exists debtors_delete_own on public.debtors;

create policy debtors_select_active on public.debtors
  for select to authenticated
  using (user_id = (select public.current_org_id()));

create policy debtors_insert_active on public.debtors
  for insert to authenticated
  with check (user_id = (select public.current_org_id()) and (select public.current_org_writes()));

create policy debtors_update_active on public.debtors
  for update to authenticated
  using (user_id = (select public.current_org_id()) and (select public.current_org_writes()))
  with check (user_id = (select public.current_org_id()) and (select public.current_org_writes()));

create policy debtors_delete_active on public.debtors
  for delete to authenticated
  using (user_id = (select public.current_org_id()) and (select public.current_org_writes()));

-- invoices --------------------------------------------------------------------

drop policy if exists invoices_select_own on public.invoices;
drop policy if exists invoices_insert_own on public.invoices;
drop policy if exists invoices_update_own on public.invoices;
drop policy if exists invoices_delete_own on public.invoices;

create policy invoices_select_active on public.invoices
  for select to authenticated
  using (user_id = (select public.current_org_id()));

create policy invoices_insert_active on public.invoices
  for insert to authenticated
  with check (user_id = (select public.current_org_id()) and (select public.current_org_writes()));

create policy invoices_update_active on public.invoices
  for update to authenticated
  using (user_id = (select public.current_org_id()) and (select public.current_org_writes()))
  with check (user_id = (select public.current_org_id()) and (select public.current_org_writes()));

create policy invoices_delete_active on public.invoices
  for delete to authenticated
  using (user_id = (select public.current_org_id()) and (select public.current_org_writes()));

-- message_templates -----------------------------------------------------------

drop policy if exists message_templates_select_own on public.message_templates;
drop policy if exists message_templates_insert_own on public.message_templates;
drop policy if exists message_templates_update_own on public.message_templates;
drop policy if exists message_templates_delete_own on public.message_templates;

create policy message_templates_select_active on public.message_templates
  for select to authenticated
  using (user_id = (select public.current_org_id()));

create policy message_templates_insert_active on public.message_templates
  for insert to authenticated
  with check (user_id = (select public.current_org_id()) and (select public.current_org_writes()));

create policy message_templates_update_active on public.message_templates
  for update to authenticated
  using (user_id = (select public.current_org_id()) and (select public.current_org_writes()))
  with check (user_id = (select public.current_org_id()) and (select public.current_org_writes()));

create policy message_templates_delete_active on public.message_templates
  for delete to authenticated
  using (user_id = (select public.current_org_id()) and (select public.current_org_writes()));

-- read-only histories and settings --------------------------------------------
--
-- All of these are written by the server under the service role and read by the
-- app. Only the select predicate changes.

drop policy if exists dunning_contacts_select_own on public.dunning_contacts;
create policy dunning_contacts_select_active on public.dunning_contacts
  for select to authenticated
  using (user_id = (select public.current_org_id()));

drop policy if exists comms_select_own on public.communications_log;
create policy comms_select_active on public.communications_log
  for select to authenticated
  using (user_id = (select public.current_org_id()));

drop policy if exists sms_purchases_select_own on public.sms_credit_purchases;
create policy sms_purchases_select_active on public.sms_credit_purchases
  for select to authenticated
  using (user_id = (select public.current_org_id()));

drop policy if exists bank_connections_select_own on public.bank_connections;
create policy bank_connections_select_active on public.bank_connections
  for select to authenticated
  using (user_id = (select public.current_org_id()));

drop policy if exists bank_transactions_select_own on public.bank_transactions;
create policy bank_transactions_select_active on public.bank_transactions
  for select to authenticated
  using (user_id = (select public.current_org_id()));

drop policy if exists funnel_events_select_own on public.funnel_events;
create policy funnel_events_select_active on public.funnel_events
  for select to authenticated
  using (user_id = (select public.current_org_id()));

drop policy if exists dunning_steps_select_own on public.dunning_steps;
create policy dunning_steps_select_active on public.dunning_steps
  for select to authenticated
  using (user_id = (select public.current_org_id()));

drop policy if exists dunning_settings_select_own on public.dunning_settings;
create policy dunning_settings_select_active on public.dunning_settings
  for select to authenticated
  using (user_id = (select public.current_org_id()));

drop policy if exists invoice_uploads_select_own on public.invoice_uploads;
create policy invoice_uploads_select_active on public.invoice_uploads
  for select to authenticated
  using (user_id = (select public.current_org_id()));

-- ---------------------------------------------------------------------------
-- a new signup owns their first company
-- ---------------------------------------------------------------------------

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.users (id, email, company_name)
  values (
    new.id,
    new.email,
    nullif(new.raw_user_meta_data ->> 'company_name', '')
  )
  on conflict (id) do nothing;

  insert into public.organization_members (organization_id, member_id, member_email, role)
  values (new.id, new.id, new.email, 'owner')
  on conflict do nothing;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- the operations a browser is allowed to perform on companies and members
-- ---------------------------------------------------------------------------
--
-- All security definer, all checking the caller against organization_members
-- themselves. `users` grants no INSERT to `authenticated` and never will, so
-- adding a company has to come through here.

create or replace function public.create_organization(
  p_company_name text,
  p_vat_number   text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := (select auth.uid());
  caller_email text;
  new_id uuid;
  name_clean text := nullif(btrim(coalesce(p_company_name, '')), '');
begin
  if caller is null then
    raise exception 'not authenticated';
  end if;

  if name_clean is null then
    raise exception 'company name is required';
  end if;

  select email into caller_email from auth.users where id = caller;

  insert into public.users (id, email, company_name, vat_number)
  values (gen_random_uuid(), caller_email, name_clean, nullif(btrim(coalesce(p_vat_number, '')), ''))
  returning id into new_id;

  insert into public.organization_members (organization_id, member_id, member_email, role)
  values (new_id, caller, caller_email, 'owner');

  return new_id;
end;
$$;

-- Every company the caller can act for. Cannot be a view over `users`: the
-- policy there shows exactly one company — the active one — which is the point
-- of it, and a switcher has to list the rest.
create or replace function public.my_organizations()
returns table (
  organization_id uuid,
  company_name    text,
  vat_number      text,
  role            text,
  -- When the membership started, not the company: it is what decides which
  -- company someone lands in, and it has to be the same tie-break the policy
  -- resolver uses in current_org_id().
  joined_at       timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select u.id, u.company_name, u.vat_number, m.role, m.created_at
    from public.organization_members m
    join public.users u on u.id = m.organization_id
   where m.member_id = (select auth.uid())
   order by coalesce(u.company_name, u.email)
$$;

-- The portfolio: what is open and what is late, across every company at once.
-- This is the screen that makes two hundred clients workable — without it the
-- only way to find out who needs chasing today is to switch into each company
-- and look.
create or replace function public.my_organizations_summary(p_today date)
returns table (
  organization_id uuid,
  company_name    text,
  vat_number      text,
  role            text,
  joined_at       timestamptz,
  open_cents      bigint,
  open_count      bigint,
  overdue_count   bigint
)
language sql
stable
security definer
set search_path = public
as $$
  select
    u.id,
    u.company_name,
    u.vat_number,
    m.role,
    m.created_at,
    coalesce(sum(i.amount_cents) filter (where i.status = 'pending'), 0)::bigint,
    count(i.id) filter (where i.status = 'pending')::bigint,
    count(i.id) filter (where i.status = 'pending' and i.due_date < p_today)::bigint
  from public.organization_members m
  join public.users u on u.id = m.organization_id
  left join public.invoices i on i.user_id = m.organization_id
  where m.member_id = (select auth.uid())
  group by u.id, u.company_name, u.vat_number, u.email, m.role, m.created_at
  order by coalesce(u.company_name, u.email)
$$;

create or replace function public.delete_organization(p_org uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.organization_members
     where organization_id = p_org
       and member_id = (select auth.uid())
       and role = 'owner'
  ) then
    raise exception 'only an owner may delete a company';
  end if;

  -- Everything the company owns cascades from here: its debtors, its invoices,
  -- its correspondence. There is no undo, which is why the UI asks twice.
  delete from public.users where id = p_org;
end;
$$;

-- members ---------------------------------------------------------------------

create or replace function public.invite_member(
  p_email text,
  p_role  text default 'member'
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  org uuid := public.current_org_id();
  caller uuid := (select auth.uid());
  email_clean text := lower(btrim(coalesce(p_email, '')));
  token text;
begin
  if org is null then
    raise exception 'no active company';
  end if;

  if not exists (
    select 1 from public.organization_members
     where organization_id = org and member_id = caller and role = 'owner'
  ) then
    raise exception 'only an owner may invite';
  end if;

  if email_clean = '' or email_clean not like '%_@_%.__%' then
    raise exception 'a valid email address is required';
  end if;

  if p_role not in ('owner', 'member', 'viewer') then
    raise exception 'unknown role';
  end if;

  if exists (
    select 1 from public.organization_members
     where organization_id = org and lower(member_email) = email_clean
  ) then
    raise exception 'already a member';
  end if;

  -- One outstanding invitation per address: re-inviting replaces the old link
  -- rather than leaving two valid ones in two inboxes.
  delete from public.organization_invites
   where organization_id = org and lower(email) = email_clean and accepted_at is null;

  token := encode(extensions.gen_random_bytes(24), 'hex');

  insert into public.organization_invites
    (organization_id, email, role, token_hash, invited_by, expires_at)
  values
    (org, email_clean, p_role, encode(extensions.digest(token, 'sha256'), 'hex'),
     caller, now() + interval '7 days');

  -- Returned once, to be emailed. It is not recoverable afterwards.
  return token;
end;
$$;

create or replace function public.revoke_invite(p_invite uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  org uuid := public.current_org_id();
begin
  if org is null or not exists (
    select 1 from public.organization_members
     where organization_id = org and member_id = (select auth.uid()) and role = 'owner'
  ) then
    raise exception 'only an owner may revoke an invitation';
  end if;

  delete from public.organization_invites
   where id = p_invite and organization_id = org and accepted_at is null;
end;
$$;

-- Accepting runs for someone who is not yet a member, so it cannot go through
-- RLS — the invite row is invisible to them until the moment it stops being an
-- invite. The email must match: a forwarded link should not hand a stranger a
-- company's receivables.
create or replace function public.accept_invite(p_token text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := (select auth.uid());
  caller_email text;
  invite public.organization_invites;
begin
  if caller is null then
    raise exception 'not authenticated';
  end if;

  select email into caller_email from auth.users where id = caller;

  select * into invite
    from public.organization_invites
   where token_hash = encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex')
   limit 1;

  if invite.id is null then
    raise exception 'invitation not found';
  end if;

  if invite.accepted_at is not null then
    raise exception 'invitation already used';
  end if;

  if invite.expires_at < now() then
    raise exception 'invitation expired';
  end if;

  if lower(invite.email) <> lower(coalesce(caller_email, '')) then
    raise exception 'invitation is for a different email address';
  end if;

  insert into public.organization_members (organization_id, member_id, member_email, role, invited_by)
  values (invite.organization_id, caller, caller_email, invite.role, invite.invited_by)
  on conflict (organization_id, member_id) do nothing;

  update public.organization_invites
     set accepted_at = now(), accepted_by = caller
   where id = invite.id;

  return invite.organization_id;
end;
$$;

create or replace function public.set_member_role(p_member uuid, p_role text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  org uuid := public.current_org_id();
  caller uuid := (select auth.uid());
begin
  if org is null or not exists (
    select 1 from public.organization_members
     where organization_id = org and member_id = caller and role = 'owner'
  ) then
    raise exception 'only an owner may change roles';
  end if;

  if p_role not in ('owner', 'member', 'viewer') then
    raise exception 'unknown role';
  end if;

  update public.organization_members
     set role = p_role
   where organization_id = org and member_id = p_member;

  -- Checked after the fact rather than before: an owner demoting themselves
  -- while another owner exists is fine, and the only thing that must never
  -- happen is a company nobody can administer.
  if not exists (
    select 1 from public.organization_members
     where organization_id = org and role = 'owner'
  ) then
    raise exception 'a company must keep at least one owner';
  end if;
end;
$$;

create or replace function public.remove_member(p_member uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  org uuid := public.current_org_id();
  caller uuid := (select auth.uid());
begin
  if org is null then
    raise exception 'no active company';
  end if;

  -- An owner removes anyone; anyone else may only remove themselves, which is
  -- how someone leaves a company they no longer work with.
  if p_member <> caller and not exists (
    select 1 from public.organization_members
     where organization_id = org and member_id = caller and role = 'owner'
  ) then
    raise exception 'only an owner may remove a member';
  end if;

  delete from public.organization_members
   where organization_id = org and member_id = p_member;

  if not exists (
    select 1 from public.organization_members
     where organization_id = org and role = 'owner'
  ) then
    raise exception 'a company must keep at least one owner';
  end if;
end;
$$;

revoke all on function public.create_organization(text, text)       from public;
revoke all on function public.my_organizations()                    from public;
revoke all on function public.my_organizations_summary(date)        from public;
revoke all on function public.delete_organization(uuid)             from public;
revoke all on function public.invite_member(text, text)             from public;
revoke all on function public.revoke_invite(uuid)                   from public;
revoke all on function public.accept_invite(text)                   from public;
revoke all on function public.set_member_role(uuid, text)           from public;
revoke all on function public.remove_member(uuid)                   from public;

grant execute on function public.create_organization(text, text)    to authenticated, service_role;
grant execute on function public.my_organizations()                 to authenticated, service_role;
grant execute on function public.my_organizations_summary(date)     to authenticated, service_role;
grant execute on function public.delete_organization(uuid)          to authenticated, service_role;
grant execute on function public.invite_member(text, text)          to authenticated, service_role;
grant execute on function public.revoke_invite(uuid)                to authenticated, service_role;
grant execute on function public.accept_invite(text)                to authenticated, service_role;
grant execute on function public.set_member_role(uuid, text)        to authenticated, service_role;
grant execute on function public.remove_member(uuid)                to authenticated, service_role;
