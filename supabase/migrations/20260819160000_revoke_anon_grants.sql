-- Second lock on the tenant tables.
--
-- Row level security is doing the work today and doing it correctly: every one
-- of these tables has RLS enabled, no policy names `anon` or `public`, and a
-- request with the anon key comes back empty or 401. That was verified against
-- production before writing this, by reading with the real anon key rather than
-- by reasoning about the policies.
--
-- The problem is that the table grants underneath say something different.
-- `anon` still holds SELECT on six tables and INSERT/UPDATE/DELETE on three of
-- them, inherited from the schema defaults. Those privileges are inert only for
-- as long as no policy ever admits `anon` or `public`. The day someone writes
-- `using (true)` on a table — a plausible mistake when adding a public feature —
-- the grant is what decides whether that is a bug or a breach.
--
-- Nothing in the application acts as `anon` against these tables. The debtor
-- facing pages read through `get_invoice_for_payment` under the service role,
-- and every public API route builds an admin client. Signed-in users act as
-- `authenticated`, which is untouched here.

revoke all on public.users               from anon;
revoke all on public.debtors             from anon;
revoke all on public.invoices            from anon;
revoke all on public.communications_log  from anon;
revoke all on public.dunning_contacts    from anon;
revoke all on public.dunning_settings    from anon;
revoke all on public.dunning_steps       from anon;
revoke all on public.message_templates   from anon;
revoke all on public.sms_credit_purchases from anon;
revoke all on public.bank_connections    from anon;
revoke all on public.bank_transactions   from anon;
revoke all on public.funnel_events       from anon;
revoke all on public.invoice_uploads     from anon;
revoke all on public.viva_orders         from anon;
