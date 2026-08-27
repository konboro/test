-- lefta.app — recording that the customer was told the invoice exists
--
-- The notice sent when an invoice is raised is not a chase, and this column is
-- what keeps that true.
--
-- It could have been a `dunning_contacts` row like every rung, and that would
-- have been wrong twice over. That table enforces one contact per debtor per
-- calendar day, so raising a second invoice for the same customer would have
-- silently notified them about only one of the two — and raising any invoice
-- would have spent the day's contact, silencing a genuine overdue reminder for
-- a different document. Transactional mail about a document somebody is being
-- sent should not compete with collections for the same budget.
--
-- What is still needed is exactly-once. A timestamp claimed with a conditional
-- update gives that without a second table: the update only matches while the
-- column is null, so two requests racing to send produce one winner and one
-- no-op, and the row that lost never sends.

alter table public.invoices
  add column if not exists issue_notice_sent_at timestamptz;

comment on column public.invoices.issue_notice_sent_at is
  'When the customer was told this invoice exists. Claimed before sending, so it '
  'also serves as the exactly-once lock. Null means the notice is still owed — '
  'the sweep picks those up if the send at confirmation time did not happen.';

-- The sweep looks for invoices still owed a notice. Partial, because the rows
-- that already have one are the overwhelming majority and are never scanned.
create index if not exists invoices_issue_notice_pending_idx
  on public.invoices (user_id, created_at)
  where issue_notice_sent_at is null and status = 'pending';
