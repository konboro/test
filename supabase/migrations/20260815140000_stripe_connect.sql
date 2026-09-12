-- lefta.app — each tenant collects on their own Stripe account.
--
-- Until now every invoice was charged on the platform's Stripe account, which
-- put lefta in the middle of the money: funds landed on our balance and were
-- owed onwards to the creditor. That is a payment intermediary, and it is
-- incompatible with operating as an IT provider that merely transmits
-- reminders.
--
-- With Stripe Connect the tenant links their own account and Checkout sessions
-- are created *on* it — a direct charge. The debtor pays the creditor. Nothing
-- settles to lefta, so there is nothing to hold, reconcile or pay out.
--
-- SMS credits stay on the platform account: that is lefta selling to the tenant,
-- which is our own revenue and not a payment on anyone's behalf.

alter table public.users
  add column stripe_account_id      text unique,
  add column stripe_charges_enabled boolean not null default false,
  add column stripe_connected_at    timestamptz;

comment on column public.users.stripe_account_id is
  'Connected Stripe account (acct_…). Invoices are charged directly on it; funds never touch the platform balance.';
comment on column public.users.stripe_charges_enabled is
  'Mirror of the connected account''s charges_enabled. False means Stripe has not finished onboarding them yet.';

-- Readable by the tenant so Settings can show the connection state. Not
-- writable: the link is established by the OAuth callback under the service
-- role, never by a browser session.
grant select (stripe_account_id, stripe_charges_enabled, stripe_connected_at)
  on public.users to authenticated;

-- ---------------------------------------------------------------------------
-- payment page lookup
-- ---------------------------------------------------------------------------
-- The public page has to know whether the creditor can actually take a card
-- before it offers a button. The return type changes, so the function has to be
-- dropped rather than replaced.

drop function if exists public.get_invoice_for_payment(text);

create function public.get_invoice_for_payment(p_token text)
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
    -- Deliberately not exposing the account id itself: the page needs to know
    -- whether a card can be taken, not who takes it.
    (u.stripe_account_id is not null and u.stripe_charges_enabled)
  from public.invoices i
  join public.debtors d on d.id = i.debtor_id
  join public.users   u on u.id = i.user_id
  where i.pay_token = p_token
  limit 1;
$$;

revoke all on function public.get_invoice_for_payment(text) from public;
grant execute on function public.get_invoice_for_payment(text) to anon, authenticated, service_role;
