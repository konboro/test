-- lefta.app — what the last statement read actually returned.
--
-- A feed that stores nothing has two very different causes and, until now, no
-- way to tell them apart after the fact: either the bank returned no movements,
-- or it returned them and every row was discarded because the fields did not
-- match what the parser expects. Both leave an empty table and a `last_synced_at`
-- that advanced normally.
--
-- The counts were already computed on every run and thrown away when the
-- function returned. Keeping the last pair on the connection makes the question
-- answerable at any time, by anyone, without catching a log inside its retention
-- window or asking the operator to read a number off a screen.
--
-- Deliberately only the latest: this is a diagnostic, not a history. A run log
-- would be a table that grows forever to answer a question that is only ever
-- asked about the most recent read.

alter table public.bank_connections
  add column last_fetched_count integer,
  add column last_credit_count  integer;

comment on column public.bank_connections.last_fetched_count is
  'Rows the bank returned on the last successful read, before debits and unparseable entries were dropped. Null means no read has completed since this column existed.';
comment on column public.bank_connections.last_credit_count is
  'How many of those survived as incoming credits. Equal to last_fetched_count means every row was usable; zero against a non-zero fetch means none were incoming — or the response shape does not match the parser.';

-- Non-secret, and the settings card shows it, so the tenant may read it. Writing
-- stays with the sweep under the service role, like every other column here.
grant select (last_fetched_count, last_credit_count)
  on public.bank_connections to authenticated;
