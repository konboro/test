-- lefta.app — short payment links
--
-- The reminder link travels by SMS, where `/pay/<48 hex chars>` costs a third of
-- the 160-character segment and pushes many messages into a second one. Invoices
-- get a short second credential so the link can be `lefta.app/<code>`.
--
-- `pay_token` is deliberately left alone: reminders already sitting in a
-- debtor's inbox point at `/pay/<token>` and must keep working forever.

-- ---------------------------------------------------------------------------
-- code generator
-- ---------------------------------------------------------------------------
-- Alphabet mirrors src/lib/pay-code.ts: uppercase + digits, without the glyphs
-- that get misread on a printed page (0/O, 1/I). No lowercase, which is what
-- keeps a code from ever colliding with an application route at the domain root.

create or replace function public.gen_pay_code()
returns text
language plpgsql
volatile
as $$
declare
  alphabet constant text := '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  bytes    bytea := gen_random_bytes(10);
  code     text := '';
  i        int;
begin
  -- 256 is a whole multiple of 32, so the modulo leaves every symbol equally
  -- likely — there is no bias to correct for.
  for i in 0..9 loop
    code := code || substr(alphabet, (get_byte(bytes, i) % 32) + 1, 1);
  end loop;

  return code;
end;
$$;

revoke all on function public.gen_pay_code() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- invoices.short_code
-- ---------------------------------------------------------------------------

alter table public.invoices add column short_code text;

-- Unique before the backfill, so a collision fails the migration loudly instead
-- of quietly pointing two invoices at one link. Postgres allows many nulls in a
-- unique index, so the column can stay empty until the update below.
create unique index invoices_short_code_uniq on public.invoices (short_code);

update public.invoices set short_code = public.gen_pay_code() where short_code is null;

alter table public.invoices
  alter column short_code set not null,
  alter column short_code set default public.gen_pay_code();

-- No grant for `short_code`: the table-level UPDATE was revoked in
-- 20260815120100_rls.sql and only the listed columns were re-granted, so a
-- browser session cannot forge a payment link by writing this column either.

-- ---------------------------------------------------------------------------
-- public payment page lookup
-- ---------------------------------------------------------------------------
-- Accepts either credential. Both columns are unique, so at most one invoice
-- matches and old `/pay/<token>` links keep resolving.

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
  where i.short_code = p_token or i.pay_token = p_token
  limit 1;
$$;

revoke all on function public.get_invoice_for_payment(text) from public;
grant execute on function public.get_invoice_for_payment(text) to anon, authenticated, service_role;
