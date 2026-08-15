# lefta.app

Accounts-receivable automation for Greek SMEs. Connects to **myDATA (AADE)**, tracks
unpaid invoices, sends a fixed ladder of payment reminders by email and SMS, and gives
each debtor a **Pay Now** link that settles the invoice through Stripe.

lefta.app operates strictly as an **IT / software provider**. It transmits reminders on
the creditor's behalf. It does not take assignment of claims, negotiate debts, or perform
collection activity.

---

## Stack

| Layer     | Choice                                            |
| --------- | ------------------------------------------------- |
| Framework | Next.js 15 (App Router) + TypeScript strict        |
| Styling   | Tailwind CSS v4                                    |
| Database  | Supabase — PostgreSQL + Auth + RLS                 |
| Payments  | Stripe Checkout + webhooks                         |
| Email     | Resend                                             |
| SMS       | Yuboto (Greek aggregator)                          |
| Scheduler | Vercel Cron (any scheduler with a bearer token works) |

---

## Getting started

```bash
npm install
cp .env.example .env.local     # then fill in the values
npm run dev
```

Apply the schema to a Supabase project:

```bash
supabase link --project-ref <project-ref>
supabase db push               # runs supabase/migrations in order
```

Then regenerate types whenever the schema changes:

```bash
SUPABASE_PROJECT_ID=<project-ref> npm run db:types
```

### Checks

```bash
npm run typecheck     # tsc --noEmit
npm run lint          # eslint
npm test              # vitest
npm run build         # production build
```

### Running without provider keys

Leave `RESEND_API_KEY` and `YUBOTO_API_KEY` unset outside production and both senders
enter **dry-run mode**: the message is logged to the console and recorded in
`communications_log` exactly as it would have been sent, so the whole workflow is
exercisable end to end with no third-party accounts. In production a missing key is a
hard failure instead, recorded against the message as `status = 'failed'`.

---

## Architecture

```
src/
  app/
    (app)/                    dashboard, invoices, debtors, logs, settings  [auth required]
    pay/[token]/              public payment page for the debtor
    api/
      cron/dunning/           daily automation entry point (bearer auth)
      mydata/sync/            on-demand myDATA pull
      settings/mydata/        stores + verifies AADE credentials
      stripe/credits/         Checkout session for SMS credit packs
      stripe/pay/             Checkout session for an invoice        [public]
      stripe/webhook/         the only writer of `paid` + SMS credits [signature auth]
  lib/
    dunning/engine.ts         the ladder, the compliance lock, delivery
    dunning/templates.ts      Greek email + SMS copy
    mydata/                   AADE REST client, XML parser, reconciliation
    supabase/                 browser / server (RLS) / admin (service-role) clients
    crypto.ts                 AES-256-GCM for the myDATA subscription key
supabase/migrations/          schema, RLS policies, security-definer functions
```

### Three Supabase clients, three trust levels

| Client                    | Key          | Used by                                       |
| ------------------------- | ------------ | --------------------------------------------- |
| `supabase/client.ts`      | anon         | browser components                            |
| `supabase/server.ts`      | anon         | server components + actions — **RLS applies** |
| `supabase/admin.ts`       | service role | cron, webhook, myDATA sync — **RLS bypassed** |

Anything using the admin client and acting for a specific tenant performs its own
ownership check, standing in for the policy it bypassed (see
`invoices/actions.ts:markInvoicePaid`).

---

## The automation engine

A fixed, non-configurable ladder (`lib/dunning/engine.ts`):

| Step         | Timing                | Channels      |
| ------------ | --------------------- | ------------- |
| `pre_due`    | 3 days before due date | Email        |
| `overdue_2`  | 2 days overdue        | Email + SMS   |
| `overdue_10` | 10 days overdue       | Email + SMS   |

Each step fires on a **window**, not a single day (`pre_due` covers −3…−1,
`overdue_2` covers 2…9, `overdue_10` covers 10+), so a missed cron run is caught up
the next day rather than skipped. Chasing stops entirely after 120 days overdue.

### Compliance lock

> A debtor is contacted **at most once per calendar day**, regardless of how many
> unpaid invoices they have.

The spec asks both for "Email + SMS at step 2" and for "never more than one message per
day per debtor". Those only coexist if the limit counts **contacts**, not raw messages —
which is also the anti-spam intent. So the unit of rate limiting is a *dunning contact*,
which may fan out to email and SMS as one notification.

The lock is enforced in the database, not just in application code:

```sql
create unique index dunning_contacts_one_per_debtor_per_day
  on public.dunning_contacts (debtor_id, contact_on);
```

The engine must insert a row here before sending anything. Claiming that row *is* the
permission to make contact, so the guarantee holds under concurrent runs, duplicate cron
invocations, and any future code path. A second index on `(invoice_id, step)` ensures a
given step fires only once per invoice.

When a debtor's most overdue invoice has already completed its step, the engine falls
through to their next invoice rather than skipping the debtor for the day.

### Auto-stop

Only `pending` invoices are ever loaded, and the invoice status is **re-read immediately
before sending** — a payment that lands mid-sweep aborts the reminder. Once the Stripe
webhook flips an invoice to `paid`, it leaves the candidate set permanently.

### SMS credits

A credit is reserved via `consume_sms_credit` *before* the provider call and refunded if
the send fails, so a delivered SMS is never unbilled and a failed one never charged.
Running out of credits degrades to email-only and is recorded as `status = 'skipped'`.

---

## myDATA integration

`RequestTransmittedDocs` is the endpoint used — it returns documents the tenant *issued*
(receivables). `RequestDocs` would return inbound documents, which are payables.

- Credentials go out as `aade-user-id` and `ocp-apim-subscription-key` headers.
- Responses are XML; parsed with `fast-xml-parser` (`removeNSPrefix`, values kept as
  strings so a 15-digit **MARK never becomes a JS number**).
- Sync is incremental: it resumes from the highest MARK already stored.
- Debtors are keyed on the counterpart VAT number. myDATA often omits the counterpart
  name, so new debtors are seeded as `ΑΦΜ <number>` for the tenant to correct, and they
  have no contact details until someone fills them in.
- myDATA carries **no due date** — it is derived as issue date + the tenant's
  `default_payment_terms_days`.
- Documents already marked `paid` locally are never overwritten by a sync.

The subscription key is encrypted with AES-256-GCM (`v1:<iv>:<tag>:<ciphertext>`, a fresh
IV per encryption) before it reaches the database, and column-level grants keep it out of
every browser-readable projection.

---

## Payments

The reminder links to `/pay/<pay_token>` — an opaque 24-byte token, so internal invoice
ids are never enumerable. The page reads through a `security definer` function exposing
only the fields it needs, rather than opening the `invoices` table to anonymous access.
The Checkout amount is always taken from the database, never from the request.

`checkout.session.completed` is the only path that marks an invoice paid. It is
idempotent twice over: the update is guarded on `status = 'pending'`, and SMS credit
grants key on the Stripe session id.

### Local webhook testing

```bash
stripe listen --forward-to localhost:3000/api/stripe/webhook
```

### Cron

`vercel.json` schedules `/api/cron/dunning` daily at 07:00 UTC. Any scheduler works:

```bash
curl -X POST https://<host>/api/cron/dunning \
  -H "Authorization: Bearer $CRON_SECRET"

# dry run — reports what would be sent, sends nothing:
curl -X POST "https://<host>/api/cron/dunning?dryRun=1" \
  -H "Authorization: Bearer $CRON_SECRET"
```

---

## Security notes

- Every table is tenant-scoped by `auth.uid()` through RLS.
- The myDATA key column is excluded from the `authenticated` grant entirely, so even a
  compromised anon key cannot read the ciphertext.
- `pay_token` and all settlement columns are revoked from `authenticated` — only the
  webhook writes them.
- `communications_log` is append-only, enforced by a trigger that rejects UPDATE and
  DELETE for every role, including the service role.
- The cron secret is compared in constant time.

---

## Status

Implemented and verified: schema + RLS, auth, myDATA client/parser/sync, the automation
engine, email + SMS delivery, both Stripe flows and the webhook, all dashboard screens,
and the public payment page. 41 unit tests cover the ladder timing, per-step
reachability, the XML parser, phone normalisation, SMS segmentation, and encryption
round-trip/tamper detection.

Not built (out of MVP scope): subscription billing for lefta itself, myDATA
`RequestMyIncome`, partial payments, multi-user tenants, and any UI language other than
Greek.

Integration paths that need live credentials to verify end to end — the AADE endpoint
shape, Resend/Yuboto delivery, and the Stripe webhook — are implemented against the
documented contracts and unit-tested at the parsing/logic layer, but have not been run
against real accounts in this environment.
