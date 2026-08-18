-- lefta.app — bringing a book of debts in from outside.
--
-- Every source so far has been an integration: myDATA, Elorus, and the invoices
-- a tenant types in by hand. That leaves out everyone whose debts do not live in
-- an invoicing system at all — a sharing operator whose customers owe money from
-- failed card charges, a business whose receivables sit in a spreadsheet. They
-- are not edge cases; they are most of the market.
--
-- The shape fits without stretching. An unpaid balance is an amount owed by a
-- named party with a date, which is what the ladder already works on. What it
-- needs is a way in, and a way to be imported twice without doubling.

alter table public.invoices
  drop constraint invoices_source_check;

alter table public.invoices
  add constraint invoices_source_check
  check (source in ('mydata', 'manual', 'elorus', 'import'));

-- ---------------------------------------------------------------------------
-- idempotency
-- ---------------------------------------------------------------------------
-- The same file will be uploaded twice — corrected, re-exported, or simply out
-- of doubt about whether the first one worked. Without a key that survives
-- between uploads, the second one silently doubles the book and every debtor is
-- chased for twice what they owe.
--
-- The reference comes from the source system: a charge id, a ride id, a row
-- number the operator controls. Unique per tenant rather than globally, because
-- two businesses will both have an "INV-001".

alter table public.invoices
  add column external_ref text;

create unique index invoices_user_external_ref_uniq
  on public.invoices (user_id, external_ref)
  where external_ref is not null;

comment on column public.invoices.external_ref is
  'Identifier from whatever system the debt came from. The key that makes re-importing the same file a no-op rather than a duplicate.';

-- The same question for the customer: a second file must update the person, not
-- create a twin. VAT number already does this when present, but a sharing
-- operator has no VAT number for a private rider — the account id is what
-- identifies them.
alter table public.debtors
  add column external_ref text;

create unique index debtors_user_external_ref_uniq
  on public.debtors (user_id, external_ref)
  where external_ref is not null;

comment on column public.debtors.external_ref is
  'The customer''s id in the system they came from. Identifies a private individual, who has no VAT number to match on.';

-- Written by the import path under the service role, like every other sync.
-- Readable by the tenant so the panel can show where a row came from.
grant select (external_ref) on public.invoices to authenticated;
grant select (external_ref) on public.debtors to authenticated;
