-- Chasing can be switched off for a single invoice.
--
-- Two scopes existed already: `users.automation_enabled` stops the sweep for a
-- whole tenant, and `debtors.muted` stops it for one customer. Neither covers
-- the ordinary case that prompted this — one disputed or privately arranged
-- invoice, on a customer whose other invoices should carry on being chased.
--
-- The name matches the tenant column rather than the debtor one because it is
-- the same idea at a narrower scope. `muted` reads as a property of a person;
-- this is a property of a document.
--
-- Default true, so nothing already in the table changes behaviour. An invoice
-- that has never been touched is chased exactly as it was yesterday.

alter table public.invoices
  add column automation_enabled boolean not null default true;

comment on column public.invoices.automation_enabled is
  'When false, the automatic sweep skips this invoice. Manual reminders are unaffected: this governs what happens on its own, not what a person deliberately does.';

-- Without this the toggle is refused in the browser.
--
-- UPDATE on this table was revoked wholesale and handed back one column at a
-- time, precisely so that a session can never write the payment token or the
-- settlement fields. A column left out of that list is not merely unlisted, it
-- is denied — so a new user-editable column has to be added here as well as to
-- the table. Column grants accumulate, so this adds to the existing set rather
-- than replacing it.
grant update (automation_enabled) on public.invoices to authenticated;

-- The sweep loads a tenant's pending invoices and filters in memory, so this is
-- not on the hot path today. The index is for the invoice list, which filters on
-- the column directly, and it stays small because it only covers the rows that
-- are actually paused.
create index invoices_automation_paused_idx
  on public.invoices (user_id)
  where automation_enabled = false;
