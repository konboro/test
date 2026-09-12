-- The second lock on `leases`, which was created without one.
--
-- The table enables row level security and names no policy for `anon`, so a
-- public request is refused today. What was missing is the layer underneath:
-- the schema hands every new table full privileges to `anon` by default, and
-- `20260819160000_revoke_anon_grants.sql` took those away from every table that
-- existed then. A table created afterwards gets them back.
--
-- Verified rather than assumed — after the leases migration ran, `anon` held
-- SELECT, INSERT, UPDATE and DELETE on it. Inert while no policy admits `anon`,
-- and the day somebody writes `using (true)` on a public feature, the grant is
-- what decides whether that is a bug or a breach.
--
-- Every new table needs this line. It is in CLAUDE.md for that reason.

revoke all on public.leases from anon;
