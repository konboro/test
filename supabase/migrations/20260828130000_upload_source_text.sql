-- lefta.app — keeping the text a reading was made from
--
-- Every diagnosis of this reader so far has begun by fetching the PDF back out
-- of storage and extracting its text again, because the text was produced,
-- used once and dropped. That is also why nothing can be learned from a
-- correction: knowing that a number was wrong is useless without the words it
-- was read from.
--
-- So the text is kept beside the reading. It is the tenant's own document,
-- already stored as a file two columns away; this adds no new class of data,
-- only the form of it that questions can be asked about.
--
-- Capped, because an invoice is a page and anything much larger is a batch scan
-- whose text nobody will read. The cap is applied in the application, where a
-- readable failure is possible; a check constraint here would reject the whole
-- upload over a long attachment.

alter table public.invoice_uploads
  add column if not exists source_text text;

comment on column public.invoice_uploads.source_text is
  'The text the fields were read from — the PDF text layer, or the model''s '
  'transcription of a scan. Kept so a correction can be explained and so a rule '
  'proposed from it can be reviewed against what the reader actually saw.';
