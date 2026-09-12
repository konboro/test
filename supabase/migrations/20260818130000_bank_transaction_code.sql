-- lefta.app — keep the bank's own classification of each movement.
--
-- The statement already says what kind of credit each row is: a transfer, a card
-- settlement from the merchant's own terminal, a cash deposit at a machine. The
-- response carries `bank_transaction_code` and we were discarding it, leaving the
-- panel to infer the kind from free text — "POI ST-…" happens to mean a POS
-- settlement on this account, and would mean nothing on another bank.
--
-- That distinction is not cosmetic here. Of the 26 credits read so far, 18 are
-- the account holder's own card takings arriving from their acquirer. Those are
-- not customer payments and can never settle an invoice, but they dominate the
-- list and outweigh everything else by two orders of magnitude.
--
-- Stored verbatim rather than mapped into our own vocabulary. Nobody has seen
-- what this bank actually sends yet, and inventing a taxonomy before seeing the
-- values is how the parser ended up discarding every row for a month.

alter table public.bank_transactions
  add column bank_transaction_code text;

comment on column public.bank_transactions.bank_transaction_code is
  'The bank''s own code for the kind of movement, verbatim. ISO 20022 uses domain/family/sub-family; banks also send proprietary codes. Kept unmapped until real values have been seen.';
