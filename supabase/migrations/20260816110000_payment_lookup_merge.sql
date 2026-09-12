-- lefta.app — one definitive payment lookup.
--
-- Two lines of work redefined `get_invoice_for_payment` independently: short
-- payment codes taught it a second credential, and the tenant-owned Stripe key
-- taught it a second way for a creditor to be able to take a card. Their
-- migration timestamps interleave, so on a database that has already applied
-- one, replaying the other silently undoes it — the button disappears, or old
-- links stop resolving, depending which lost.
--
-- This migration exists so neither outcome is possible: it runs after both and
-- states the whole answer, so the final definition does not depend on the order
-- the earlier two happened to arrive in.

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
      or u.stripe_secret_key_enc is not null)
  from public.invoices i
  join public.debtors d on d.id = i.debtor_id
  join public.users   u on u.id = i.user_id
  -- Either credential. Both columns are unique, so at most one invoice matches
  -- and reminders already sitting in an inbox keep resolving.
  where i.short_code = p_token or i.pay_token = p_token
  limit 1;
$$;

revoke all on function public.get_invoice_for_payment(text) from public;
grant execute on function public.get_invoice_for_payment(text) to anon, authenticated, service_role;
