-- lefta.app — hold the reminders until a date
--
-- The missing primitive of collections: a customer answers "I'll pay on the
-- 15th". Today the operator has two bad options — mute them, which is
-- indefinite and easily forgotten, or let the ladder keep chasing someone who
-- has just made a commitment. Neither is what happened, and the second is the
-- fastest way to lose a customer relationship the creditor still wants.
--
-- A snooze is a mute with an end date. It expires by itself: nothing has to
-- run, because every read compares the date to today.
--
-- Deliberately on the debtor, not the invoice:
--   * a promise covers the person, not one document — chasing them about a
--     different invoice the next morning breaks the same promise;
--   * the contact limit is already per debtor per day, so the debtor is the
--     unit the product speaks in;
--   * per-invoice pausing already exists (`invoices.automation_enabled`), and
--     it answers a different question — "leave this document alone", not
--     "leave this person alone until Tuesday".

alter table public.debtors
  add column snoozed_until date;

comment on column public.debtors.snoozed_until is
  'No reminders — automatic or manual — until this date has passed. Null means not snoozed. Expires on its own; nothing clears it.';

-- Drives the sweep's skip test, which runs over every pending invoice.
create index debtors_snoozed_until_idx on public.debtors (snoozed_until)
  where snoozed_until is not null;

-- The tenant sets it from their own screens. `debtors` is theirs to edit under
-- RLS, and later migrations grant new columns explicitly, so this one says so
-- too rather than relying on a table-wide grant that may not exist.
grant update (snoozed_until) on public.debtors to authenticated;
