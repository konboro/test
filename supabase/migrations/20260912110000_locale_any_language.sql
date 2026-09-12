-- The language columns stop listing the languages.
--
-- `users.locale` and `debtors.locale` each carried `check (locale in ('el',
-- 'en'))` — a second copy of the product's language list, kept in the one place
-- that cannot be updated by shipping code. Adding a language meant a dictionary,
-- a deploy, and then a migration nobody would think of until the first tenant
-- picked the new language and the save failed with a constraint violation, in
-- Greek, on the settings screen.
--
-- The application is the authority on which languages exist: `isLocale` guards
-- every read and every write, an unrecognised stored value falls back to Greek
-- rather than throwing, and `switchLocale` refuses anything not on the list
-- before it reaches the database. What is left for the column to do is keep
-- obvious junk out, so the check becomes a shape rather than a membership: a
-- two-letter language tag, optionally with a region or script. 'el', 'en',
-- 'bg', 'ro', 'pt-BR' all pass; free text does not.

do $$
declare
  c record;
begin
  -- Dropped by definition rather than by name. The users constraint was created
  -- inline with the column, so its name is whatever Postgres chose, and a
  -- `drop constraint if exists users_locale_check` that guessed wrong would
  -- succeed loudly and change nothing.
  for c in
    select conrelid::regclass as tbl, conname
    from pg_constraint
    where contype = 'c'
      and conrelid in ('public.users'::regclass, 'public.debtors'::regclass)
      and pg_get_constraintdef(oid) ilike '%locale%'
  loop
    execute format('alter table %s drop constraint %I', c.tbl, c.conname);
  end loop;
end
$$;

alter table public.users
  add constraint users_locale_shape
  check (locale ~ '^[a-z]{2}(-[A-Za-z0-9]{2,8}){0,2}$');

alter table public.debtors
  add constraint debtors_locale_shape
  check (locale is null or locale ~ '^[a-z]{2}(-[A-Za-z0-9]{2,8}){0,2}$');

comment on column public.users.locale is
  'Language of the admin interface for this tenant. Does not affect reminder copy. Which tags are offered is decided by the application, not by this column.';

comment on column public.debtors.locale is
  'Language for reminders sent to this customer. Null means derive it from the phone number''s country code, falling back to the tenant''s own language.';
