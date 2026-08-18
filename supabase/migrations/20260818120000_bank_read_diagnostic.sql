-- lefta.app — why the last read produced nothing.
--
-- The counters said the bank returned 19 movements and the parser kept none of
-- them. That narrows it to the parser, but not to a cause: every required field
-- missing looks the same as every row being a debit, and Enable Banking's own
-- two documentation sets disagree about whether the response is snake_case or
-- camelCase. Guessing between them would mean shipping a rewrite of the mapping
-- on the strength of a coin toss.
--
-- So this records what was actually observed: how many rows lacked each field
-- the mapper needs, how the credit/debit indicator was distributed, and the
-- top-level key names present on the response.
--
-- Names and counts only. No amounts, no counterparties, no references — the
-- statement names people who never signed up to this platform, and a debugging
-- aid is not a reason to copy their payments into another table. Key names are
-- schema, not data.

alter table public.bank_connections
  add column last_read_diagnostic jsonb;

comment on column public.bank_connections.last_read_diagnostic is
  'Shape of the last statement response: field-presence counts, indicator tally, and observed key names. Never any values — this exists to explain an empty result, not to duplicate the statement.';
