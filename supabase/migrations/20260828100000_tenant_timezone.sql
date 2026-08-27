-- lefta.app — where the tenant is
--
-- Every date in this product has been Athens, because that is where it was
-- built to sell. Sensible as a default, wrong as an assumption: an invoice
-- raised in Warsaw falls due on a Warsaw day, and a reminder set for nine in
-- the morning ought to leave at nine where the person who set it lives — not an
-- hour early half the year because two countries keep different summer time.
--
-- Not validated by a check constraint. Postgres knows the zone names in
-- pg_timezone_names, but that view is not immutable and cannot be read from a
-- CHECK; the application validates against the runtime's own list before
-- writing, and a value it cannot use falls back to the default rather than
-- throwing. A wrong timezone should make dates look odd, never take a page down.

alter table public.users
  add column if not exists timezone text not null default 'Europe/Athens';

comment on column public.users.timezone is
  'IANA name. Decides which calendar day an invoice is late on and which local '
  'hour the sweep sends at. Validated by the application, not by a constraint: '
  'pg_timezone_names cannot be read from a CHECK.';

-- ---------------------------------------------------------------------------
-- grants
-- ---------------------------------------------------------------------------
-- `users` is granted column by column, so a new column is unreadable and
-- unwritable until it is named here. This is not a formality: one column left
-- out of the SELECT grant once failed every query that listed it, and because
-- the handler for a failed profile read is a redirect, it looked exactly like
-- being signed out. Settings is where this column is edited, so it needs both.

grant select (timezone), update (timezone) on public.users to authenticated;
