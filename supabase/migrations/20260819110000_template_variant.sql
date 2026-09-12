-- A named manual wording, alongside the plain one.
--
-- A template was identified by (step, channel), where a null step meant "the
-- manual reminder" — so a tenant had exactly one manual wording per channel.
-- That is one too few for Penny, whose debtors are people who owe for a scooter
-- ride, not businesses who owe on an invoice. The two need different copy, and
-- keeping both means neither has to be rewritten to send the other.
--
-- The ladder is deliberately untouched. `dunning_step` gains no value, the sweep
-- still walks exactly three rungs, and a variant is permitted only where the
-- step is already null. Everything that fires automatically keeps the guarantees
-- it had; what grows is the side a person drives by hand, which never carried
-- one.

alter table public.message_templates
  add column variant text
    check (variant is null or variant ~ '^[a-z][a-z0-9_]{0,31}$');

-- A rung's wording is identified by the rung. Two templates for one step would
-- leave the sweep with no basis on which to choose between them, so the schema
-- refuses the situation rather than leaving it to be resolved at send time.
alter table public.message_templates
  add constraint message_templates_variant_is_manual_only
  check (variant is null or step is null);

-- One row per (channel, variant) on the manual side. The coalesce is required
-- because null is not distinct from null in a unique index — the same reason
-- the original index was split on `step is null` instead of folding the two
-- cases together.
drop index if exists message_templates_user_manual_channel_uniq;

create unique index message_templates_user_manual_channel_uniq
  on public.message_templates (user_id, channel, coalesce(variant, ''))
  where step is null;
