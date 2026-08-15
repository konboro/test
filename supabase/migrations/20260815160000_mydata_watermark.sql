-- lefta.app — remember how far the myDATA sync got.
--
-- The resume point used to be derived from the highest MARK already stored in
-- `invoices`. On a real account that is wrong in two ways:
--
--   * Most documents are never stored. A retail receipt carries no counterpart
--     at all — no VAT number, no name, nothing — so there is nobody to chase and
--     the sync skips it. On the account this was built against, 961 of 962
--     documents in a month. The watermark therefore lags far behind what has
--     actually been read.
--   * A page containing only skippable documents advances the watermark not at
--     all, so the next run fetches exactly the same page again, forever.
--
-- Tracking the highest MARK *seen* fixes both, and lets a run stop after a
-- bounded number of pages and genuinely resume where it left off. That matters
-- because a year's window spans several pages of ~2.5 MB each, which is more
-- than one request should try to swallow.

alter table public.users
  add column mydata_last_mark text;

comment on column public.users.mydata_last_mark is
  'Highest myDATA MARK seen by a sync, including documents that were skipped. The resume point.';

grant select (mydata_last_mark) on public.users to authenticated;
