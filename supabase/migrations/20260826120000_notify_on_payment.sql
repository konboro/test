-- Whether the creditor is emailed when one of their invoices is paid.
--
-- The notice already exists (src/lib/payments/notify.ts) and goes to the account
-- holder plus the reply-to address. What was missing is the ability to stop it:
-- a tenant collecting thirty payments a day does not want thirty emails, and a
-- tenant collecting three does.
--
-- Default true, so nobody who is being told today stops being told.

alter table public.users
  add column notify_on_payment boolean not null default true;

comment on column public.users.notify_on_payment is
  'When false, no email is sent to the creditor on settlement. Does not affect anything sent to debtors.';

-- Both grants, deliberately. UPDATE on this table was revoked wholesale and
-- handed back one column at a time, and a column with UPDATE but no SELECT is
-- writable and unreadable — which is exactly how `business_mode` logged every
-- user out of Settings one migration ago. A settings form has to read the value
-- before it can offer it.
grant select (notify_on_payment) on public.users to authenticated;
grant update (notify_on_payment) on public.users to authenticated;
