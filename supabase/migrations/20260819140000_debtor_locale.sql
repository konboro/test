-- The language a customer is written to in.
--
-- Null means "work it out", and that is the default for every existing row: the
-- country code on the phone number decides, so a book imported months ago
-- starts behaving correctly without anyone editing 144 customers by hand. The
-- column exists for the cases the phone number cannot answer — a Greek company
-- whose accounts payable desk reads English, a foreign number belonging to
-- someone who prefers Greek.
--
-- Deliberately not `not null default 'el'`. A stored 'el' on every row would be
-- indistinguishable from a deliberate choice, and the first debtor with a German
-- number would silently keep getting Greek forever.

alter table public.debtors
  add column locale text;

alter table public.debtors
  add constraint debtors_locale_check
  check (locale is null or locale in ('el', 'en'));

comment on column public.debtors.locale is
  'Language for reminders sent to this customer. Null means derive it from the phone number''s country code, falling back to Greek.';

-- Belt and braces. Unlike `invoices`, this table's grants are table-wide, so a
-- new column is already writable by `authenticated` and this changes nothing
-- today. It is here so that narrowing the grants later — as invoices already
-- did — cannot silently take the language selector with it.
grant update (locale) on public.debtors to authenticated;
