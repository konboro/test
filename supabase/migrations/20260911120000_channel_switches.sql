-- lefta.app — a tenant can switch a whole channel off
--
-- Until now the only way to stop sending SMS was to edit every step of the
-- scenario and take 'sms' out of each one, which is a per-step answer to a
-- question about the account. A tenant who does not want text messages at all
-- wants one switch, and wants it to hold for the rungs they have not thought
-- about yet.
--
-- Default true, so nothing changes for anyone until they touch it: this is a
-- new way to say no, not a new thing to have to say yes to.

alter table public.users
  add column if not exists email_enabled boolean not null default true,
  add column if not exists sms_enabled   boolean not null default true;

comment on column public.users.email_enabled is
  'When false, no email is sent to a debtor on any path — sweep, issue notice or manual. Does not affect mail to the creditor.';

comment on column public.users.sms_enabled is
  'When false, no SMS is sent to a debtor on any path.';

-- Both grants, deliberately. UPDATE on this table was revoked wholesale and
-- handed back one column at a time, and a column with UPDATE but no SELECT is
-- writable and unreadable — which is exactly how `business_mode` logged every
-- user out of Settings one migration ago. A settings form has to read the value
-- before it can offer it.
grant select (email_enabled) on public.users to authenticated;
grant update (email_enabled) on public.users to authenticated;
grant select (sms_enabled) on public.users to authenticated;
grant update (sms_enabled) on public.users to authenticated;
