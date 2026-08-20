-- lefta.app — why the reminders are paused, next to the date they resume
--
-- A pause without a reason ages badly. Two weeks later the screen says "until
-- 04/09" and nobody remembers whether the customer promised a transfer, asked
-- for an instalment plan, or is disputing the invoice — and the operator who
-- picks it up is often not the one who made the promise.
--
-- Kept on the debtor beside the date rather than in `notes`: the free-text
-- notes field outlives the pause, while this sentence is only true while the
-- pause is running and is cleared with it.

alter table public.debtors
  add column snooze_note text;

comment on column public.debtors.snooze_note is
  'Why reminders are paused, shown wherever the pause is. Cleared when the pause is lifted; length is bounded in the application.';

grant update (snooze_note) on public.debtors to authenticated;
