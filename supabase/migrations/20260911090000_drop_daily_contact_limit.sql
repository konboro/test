-- lefta.app — a customer may be contacted more than once a day
--
-- `dunning_contacts_one_per_debtor_per_day` made the rule absolute: the row that
-- recorded a contact was also the permission to make one, and a second insert
-- for the same debtor on the same date came back as a unique violation. Both the
-- sweep and the manual button read that violation as a refusal.
--
-- Removed at the operator's decision. The application no longer asks the
-- question, so leaving the index would not enforce a policy — it would simply
-- fail the second send of the day with a database error the code no longer has
-- a branch for.
--
-- `dunning_contacts` keeps its other purpose untouched: it is still the history
-- the log and the ladder read, and it is still written before delivery.
drop index if exists public.dunning_contacts_one_per_debtor_per_day;

-- A plain index in its place. The uniqueness is gone; the lookups are not —
-- `(debtor_id, contact_on)` is how a debtor's contact history is read, and
-- dropping the index outright would turn those into sequential scans.
create index if not exists dunning_contacts_debtor_day_idx
  on public.dunning_contacts (debtor_id, contact_on desc);

-- Deliberately kept: a given step still fires at most once per invoice, so a
-- missed cron run is caught up rather than replayed. That is not a limit on how
-- often a customer may be written to — it is what stops the same rung of the
-- ladder being sent twice for the same document.
--   dunning_contacts_invoice_step_uniq (invoice_id, step)

comment on index public.dunning_contacts_debtor_day_idx is
  'Contact history per debtor per day. Not unique: the one-a-day rule was removed on 2026-09-11.';
