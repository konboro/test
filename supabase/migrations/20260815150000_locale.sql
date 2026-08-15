-- lefta.app — portal language.
--
-- The interface was Greek-only. The product is sold in Greece, so Greek stays
-- the default, but the portal is now also available in English.
--
-- This is the *portal* language: what the tenant sees. It deliberately does not
-- change the reminders, which are addressed to the tenant's own customers and
-- whose wording is theirs to set in the template editor.

alter table public.users
  add column locale text not null default 'el' check (locale in ('el', 'en'));

comment on column public.users.locale is
  'Language of the admin interface for this tenant. Does not affect reminder copy.';

-- `users` had every privilege revoked and is re-granted column by column, so a
-- new column is unreadable until it is named here.
grant select (locale) on public.users to authenticated;
grant update (locale) on public.users to authenticated;
