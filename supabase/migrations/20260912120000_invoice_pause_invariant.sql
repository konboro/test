-- One invoice, one answer about whether it is being chased.
--
-- `invoices.automation_enabled` and `invoices.scenario_mode` say the same thing
-- twice: a mode of 'off' is exactly a disabled invoice. Three of the four places
-- that write them keep the pair consistent — 20260827100100 even reconciled the
-- existing rows on the way in — but the checkbox on the invoice list writes only
-- `automation_enabled`, because that is the only column a session was ever
-- granted. So it could not have written the other one even if it had tried: a
-- column left out of the grant list is denied, silently.
--
-- Left alone the pair drifts, and the drift is visible to the operator as a
-- contradiction: the nightly sweep reads `automation_enabled` and resumes the
-- ladder, the issue notice reads `scenario_mode` and stays suppressed, and the
-- invoice's own page reads `scenario_mode` and reports that nothing is
-- scheduled — while reminders go out.

-- Without this the checkbox cannot keep its own promise.
--
-- UPDATE on this table was revoked wholesale and handed back one column at a
-- time, so that a session can never write the payment token or the settlement
-- fields. Column grants accumulate; this adds to the set.
grant update (scenario_mode) on public.invoices to authenticated;

-- The rows that already drifted.
--
-- `automation_enabled` is the source of truth in both directions, which is the
-- same choice 20260827100100 made and also the operator's most recent visible
-- action: the checkbox is the control they last touched. It is the reading that
-- changes no behaviour, too — the sweep is already going by this column, so
-- aligning the mode to it makes the screens tell the truth about what is
-- happening rather than starting or stopping anything.
-- A paused invoice that was following its own ladder loses the 'custom' marker
-- here, not the ladder: the rows live in invoice_dunning_steps and only the
-- cadence editor deletes them. Ticking the box back on finds them and restores
-- the mode, which is what the application now does.
update public.invoices
   set scenario_mode = 'off'
 where automation_enabled = false
   and scenario_mode <> 'off';

update public.invoices
   set scenario_mode = 'default'
 where automation_enabled = true
   and scenario_mode = 'off';
