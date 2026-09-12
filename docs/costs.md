# Costs

Every cost lefta.app carries, as of 2026-09-12. Written because the pricing
model is being redone and guessing at the input would have produced a cennik
built on a number nobody checked.

Confidence is marked on every figure, because the two weakest numbers are also
two of the three largest: `[pub]` public price list or derived from this
repository, `[est]` estimate or a rate still to be confirmed in a contract,
`[??]` unknown — quote only. Rates are ex-VAT. 1 USD = 0.917 EUR.

A rendered version of this sheet, with the charts, is published as an artifact;
this file is the durable copy and the one to update.

## The finding that changes the arithmetic

Greek does not fit GSM-7, so every message goes out as UCS-2: **70 characters
per single segment**, 67 when split, against 160/153 for Latin. Run the real
templates from `src/lib/dunning/templates.ts` with realistic substitutions and
**all five Greek ones exceed 70 characters** — so every Greek SMS we send is
billed as two.

| Template | Encoding | Chars | Segments |
| --- | --- | --: | --: |
| EL νέο παραστατικό (`on_issue`) | UCS-2 | 101 | 2 |
| EL πριν τη λήξη (`pre_due`) | UCS-2 | 88 | 2 |
| EL ληξιπρόθεσμο (`overdue_2`) | UCS-2 | 102 | 2 |
| EL τελική ειδοποίηση (`overdue_10`) | UCS-2 | 93 | 2 |
| EL χειροκίνητη (`manual`) | UCS-2 | 86 | 2 |
| EN issued (`on_issue`), for contrast | GSM-7 | 94 | 1 |
| **Greek average** | | **94** | **2.00** |

Segment arithmetic straight from `segmentCount()` in `src/lib/sms/send.ts`.

One segment is reachable without dropping anything the debtor needs — who,
what, how much, where to pay:

```
Penny IKE: A 1042, 455,00 € ληξιπρόθεσμο. https://lefta.app/CDEF234567
|------------------- 70 characters = 1 segment --------------------|
```

That leaves a budget of **42 characters** of text with the full
`https://lefta.app/`, or **50** with a bare host (62 characters in total). The
binding constraint is the tenant name plus the invoice number, so a tenant with
a long name needs the name truncated server-side — otherwise this silently
reverts to two segments, which is why the CI length check below is worth an
hour.

## Marginal cost of one chased invoice

`DEFAULT_SCENARIO` gives exactly: issue notice (email), one day before due
(email), +3 days (email + SMS), +10 days (email + SMS) — **4 emails and 2 SMS**
for an invoice chased to the end. Repeats are off by default; a tenant enabling
them (`every 14 days, max 3`) adds rungs.

| Component | Units | Unit | Total | Share |
| --- | --: | --: | --: | --: |
| SMS (2 messages × 2 segments) | 4 segm. | €0.0330 | €0.1320 | 86.2% |
| AI invoice scan (vision + assist) | 1 | €0.0150 | €0.0150 | 9.8% |
| Email (Resend out-of-bundle rate) | 4 | €0.0008 | €0.0033 | 2.2% |
| AI dispute chat (assumes 8% of invoices) | 0.08 | €0.0357 | €0.0029 | 1.9% |
| **Marginal cost** | | | **€0.1531** | 100% |

Same scenario on another channel:

| Variant | € / invoice | Change | What blocks it |
| --- | --: | --: | --- |
| Greek SMS, 2 segments (today) | €0.1531 | — | — |
| Greek SMS shortened to 1 segment | €0.0871 | −43% | rewrite 5 templates + truncate tenant name |
| WhatsApp utility instead of SMS | €0.0661 | −57% | BSP, business verification, Meta-approved templates |
| Email only, no SMS | €0.0212 | −86% | collection rate — not a saving, a different product |
| Twilio GR instead of a local route | €0.2654 | +73% | nothing — which is why not Twilio for Greece |

## Channels

Watch the billing unit: Twilio bills **per segment**, several wholesalers quote
**per message**. On Greek that is a factor of two, and it belongs in the
contract, not in a web price list.

### SMS

| | Route | Price | Greek SMS | Notes |
| --- | --- | --: | --: | --- |
| `[pub]` | Twilio — Greece | $0.0657/segm. | €0.1205 | wired up in `src/lib/sms/twilio.ts`; dearest option |
| `[pub]` | Twilio — Poland | $0.0457/segm. | €0.0838 | Polish is UCS-2 too (ą, ć, ę…), so also 2 segments |
| `[est]` | BulkGate — Greece | €0.033/msg | €0.0660 | confirm whether "msg" means segment |
| `[est]` | BudgetSMS — Greece | from €0.047 | €0.0940 | "from" — real rate depends on volume |
| `[??]` | Brevo — GR/PL | no data | — | wired up in `src/lib/sms/brevo.ts`, pricing page returns HTTP 403 |
| `[??]` | Yuboto / AMD Telecom / Routee | quote only | — | Greek local carriers; likely cheapest, no figures |

### Email, Viber, WhatsApp

| | Channel | Variable | Fixed | Notes |
| --- | --- | --: | --: | --- |
| `[pub]` | Resend Pro, in bundle | €0 | $20/mo | 50,000 emails; wired up |
| `[pub]` | Resend overage | $0.90/1k | — | falls to $0.46/1k on Scale ($90+) |
| `[pub]` | Resend dedicated IP | — | $30/mo | only once sender reputation is ours to protect |
| `[est]` | Viber transactional, Greece | €0.0097 | **€150/mo** | monthly minimum — see the threshold below |
| `[est]` | WhatsApp utility — Greece | €0.0175 | — | plus BSP margin ~$0.005/msg |
| `[est]` | WhatsApp utility — Poland | €0.0101 | — | cheapest push channel within reach |
| `[est]` | WhatsApp service replies | €0 | — | free inside the 24h window — fits the dispute chat exactly |
| `[pub]` | 360dialog as BSP | — | €49/mo | alternative: Twilio, no subscription, higher per-message margin |

**Viber only pays off above ~15,500 messages a month.** €0.0097 is unbeatable,
but €150 of minimum has to be spread over something: at 2 SMS per invoice that
is roughly **7,750 invoices a month**, about 260 tenants. Below that Viber is
the most expensive channel here, not the cheapest, and WhatsApp — no minimum,
€0.0225 all-in — wins at every smaller scale.

## AI inference

All four AI paths already use `claude-haiku-4-5` ($1/$5 per MTok), so there is
no "move to a cheaper model" lever left to pull. The `max_tokens` figures are
read from the code; input token counts are estimates.

| Path | File | max_tokens | $ / call |
| --- | --- | --: | --: |
| Read a photographed invoice | `src/lib/invoice-scan/vision.ts` | 2,048 | $0.0124 |
| Fill in the missing fields | `src/lib/invoice-scan/assist.ts` | 600 | $0.0039 |
| Map CSV import columns | `src/lib/import/ai-mapping.ts` | 400 | $0.0032 |
| Dispute chat, one turn | `src/lib/reports/chat.ts` | 700 | $0.0055 |
| **Scan of one invoice** (vision + assist) | | | **$0.0163** |
| **6-turn conversation + summary** | | | **$0.0389** |

CSV mapping is once per file rather than per invoice, so it is negligible on
multi-row batches. Prompt caching would cut the chat's input (the history
repeats) — not counted, because it is not switched on.

## Platform

| | Item | € / mo | What is included, and where it ends |
| --- | --- | --: | --- |
| `[pub]` | Supabase Pro | $25 | 8 GB db, 100 GB egress, 100 GB files, 100k MAU |
| `[pub]` | Vercel Pro | $20/seat | **Required, not optional**: Hobby crons run daily, and `sendHour` needs an hourly sweep |
| `[pub]` | Resend Pro | $20 | 50,000 emails — 12,500 invoices/mo at 4 each |
| `[pub]` | Domain `lefta.app` | ~$1.5 | ~$18/yr; `.app` forces HTTPS (HSTS preload) |
| `[??]` | Enable Banking — bank feed | **€150–500** | Quote only. The keys are already in the code (`ENABLE_BANKING_APP_ID`), so this is a commitment rather than an option: payment matching and verifying "already paid" reports both stand on it |
| | **Total without the bank feed** | **€63** | |
| | **Total with the feed, low end** | **€213** | |

Usage-scaling lines and the thresholds we will actually hit:

| | Item | Rate | When it starts to hurt |
| --- | --- | --: | --- |
| `[pub]` | Supabase storage | $0.021/GB | invoice PDFs, ~200 kB each. At 3,000 invoices/mo that is 0.6 GB/mo cumulative — the 8 GB bundle runs out around month 13 |
| `[pub]` | Supabase egress | $0.09/GB | above 100 GB/mo |
| `[pub]` | Supabase Team | **$599/mo** | A cliff, not a step. Needed for SOC 2, the audit log and SSO — i.e. the moment a larger customer asks for due diligence. A 24× jump |
| `[pub]` | Vercel egress | $0.15/GB | payment pages are light, this will not bite |
| `[pub]` | Vercel invocations | $0.60/1M | the hourly cron is 720 calls/mo — negligible |
| `[pub]` | Vercel compute | $0.0106/GB-hr | matters for invoice scanning (vision + upload) |
| `[pub]` | Vercel extra seat | $20/person | every person who joins |

## Fees on our own revenue

**Fees on debtor payments are not our cost.** Viva, Revolut and Stripe Connect
in the code move the *tenant's* money: the debtor pays the tenant's invoice and
the tenant carries the fee on their own account. Same with myDATA/AADE and
Elorus — those are integrations on their side. Our cost is collecting the
**subscription from the tenant**. If we ever move to a percentage of recovered
value, this section has to be recalculated from scratch.

| | Item | Rate | Notes |
| --- | --- | --: | --- |
| `[pub]` | EEA card | 1.5% + €0.25 | non-EEA cards 3.25% + €0.25 |
| `[pub]` | SEPA Direct Debit | 0.8% + €0.25 | capped at €5 — clearly cheaper than card above ~€600 |
| `[pub]` | Stripe Billing | +0.7% | only if we use their subscriptions rather than our own |
| `[pub]` | Currency conversion | +1–2% | applies to us: revenue in EUR, the company reports in PLN |
| `[pub]` | Chargeback | €15 each | rare in B2B, painful at low ARPU |

On a €29/mo subscription the card fee is **€0.69**, i.e. 2.4% of revenue —
more than the AI cost of the entire tenant. Annual billing instead of monthly
cuts that to ~0.2%.

## Mobimetry sp. z o.o.

Independent of how many invoices pass through the system — payable in a month
with zero revenue too.

| | Item | Minimum | Realistic | Notes |
| --- | --- | --: | --: | --- |
| `[pub]` | Bookkeeping, full accounts | 750 | 1,200 | a sp. z o.o. has no choice: full accounting |
| `[est]` | Board ZUS | 0 | 2,757 | zero on unpaid appointment, full ZUS once on a contract. This is the entire spread |
| `[pub]` | Annual financial statement | ~40 | ~85 | 500–1,000 PLN once a year, e-statement + KRS |
| `[pub]` | Business bank account | 0 | 50 | free at most banks to start |
| `[est]` | Qualified signature | ~25 | ~25 | ~300 PLN/yr, required for KRS and statements |
| `[est]` | Office / address | 0 | 150 | we have our own (pl. Kościuszki 5/1A) |
| `[??]` | Liability / cyber insurance | 0 | ~200 | not mandatory, but corporate customers ask |
| | **Total, PLN/mo** | **815** | **2,710** | ≈ €190 / €630 |

**Tax.** CIT at 9% is available to us as a small taxpayer (revenue under €2m),
but only on profit, so it is a zero line for now. VAT: B2B service sales to
Greece are reverse-charged to the buyer, **but VAT on digital services bought
from abroad — Supabase, Vercel, Stripe, Anthropic — is ours to account for** as
an import of services. A reporting obligation rather than a cost, as long as we
deduct it.

## One-off and compliance

**Registering the alphanumeric sender ID with EETT is mandatory.** The Greek
regulator requires the sender name to be registered, and **messages from an
unregistered sender ID are rejected by the networks**, not merely flagged. The
limit is 11 characters; `lefta.app` is 9, so it fits. Without this the Greek SMS
channel simply does not work, which makes it a prerequisite rather than
something to defer. The SMS provider normally files it on our behalf; cost and
lead time depend on the provider.

| | Item | Cost | Notes |
| --- | --- | --: | --- |
| `[??]` | EETT sender ID registration | provider-dependent | mandatory, see above |
| `[est]` | Meta business verification (WhatsApp) | €0 | free, but needs company documents and time |
| `[est]` | Viber Business onboarding | €0 | the cost is the €150/mo minimum, not the entry |
| `[??]` | Legal opinion — governing law | ~€500–1,500 | unresolved: Greek law and Athens courts, or Polish? Flagged in `docs/handover.md` |
| `[??]` | GDPR review + processor agreements | ~€500–1,000 | we are a processor for tenants — a DPA is needed with each |
| `[pub]` | KRS amendments | 300 + 100 PLN | per change to the articles, e.g. raising share capital |
| `[est]` | EU trade mark for "lefta" | €850+ | optional; one EUIPO class |

**A caution on the name.** "lefta" (λεφτά) is Greek colloquial for "money", so
registrability as a mark in the financial classes is doubtful — worth checking
before spending the €850.

## The model at scale

30 invoices per tenant per month. Bank feed taken at the low end (€150).
Company costs excluded — they do not scale and would obscure the product's unit
economics.

| Tenants | Invoices | Variable | Platform | Bank feed | Total | € / invoice | € / tenant |
| --: | --: | --: | --: | --: | --: | --: | --: |
| 5 | 150 | €23 | €63 | €150 | €236 | €1.574 | €47.21 |
| 25 | 750 | €115 | €63 | €150 | €328 | €0.437 | €13.12 |
| 100 | 3,000 | €459 | €63 | €150 | €673 | €0.224 | €6.73 |
| 400 | 12,000 | €1,838 | €63 | €150 | €2,051 | €0.171 | €5.13 |

The curve flattens around 100 tenants and falls asymptotically to **€4.59** —
the variable cost of 30 invoices and nothing else. **That is the floor under any
price:** a subscription below ~€5/mo will not cover the sending, at any scale.
The fixed €213 spreads out quickly; the SMS cost never spreads at all.

What the bill is made of at 100 tenants (€673/mo): SMS €396 (58.9%), bank feed
€150 (22.3%), platform €63 (9.4%), AI €54 (8.0%), email €10 (1.5%). In practice
the bill is **SMS plus the bank feed — 81% in one pair**. Everything else,
including the AI we talk about most, is €127. Any hour of cost optimisation
spent outside those two lines is wasted.

## What I do not know

Two gaps, stated rather than guessed, and both large.

**The cheapest wholesale SMS route into Greece** — up to €250/mo. Brevo's
pricing page, for a provider we have already wired up, returns HTTP 403; the
Greek local carriers (Yuboto, AMD Telecom, Routee) quote on request only. I used
€0.033/segment from BulkGate. If a local carrier does €0.020 the variable cost
drops 39%, and if it turns out €0.033 is per *message* rather than per segment,
the saving is already ours. **To do:** an RFQ to three providers with a concrete
volume, asking outright how UCS-2 is billed.

**Enable Banking's actual quote** — up to €350/mo. No public price list; the
€150–500 estimate comes from market ranges for AIS access, not from an offer to
us. It is the second largest line in the bill and the one we know least about:
at €500 the bank feed outweighs SMS all the way to ~190 tenants. **To do:**
request a quote, and check whether the feed can wait for the first paying
tenants — "already paid" works without it, only without automatic confirmation.

## Levers, by return on effort

| Action | Saving | Effort | Risk |
| --- | --: | --: | --- |
| Rewrite the 5 Greek SMS templates under 70 chars | −43% / invoice | 1 day | low — the content stays complete, the variant is proven |
| A template length check in CI | guards the above | 1 hour | none; without it the first content edit quietly returns to 2 segments |
| WhatsApp utility as default, SMS as fallback | −57% / invoice | 1–2 weeks | medium — Meta approves templates, needs a BSP and verification |
| RFQ to Greek SMS carriers | up to −39% on SMS | a few emails | none |
| Defer the bank feed to the first paying tenants | €150–500/mo | a decision | medium — loses automatic payment confirmation |
| Annual rather than monthly billing | ~2.2% of revenue | configuration | low — harder to sell, also improves cash flow |
| Prompt caching in the dispute chat | ~€1/mo | half a day | not worth it now — AI is 8% of the bill |

## What this means for pricing

Cost is not an obstacle to any sensible price: €0.15 per invoice over 30
invoices is €4.59 of variable cost per tenant. The risk is the **shape**, not
the level. The only line that grows linearly with usage is SMS, and a flat
subscription moves all of that risk onto us — a tenant sending 500 SMS a month
costs €33 and is a loss against a €29 subscription. Either cap the messages
included in the plan, or move SMS onto usage-based billing.
