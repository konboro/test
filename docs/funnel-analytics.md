# lefta.app — dunning funnel & channel analytics

The question this answers, concretely: *a creditor imports 150 debtors, the
ladder starts firing — how many were reached, how many opened the payment link,
how many paid, and which channel earned its cost?* Email is free and SMS costs a
credit, so "is SMS worth it" is a money question, not a curiosity.

The funnel, per contact:

```
sent → delivered → opened → link visited → checkout started → paid
```

## What is already measurable today (no code)

Two ends of the funnel already exist and are trustworthy:

- **sent / failed / skipped**, per channel, step and day — `communications_log`
  records every attempt with its outcome and `provider_message_id`.
- **paid**, when and how — the invoices table plus the settlement method
  (card via Stripe/Viva, bank-matched transfer, marked by hand, Elorus).

So "how many of the 150 paid within a week of step 2" is one SQL join away.
Everything below fills the middle of the funnel and makes the answer visible.

## Design principles

1. **First-party measurement beats provider tracking.** We serve the payment
   page ourselves, so link visits and checkout starts are measured on our own
   server — no URL-rewriting click trackers (they hurt deliverability and make
   SMS links ugly), no third-party analytics on a debtor-facing page.
2. **Count people, not hits.** Every stat is `distinct invoice` (or debtor) per
   stage. Raw events are kept; deduplication is the query's job.
3. **Honest metrics only.** Email opens are inflated by Apple Mail prefetch and
   deflated by blockers — shown, but labelled approximate. Link prefetchers
   (Outlook SafeLinks and friends) fetch GET pages — so a *server* render is not
   evidence of a human. The human signals, in increasing strength: a client-side
   beacon, a checkout POST, a settled payment.
4. **A transfer does not click.** A debtor who reads the SMS and pays by bank
   transfer never touches the link, yet the SMS worked. Channel effect must
   therefore also be read from *payment timing after contact*, not clicks alone.
5. **Debtors are data subjects.** No IP addresses, no raw user agents, no
   cookies on the pay page, retention-limited event tables, nothing readable by
   `anon`.

## Gap 1 — channel attribution on the link

Email and SMS carry the same `{{pay_url}}`, so a visit cannot name its channel.
`dispatchContact` renders per channel already; it appends a channel tag when
building the context for each channel:

```
https://lefta.app/A7K2M9PQ4X?c=e     email
https://lefta.app/A7K2M9PQ4X?c=s     SMS
```

Four characters on the SMS budget — the template preview already counts
segments, so the cost is visible where the copy is edited. The pay page reads
`c`, hands it to the beacon and to the checkout call; an untagged visit (typed,
forwarded, QR later) is `other`. The parameter changes nothing about which
invoice resolves — it is annotation, not routing.

## Gap 2 — first-party funnel events

One new table:

```sql
create table public.funnel_events (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.users(id) on delete cascade,
  invoice_id  uuid not null references public.invoices(id) on delete cascade,
  debtor_id   uuid references public.debtors(id) on delete set null,
  channel     text check (channel in ('email','sms','other')),
  event       text not null check (event in ('page_view','checkout_started')),
  occurred_at timestamptz not null default now()
);
-- RLS: select own; insert/update/delete revoked from anon+authenticated —
-- written only by the two server paths below, under the service role.
```

Deliberately absent: IP, user agent, referrer, session ids. The row says "this
invoice's link was seen, from this channel, at this time" and nothing else.

Two writers:

- **`page_view`** — a tiny client component on the pay page fires
  `navigator.sendBeacon('/api/beacon', { credential, c })` after hydration.
  The endpoint resolves the credential exactly like `get_invoice_for_payment`
  and inserts the event. Running client-side is the bot filter: scanners that
  prefetch the URL don't execute the page. (Some do — perfection is not on
  offer; checkout and payment are the load-bearing stages.)
- **`checkout_started`** — logged inside `/api/pay/start`, which already knows
  the invoice; the pay button passes the `c` it read from its own URL. A POST
  with a JSON body is not something a prefetcher sends.

`paid` needs no event — it is already the invoices table, and duplicating
settlement into an analytics table would create two sources of truth.

## Gap 3 — delivery events from the providers

`communications_log` says we handed the message to the provider; it cannot say
the message arrived. Two webhook endpoints close that:

```sql
create table public.delivery_events (
  id                  uuid primary key default gen_random_uuid(),
  provider            text not null check (provider in ('resend','brevo')),
  provider_message_id text not null,
  event               text not null,   -- delivered / bounced / complained / opened / sms_delivered / sms_failed …
  occurred_at         timestamptz not null default now()
);
create index delivery_events_message_idx on public.delivery_events (provider_message_id);
```

- **`/api/webhooks/resend`** — Resend signs with svix; verify the signature,
  store `delivered`, `bounced`, `complained` (and `opened` if enabled, labelled
  approximate). Click tracking stays **off**: it rewrites URLs, and Gap 2
  measures clicks better on our own page.
- **`/api/webhooks/brevo`** — SMS delivery reports (`delivered`,
  `hard_bounce`, …). Brevo has no request signing; the webhook URL carries a
  long random token that is compared in constant time, same pattern as
  `CRON_SECRET`.

Joins back through `communications_log.provider_message_id`. The log itself
stays append-only and untouched.

Delivery events also earn their keep operationally: a hard email bounce or a
dead phone number should surface on the customer card ("email invalid — fix
it") — the same signal the reachability warning uses today, but grounded in
what actually happened rather than what fields are filled.

## The numbers the stats screen shows

Per period, per ladder step, per channel — unit is the debtor/invoice, windows
default to 7 days after contact:

| Metric | Definition | Source |
|---|---|---|
| Delivery rate | delivered / sent | log + delivery_events |
| Link-open rate | invoices with a human `page_view` / delivered | funnel_events |
| Checkout rate | `checkout_started` / page views | funnel_events |
| Payment rate | invoices paid ≤ N days after contact / contacted | invoices + contacts |
| Attributed channel | last `page_view`/`checkout` channel before payment; otherwise "contact, no click" (see principle 4) | funnel_events + invoices |
| Time to payment | median days, first contact → settlement | contacts + invoices |
| Cost per € collected | SMS credits spent / amount settled after SMS-attributed contacts | log + invoices |
| Email opens | opened / delivered, labelled *approximate* | delivery_events |

**Campaign view without a campaign table:** a "campaign" is simply the group of
contacts sharing (`contact_on`, `step`) — "the 150 pre-due emails from 3 March"
is already a row group in `dunning_contacts`. The stats screen groups by day and
step; no new entity, no state to forget to write. If named campaigns are ever
needed (a manual blast to a chosen subset), a nullable `campaign_id` on
`dunning_contacts` slots in without disturbing any of this.

**Template experiments, later:** message copy is already per-tenant
(`message_templates`). Adding `template_updated_at` to the contact row would
let the same funnel compare wordings — the mechanism above doesn't change.

## Privacy & retention

- No IP, UA, cookies, or third-party scripts on the debtor-facing page; the
  beacon is same-origin and carries the credential it was rendered with.
- `funnel_events` and `delivery_events`: select limited to the owning tenant,
  writes service-role only, nothing granted to `anon`.
- Retention: a `pg_cron` job purges both tables after 12 months; aggregates the
  stats screen needs longer live in queries over invoices/contacts, which stay.
- The GDPR basis is the creditor's legitimate interest in collecting their own
  receivables; the events add no new category of data beyond "their invoice's
  payment link was used".

## Phasing

1. **Measure the middle** *(one slice: migration + channel tag + beacon +
   checkout logging + a funnel section on the dashboard).* From the first Penny
   campaign this answers: reached → opened → started → paid, per channel.
2. **Delivery truth** — the two webhooks, bounce surfacing on the customer
   card, delivery rate in the funnel.
3. **Judgement calls** — attribution windows in the UI, cost per € collected,
   time-to-payment distributions, template comparison, bounce-spike alert
   through the same notifier the payment emails use.
