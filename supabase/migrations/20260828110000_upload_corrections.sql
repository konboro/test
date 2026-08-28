-- lefta.app — what the operator changed before confirming a reading
--
-- The reader is improved by finding out where it was wrong, and until now that
-- happened by somebody noticing on screen and saying so out loud. Every fault
-- fixed in the last few days — a header row read as a form, a supplier's phone
-- offered as the customer's, an English date parsed as nothing — was reported
-- by hand. The corrections themselves were made, saved, and thrown away.
--
-- This keeps them. `extracted` is what the reader proposed; `confirmed` is what
-- the person actually saved. Where they differ is a defect, named and dated,
-- with the document still in storage beside it.
--
-- Deliberately not an attempt to make the reader adapt on its own. A parser
-- that quietly rewrites its own rules from user edits is a parser nobody can
-- predict or test, and this one decides who gets asked for money. What this
-- gives is evidence — and evidence is what turns "the scanning is bad" into a
-- specific template with a specific fault and a test that pins it.

alter table public.invoice_uploads
  add column if not exists confirmed jsonb;

comment on column public.invoice_uploads.confirmed is
  'The field values as saved by the operator, beside `extracted` as proposed by '
  'the reader. Their difference is the correction. Written once, at commit.';

-- Only the rows that were actually corrected are ever queried, and they are the
-- minority. A partial index keeps that lookup off the rest of the table.
create index if not exists invoice_uploads_corrected_idx
  on public.invoice_uploads (user_id, created_at desc)
  where confirmed is not null;
