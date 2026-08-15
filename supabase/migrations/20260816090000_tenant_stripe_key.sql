-- lefta.app — a tenant may bring their own Stripe key.
--
-- Connect is the right long-term answer and is already built, but it needs a
-- platform Stripe account, and lefta does not have one yet: the company that
-- will own it is not incorporated. Until it is, a tenant can paste their own
-- secret key and charges are created directly on their account with it.
--
-- The outcome is the same one Connect gives — the debtor pays the creditor and
-- nothing settles to lefta — reached without a platform in the middle. The key
-- lives on the tenant row rather than in an environment variable precisely so
-- that one tenant's invoices can never be charged onto another's account, which
-- is exactly what a single shared platform key would do the moment a second
-- tenant existed.
--
-- When Connect is available, `stripe_account_id` takes precedence and this
-- becomes dead weight that can be dropped.

alter table public.users
  add column stripe_secret_key_enc text;

comment on column public.users.stripe_secret_key_enc is
  'The tenant''s own Stripe secret key, AES-256-GCM. Used only until Connect is available; stripe_account_id wins when both are present. Never returned to clients.';

-- Deliberately not granted to `authenticated`: like the myDATA and Elorus keys,
-- the ciphertext must never be readable from a browser session. The settings
-- screen shows only whether one is stored.

-- ---------------------------------------------------------------------------
-- the public payment page has to know about the second arrangement
-- ---------------------------------------------------------------------------
-- Otherwise a tenant paying through their own key would see the page refuse to
-- offer a button, because it only ever asked about the connected account.

create or replace function public.get_invoice_for_payment(p_token text)
returns table (
  invoice_id       uuid,
  invoice_number   text,
  amount_cents     bigint,
  currency         text,
  issue_date       date,
  due_date         date,
  status           invoice_status,
  debtor_name      text,
  creditor_name    text,
  payments_enabled boolean
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
    coalesce(u.company_name, u.email),
    -- Still exposing only whether a card can be taken, never which arrangement
    -- makes that true or who the account belongs to.
    ((u.stripe_account_id is not null and u.stripe_charges_enabled)
      or u.stripe_secret_key_enc is not null)
  from public.invoices i
  join public.debtors d on d.id = i.debtor_id
  join public.users   u on u.id = i.user_id
  where i.pay_token = p_token
  limit 1;
$$;

revoke all on function public.get_invoice_for_payment(text) from public;
grant execute on function public.get_invoice_for_payment(text) to anon, authenticated, service_role;
