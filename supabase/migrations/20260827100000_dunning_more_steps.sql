-- lefta.app — more rungs on the ladder, and one that fires when the invoice is raised
--
-- Why new enum values rather than a `position` column: `dunning_step` is what
-- `dunning_contacts` and `message_templates` both key on, and the guarantee that
-- a step fires at most once per invoice per cycle is a unique index over it.
-- Turning the ladder into positions would dissolve that index, the template
-- store and every row of contact history in a single migration, to buy nothing
-- a tenant can see. Adding values leaves all of it standing.
--
-- The names are opaque slot identifiers, not descriptions. `overdue_2` has
-- carried whatever offset its tenant chose ever since the scenario became
-- configurable; reading meaning into the name was already wrong before this.
--
-- `on_issue` is the exception that is genuinely different in kind: it is not
-- measured from the due date at all, it fires once when the invoice is
-- confirmed. The rules that say so live in the next migration, because Postgres
-- will not let a value added here be used in the same transaction.

alter type public.dunning_step add value if not exists 'on_issue' before 'pre_due';

-- Room to build a ladder past the original three. Eight is the ceiling on
-- purpose: with the repeat on top of it, that is already more contact than any
-- honest collection process needs, and the limit belongs in the database where
-- the application cannot argue with it.
alter type public.dunning_step add value if not exists 'step_4';
alter type public.dunning_step add value if not exists 'step_5';
alter type public.dunning_step add value if not exists 'step_6';
alter type public.dunning_step add value if not exists 'step_7';
alter type public.dunning_step add value if not exists 'step_8';
