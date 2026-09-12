-- lefta.app — the payment page stops being a dead end
--
-- The page had one verb: pay. A debtor who already paid by transfer had no way
-- to say so; one who thinks the document is wrong had none either. Both got
-- tomorrow's reminder — and chasing someone for money they already sent is the
-- fastest way this product can make its own customer look bad.
--
-- A report is what the debtor files instead: "I already paid" (paid_claim) or
-- "something is wrong" (dispute). It pauses the chasing for that invoice and
-- lands on the creditor's desk with everything that was said. See
-- docs/pay-reports.md.

create table public.invoice_reports (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.users (id) on delete cascade,
  invoice_id  uuid not null references public.invoices (id) on delete cascade,
  debtor_id   uuid not null references public.debtors (id) on delete cascade,

  kind        text not null check (kind in ('paid_claim', 'dispute')),
  status      text not null default 'open'
              check (status in ('open', 'resolved', 'dismissed')),

  -- What was claimed, structured by the conversation (or typed into the plain
  -- form): summary, claimed_paid_on, claimed_amount_cents, method, reference,
  -- dispute_reason, contact. JSON rather than columns because the shape is the
  -- collector's, evolves with it, and is only ever read back whole for a human.
  details     jsonb not null default '{}'::jsonb,

  -- The conversation verbatim. The creditor is about to make a money decision
  -- on this report; they get the debtor's actual words, not our paraphrase.
  transcript  jsonb,

  -- Bank-feed corroboration computed at submit time: up to three unmatched
  -- credits that plausibly are this payment. A hint for the reviewer, never a
  -- decision — settling still goes through the same explicit action as always.
  bank_match  jsonb,

  created_at  timestamptz not null default now(),
  resolved_at timestamptz,
  -- The person, not the company: "which of us dealt with this" is the audit
  -- question, same as bank_transactions.matched_by.
  resolved_by uuid references auth.users (id) on delete set null
);

comment on table public.invoice_reports is
  'What a debtor said on the payment page: a payment claim or a dispute. Open reports pause the chasing for that invoice. Filed anonymously via the payment credential; written only by the server.';

-- One open report per invoice and kind. This is the design in one line: a
-- second claim folds into the conversation the creditor already has to review,
-- and the anonymous endpoint cannot be used to pile up rows.
create unique index invoice_reports_open_uniq
  on public.invoice_reports (invoice_id, kind)
  where status = 'open';

-- The sweep asks "which of this tenant's invoices are contested" every night,
-- and the invoices screen asks the same question on every load.
create index invoice_reports_user_open_idx
  on public.invoice_reports (user_id)
  where status = 'open';

-- ---------------------------------------------------------------------------
-- access
-- ---------------------------------------------------------------------------
--
-- Reads: the company being acted for, like every other table. Writes: nobody
-- from a browser. The debtor's submission arrives through the service role
-- after the payment credential is verified, and the creditor's resolution goes
-- through a server action that checks membership itself — so the row a money
-- decision is based on can never be edited by either party's browser session.

alter table public.invoice_reports enable row level security;

create policy invoice_reports_select_active on public.invoice_reports
  for select to authenticated
  using (user_id = (select public.current_org_id()));

revoke all on public.invoice_reports from anon, authenticated;
grant select on public.invoice_reports to authenticated;
