-- lefta.app — a tenant may collect through Revolut as well
--
-- Third arrangement, same shape as the second: the creditor's own credentials,
-- the money on the creditor's own account, lefta never in the flow. Revolut is
-- worth adding for two reasons beyond choice — the acquiring price is lower
-- than Stripe's for EEA cards, and a large share of Greek debtors already hold
-- the app, which turns the payment page from "type a card" into two taps.
--
-- Where it differs from Viva, in our favour: Revolut takes a `redirect_url`
-- per order, so the return trip carries our own payment credential instead of
-- depending on a static URL the merchant configures by hand.

alter table public.users
  add column revolut_secret_key_enc text,
  add column revolut_environment    text not null default 'sandbox'
    check (revolut_environment in ('sandbox', 'production'));

comment on column public.users.revolut_secret_key_enc is
  'Revolut Merchant API secret key, AES-256-GCM. Never returned to clients.';
comment on column public.users.revolut_environment is
  'Which Revolut estate the key belongs to. Sandbox keys are rejected by the production host and vice versa, so this selects the host rather than describing it.';

-- Non-secret state the settings screen shows. The key column is deliberately
-- absent from the grant, exactly like the Stripe, Viva, myDATA and Elorus ones.
grant select (revolut_environment) on public.users to authenticated;

-- The provider preference gains a third value.
alter table public.users drop constraint if exists users_payment_provider_check;
alter table public.users
  add constraint users_payment_provider_check
  check (payment_provider in ('stripe', 'viva', 'revolut'));

-- ---------------------------------------------------------------------------
-- where a Revolut payment is recorded
-- ---------------------------------------------------------------------------
-- Its own column for the same reason Viva got one: a Revolut order id sitting
-- in `viva_transaction_id` would be a lie that survives into every later
-- reconciliation, and the settled column on the invoice list reads these
-- fields to say how the money arrived.

alter table public.invoices
  add column revolut_order_id text;

comment on column public.invoices.revolut_order_id is
  'Revolut order that settled this invoice. Written only after the order was read back from Revolut, never from a redirect parameter.';

-- ---------------------------------------------------------------------------
-- every order we mint
-- ---------------------------------------------------------------------------
-- Mirrors viva_orders, and for the same two reasons. A second press of Pay
-- must not orphan a first order that is still payable, and the amount recorded
-- at minting time is the amount Revolut will charge — the invoice row can
-- legitimately change while a checkout sits open (an Elorus correction, a
-- manual edit), and settling with the corrected figure would book money that
-- never arrived.

create table public.revolut_orders (
  order_id     text primary key,
  user_id      uuid not null references public.users (id) on delete cascade,
  invoice_id   uuid not null references public.invoices (id) on delete cascade,
  amount_cents bigint not null check (amount_cents > 0),
  created_at   timestamptz not null default now()
);

create index revolut_orders_invoice_idx on public.revolut_orders (invoice_id, created_at desc);

-- Server-side bookkeeping: written when a payment starts, read when the debtor
-- returns. No browser role has any business here.
alter table public.revolut_orders enable row level security;
revoke all on public.revolut_orders from anon, authenticated;

-- ---------------------------------------------------------------------------
-- the public payment page has to know about the third arrangement
-- ---------------------------------------------------------------------------
-- Otherwise a creditor collecting through Revolut would see the page refuse to
-- offer a button, because it only ever asked about Stripe and Viva.

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
    -- that true, nor whose account it is.
    ((u.stripe_account_id is not null and u.stripe_charges_enabled)
      or u.stripe_secret_key_enc is not null
      or (u.viva_client_id_enc is not null and u.viva_client_secret_enc is not null)
      or u.revolut_secret_key_enc is not null)
  from public.invoices i
  join public.debtors d on d.id = i.debtor_id
  join public.users   u on u.id = i.user_id
  where i.short_code = p_token or i.pay_token = p_token
  limit 1;
$$;

revoke all on function public.get_invoice_for_payment(text) from public;
grant execute on function public.get_invoice_for_payment(text) to anon, authenticated, service_role;
