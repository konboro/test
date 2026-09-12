-- lefta.app — a debt can only point at a customer of the same company
--
-- Nothing enforced this. `invoices.debtor_id` was a plain reference to
-- `debtors (id)`, the RLS `with check` clauses constrain only `user_id`, and
-- `debtor_id` sits in the `authenticated` update grant. So a member of company A
-- could repoint one of their own invoices at company B's customer with a single
-- PostgREST call: the policy sees their own `user_id` and passes, and the
-- foreign key only asks whether the row exists — foreign keys are checked as the
-- table owner and do not apply row-level security.
--
-- What that buys an attacker is not academic. The reminder preview reads the
-- debtor by bare id under the service role, so it hands back the other company's
-- customer name, email and phone; pressing send messages that person under the
-- attacker's company name; and the nightly sweep then writes the whole rendered
-- message into a log the attacker can read. It also burns the victim's daily
-- contact slot, because that uniqueness is on `(debtor_id, contact_on)` and is
-- global rather than per company.
--
-- Application checks were the wrong place for this. Exactly one call site had
-- one. The invariant is structural, so it belongs in the schema, where every
-- path gets it for free — including the ones nobody has written yet.
--
-- If this migration fails to apply, it has found real cross-company rows, which
-- is a far more urgent finding than the constraint. Do not force it: read the
-- offending rows first.
--   select i.id, i.user_id, d.user_id
--     from public.invoices i join public.debtors d on d.id = i.debtor_id
--    where i.user_id <> d.user_id;

-- The target a composite foreign key needs. `id` is already the primary key, so
-- this adds no meaningful storage cost and no new uniqueness rule — it only
-- makes the pair addressable.
alter table public.debtors
  add constraint debtors_id_user_uniq unique (id, user_id);

alter table public.invoices
  drop constraint invoices_debtor_id_fkey;

alter table public.invoices
  add constraint invoices_debtor_id_fkey
  foreign key (debtor_id, user_id) references public.debtors (id, user_id);

alter table public.leases
  drop constraint leases_debtor_id_fkey;

alter table public.leases
  add constraint leases_debtor_id_fkey
  foreign key (debtor_id, user_id) references public.debtors (id, user_id)
  on delete cascade;

comment on constraint invoices_debtor_id_fkey on public.invoices is
  'The debtor must belong to the same company as the invoice. Enforced here rather than in the application because every send path reads the debtor by id and trusts it.';

-- Belt as well as braces: nothing in the product changes an invoice's customer
-- after it is created, so a session has no reason to be able to. Revoking the
-- column removes the door as well as locking it.
--
-- Column grants cannot be revoked selectively from a list, so the grant is
-- restated without `debtor_id`. It mirrors 20260815120100_rls.sql, minus that
-- one column.
revoke update on public.invoices from authenticated;

grant update (
  invoice_number, series, amount_cents, currency,
  issue_date, due_date, status, automation_enabled
) on public.invoices to authenticated;
