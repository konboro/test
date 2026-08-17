-- lefta.app — a tenant may collect through Viva.com instead of Stripe.
--
-- Same arrangement as the tenant-owned Stripe key, and for the same reason: the
-- debtor pays the creditor directly and nothing settles to lefta. Viva has no
-- equivalent of Connect available to us — their platform model requires being a
-- registered ISV partner, which needs a company lefta does not yet have — so the
-- creditor's own Smart Checkout credentials are the whole mechanism.
--
-- For a Greek merchant this is often the better of the two: Viva is domestic,
-- settles in EUR, and its checkout is recognised by the people being asked to
-- pay. Stripe stays the default where it is already working.

alter table public.users
  add column viva_client_id_enc     text,
  add column viva_client_secret_enc text,
  add column viva_source_code       text,
  add column viva_environment       text not null default 'demo'
    check (viva_environment in ('demo', 'production'));

comment on column public.users.viva_client_id_enc is
  'Viva Smart Checkout client id, AES-256-GCM. Not a secret on its own, but stored beside the secret so one code path handles both. Never returned to clients.';
comment on column public.users.viva_client_secret_enc is
  'Viva Smart Checkout client secret, AES-256-GCM. Never returned to clients.';
comment on column public.users.viva_source_code is
  'Payment source the order is booked against. Null uses the account default, which is what a fresh account has.';
comment on column public.users.viva_environment is
  'Which Viva estate the credentials belong to. Demo credentials are rejected by production and vice versa, so this is not cosmetic — it selects the host.';

-- ---------------------------------------------------------------------------
-- which provider the payment button uses
-- ---------------------------------------------------------------------------
-- Null means "whichever is configured". Only meaningful once a tenant has set
-- up both, which is the only case where a preference is needed at all — and a
-- nullable column keeps every existing tenant on exactly the behaviour they
-- have today without a backfill.
--
-- Deliberately not `not null default 'stripe'`: that would strand a tenant who
-- configures only Viva behind a preference they never expressed, and the button
-- would refuse to appear for a provider that is sitting right there working.

alter table public.users
  add column payment_provider text
    check (payment_provider in ('stripe', 'viva'));

comment on column public.users.payment_provider is
  'Preferred provider when both are configured. Null resolves to whichever is set up, Stripe first.';

-- Non-secret state the settings screen shows. The two `_enc` columns are
-- deliberately absent, exactly as the Stripe, myDATA and Elorus credentials are:
-- whether one is stored is answered server-side, the ciphertext never travels.
grant select (viva_source_code, viva_environment, payment_provider)
  on public.users to authenticated;

-- ---------------------------------------------------------------------------
-- the public payment page has to know about the third arrangement
-- ---------------------------------------------------------------------------
-- Same reasoning as 20260816090000: a creditor collecting through Viva would
-- otherwise see the page refuse to offer a button, because it only ever asked
-- about Stripe.

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
    -- Still only whether a card can be taken — never which arrangement makes
    -- that true, nor whose account it is. The debtor learns the provider when
    -- the redirect lands them on it, and not one step earlier.
    ((u.stripe_account_id is not null and u.stripe_charges_enabled)
      or u.stripe_secret_key_enc is not null
      or (u.viva_client_id_enc is not null and u.viva_client_secret_enc is not null))
  from public.invoices i
  join public.debtors d on d.id = i.debtor_id
  join public.users   u on u.id = i.user_id
  -- Either credential, as established in 20260816110000.
  where i.short_code = p_token or i.pay_token = p_token
  limit 1;
$$;

revoke all on function public.get_invoice_for_payment(text) from public;
grant execute on function public.get_invoice_for_payment(text) to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- where a Viva payment is recorded
-- ---------------------------------------------------------------------------
-- The Stripe columns cannot be reused: `stripe_payment_intent_id` on a row paid
-- through Viva would be a lie that survives into every later reconciliation.

alter table public.invoices
  add column viva_order_code    text,
  add column viva_transaction_id text;

comment on column public.invoices.viva_transaction_id is
  'Viva transaction that settled this invoice. Set only after the transaction has been read back from Viva, never from a redirect parameter.';

create index if not exists invoices_viva_order_code_idx
  on public.invoices (viva_order_code)
  where viva_order_code is not null;
