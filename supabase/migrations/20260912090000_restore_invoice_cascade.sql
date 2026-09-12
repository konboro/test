-- lefta.app — deleting a customer works again
--
-- `20260829090000_debtor_same_org.sql` replaced the single-column foreign key on
-- `invoices.debtor_id` with a composite one, to make a debt point only at a
-- customer of the same company. That was right. But the original carried
-- `on delete cascade` (20260815120000_init.sql:101) and the replacement did not
-- restate it, so the constraint fell back to NO ACTION.
--
-- The asymmetry inside that one file is what shows it was an oversight rather
-- than a decision: twelve lines further down the identical rewrite on `leases`
-- does restate `on delete cascade`.
--
-- The effect is live. `deleteDebtor` issues a plain delete with no
-- foreign-key branch, and the customers screen loads every invoice specifically
-- so the delete confirmation can say how many there are — so the product counts
-- the rows out loud and then fails the press with a raw 23503.
--
-- Cascading is the behaviour the schema has always documented: the comment on
-- `communications_log.invoice_id` explains that messages deliberately survive an
-- invoice with `on delete set null`, which only makes sense as a contrast to the
-- documents themselves going with the customer.

alter table public.invoices
  drop constraint invoices_debtor_id_fkey;

alter table public.invoices
  add constraint invoices_debtor_id_fkey
  foreign key (debtor_id, user_id) references public.debtors (id, user_id)
  on delete cascade;

comment on constraint invoices_debtor_id_fkey on public.invoices is
  'The debtor must belong to the same company as the invoice, and deleting the customer takes their documents with them. Enforced here rather than in the application because every send path reads the debtor by id and trusts it.';
