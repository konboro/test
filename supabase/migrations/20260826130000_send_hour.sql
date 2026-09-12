-- What time of day the automatic reminders go out.
--
-- Until now there was no choice: one cron firing at 07:00 UTC swept every
-- tenant. That is 09:00 in Athens in winter and 10:00 in summer, so the send
-- time also drifted an hour twice a year without anybody choosing it.
--
-- The hour is local to Europe/Athens, which is the operative timezone
-- everywhere else in this system. 9 is the default because a reminder that
-- lands at the start of the working day is read; one that lands at 07:00 is
-- buried by the time anybody opens their inbox.
--
-- The sweep now runs hourly and acts for a tenant only when their chosen hour
-- has arrived, so a row that never gets one still behaves exactly as before.

alter table public.dunning_settings
  add column send_hour smallint not null default 9
  check (send_hour between 0 and 23);

comment on column public.dunning_settings.send_hour is
  'Local Europe/Athens hour, 0-23, at which the automatic sweep may contact this tenant''s customers.';

-- Both grants. A column with UPDATE but no SELECT is writable and unreadable,
-- which is how `users.business_mode` logged everyone out of Settings.
grant select (send_hour) on public.dunning_settings to authenticated;
grant update (send_hour) on public.dunning_settings to authenticated;
