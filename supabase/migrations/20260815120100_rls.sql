-- lefta.app — row level security
--
-- Model: every table is tenant-scoped by users.id == auth.uid(). Browser clients
-- use the anon key and are constrained entirely by these policies. Privileged
-- work (myDATA sync, the dunning engine, Stripe webhooks) runs server-side with
-- the service role, which bypasses RLS by design.

alter table public.users                enable row level security;
alter table public.debtors              enable row level security;
alter table public.invoices             enable row level security;
alter table public.dunning_contacts     enable row level security;
alter table public.communications_log   enable row level security;
alter table public.sms_credit_purchases enable row level security;

-- ---------------------------------------------------------------------------
-- users
-- ---------------------------------------------------------------------------

create policy users_select_own on public.users
  for select to authenticated
  using (id = (select auth.uid()));

-- A tenant may edit its own profile. Credential and balance columns are not
-- writable from the browser — see the column grants below.
create policy users_update_own on public.users
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- Column-level hardening. Even though the myDATA subscription key is stored as
-- ciphertext, it must never leave the server, and SMS credits / Stripe ids must
-- only ever be moved by trusted server code.
revoke all on public.users from anon, authenticated;

grant select (
  id, email, company_name, vat_number, phone,
  mydata_user_id, mydata_environment, mydata_last_sync_at,
  stripe_customer_id, sms_credits, automation_enabled, reply_to_email,
  default_payment_terms_days, created_at, updated_at
) on public.users to authenticated;

grant update (
  company_name, vat_number, phone, automation_enabled, reply_to_email,
  default_payment_terms_days
) on public.users to authenticated;

-- ---------------------------------------------------------------------------
-- debtors — full CRUD within the tenant
-- ---------------------------------------------------------------------------

create policy debtors_select_own on public.debtors
  for select to authenticated
  using (user_id = (select auth.uid()));

create policy debtors_insert_own on public.debtors
  for insert to authenticated
  with check (user_id = (select auth.uid()));

create policy debtors_update_own on public.debtors
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy debtors_delete_own on public.debtors
  for delete to authenticated
  using (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- invoices
-- ---------------------------------------------------------------------------

create policy invoices_select_own on public.invoices
  for select to authenticated
  using (user_id = (select auth.uid()));

create policy invoices_insert_own on public.invoices
  for insert to authenticated
  with check (user_id = (select auth.uid()));

create policy invoices_update_own on public.invoices
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy invoices_delete_own on public.invoices
  for delete to authenticated
  using (user_id = (select auth.uid()));

-- Never let a browser session forge the payment token or the settlement fields;
-- those are written by the Stripe webhook under the service role.
--
-- This must revoke UPDATE at *table* level before granting the allowed columns.
-- Supabase's default privileges hand `authenticated` a table-wide UPDATE, and a
-- column-level REVOKE against a table-level grant is silently a no-op — the
-- table grant keeps covering every column.
revoke update on public.invoices from anon, authenticated;

grant update (
  debtor_id, invoice_number, series, amount_cents, currency,
  issue_date, due_date, status
) on public.invoices to authenticated;

-- ---------------------------------------------------------------------------
-- dunning_contacts — readable history, claimed only by the engine
-- ---------------------------------------------------------------------------

create policy dunning_contacts_select_own on public.dunning_contacts
  for select to authenticated
  using (user_id = (select auth.uid()));

revoke insert, update, delete on public.dunning_contacts from anon, authenticated;

-- ---------------------------------------------------------------------------
-- communications_log — readable audit trail, writable only by the server
-- ---------------------------------------------------------------------------

create policy comms_select_own on public.communications_log
  for select to authenticated
  using (user_id = (select auth.uid()));

revoke insert, update, delete on public.communications_log from anon, authenticated;

-- ---------------------------------------------------------------------------
-- sms_credit_purchases — readable receipts, written by the Stripe webhook
-- ---------------------------------------------------------------------------

create policy sms_purchases_select_own on public.sms_credit_purchases
  for select to authenticated
  using (user_id = (select auth.uid()));

revoke insert, update, delete on public.sms_credit_purchases from anon, authenticated;

-- ---------------------------------------------------------------------------
-- public payment page lookup
-- ---------------------------------------------------------------------------
-- The debtor is an anonymous visitor holding only an opaque pay_token. Rather
-- than opening the invoices table to `anon`, expose exactly the fields the
-- payment page needs through a security-definer function.

create or replace function public.get_invoice_for_payment(p_token text)
returns table (
  invoice_id     uuid,
  invoice_number text,
  amount_cents   bigint,
  currency       text,
  issue_date     date,
  due_date       date,
  status         invoice_status,
  debtor_name    text,
  creditor_name  text
)
language sql
security definer
set search_path = public
stable
as $$
  select
    i.id,
    coalesce(nullif(concat_ws(' ', i.series, i.invoice_number), ''), i.mark),
    i.amount_cents,
    i.currency,
    i.issue_date,
    i.due_date,
    i.status,
    d.name,
    coalesce(u.company_name, u.email)
  from public.invoices i
  join public.debtors d on d.id = i.debtor_id
  join public.users   u on u.id = i.user_id
  where i.pay_token = p_token
  limit 1;
$$;

revoke all on function public.get_invoice_for_payment(text) from public;
grant execute on function public.get_invoice_for_payment(text) to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- SMS credit accounting
-- ---------------------------------------------------------------------------
-- Atomic decrement. Returns false (without changing anything) when the tenant
-- is out of credits, so the caller can fall back to email only.

create or replace function public.consume_sms_credit(p_user_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  updated integer;
begin
  update public.users
     set sms_credits = sms_credits - 1
   where id = p_user_id
     and sms_credits > 0;

  get diagnostics updated = row_count;
  return updated > 0;
end;
$$;

-- Server-side only: the dunning engine reserves credits, browsers never do.
revoke all on function public.consume_sms_credit(uuid) from public, anon, authenticated;
grant execute on function public.consume_sms_credit(uuid) to service_role;

create or replace function public.grant_sms_credits(
  p_user_id uuid,
  p_credits integer,
  p_amount_cents bigint,
  p_session_id text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Idempotent: a replayed Stripe webhook hits the unique index and grants
  -- nothing a second time.
  insert into public.sms_credit_purchases (user_id, credits, amount_cents, stripe_checkout_session_id)
  values (p_user_id, p_credits, p_amount_cents, p_session_id)
  on conflict (stripe_checkout_session_id) do nothing;

  if not found then
    return false;
  end if;

  update public.users
     set sms_credits = sms_credits + p_credits
   where id = p_user_id;

  return true;
end;
$$;

-- Server-side only: granted by the Stripe webhook after a settled payment.
revoke all on function public.grant_sms_credits(uuid, integer, bigint, text) from public, anon, authenticated;
grant execute on function public.grant_sms_credits(uuid, integer, bigint, text) to service_role;
