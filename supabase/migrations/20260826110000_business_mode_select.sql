-- Entering Settings logged the user out.
--
-- `20260821110000_leases.sql` added `users.business_mode` and granted UPDATE on
-- it — the settings form writes it — but not SELECT, and the form has to read
-- the current value before it can offer it. UPDATE on this table was revoked
-- wholesale and handed back one column at a time, so a column absent from the
-- SELECT list is denied rather than merely unlisted.
--
-- Column-level denial fails the *whole* query, not the column: the settings
-- page asked for thirteen columns, got nothing back, and read that as "this
-- account has no profile" — whose handler is `redirect('/login')`. Hence a
-- missing grant that presents as being signed out.
--
-- Everywhere else the same failed read degrades quietly, which is why only one
-- page appeared broken. See the logging added alongside this migration: a
-- refused query should say so rather than impersonate a session problem.

grant select (business_mode) on public.users to authenticated;
