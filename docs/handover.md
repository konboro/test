# Handover — what a session needs to work on this repo

Written for another agent picking this up. It lists **where** each credential
lives and what it is for. It deliberately contains **no secret values**, and no
document in this repository ever should.

## Why the secrets are not written down here

This repository pushes to GitHub. A secret committed here is permanent: deleting
the line does not remove it from history, and anyone who ever clones the repo
has it. Rotating what leaks is not cheap either — the Supabase service role key
is wired into every deployment, and replacing it breaks production until every
environment is updated.

There is also no channel between agent sessions. Each session has its own
private working directory; one session cannot read another's, and nothing in the
repo is a mailbox. The operator is the channel. That is a feature here rather
than a limitation.

## What a session actually needs

Three things, in the order they usually bite:

**1. Supabase management token** — `SUPABASE_ACCESS_TOKEN`, an `sbp_…` value.
Needed to apply migrations, because migrations are applied by hand against the
Management API rather than by a pipeline. Without it a merged branch whose
migration has not landed will read as a mysterious "column does not exist" in
code nobody touched.

Project ref: `mikngfoizxazndsrwlgl`, name `lefta-prod`, region `eu-central-1`.

**2. Vercel CLI login** — already present on the machine this runs on
(`npx vercel whoami` will say). Production deploys go through
`npx vercel --prod --yes` from the repo root. There is one project; do not
create a second by deploying from a different directory name.

**3. Git push access** — the machine's existing GitHub credential. The working
branch is `fix/supabase-deploy`, which is what production tracks.

Everything else — Stripe, Viva, Revolut, Enable Banking, Resend, Brevo, the
encryption key, `CRON_SECRET` — lives in the Vercel project environment and is
marked sensitive there. Those can be **set** but not **read back**, which is
correct and should stay that way. If a task needs one of them, ask the operator
rather than trying to extract it.

## Merging: the two things that actually go wrong

**Migrations are not applied by deploying.** Every branch that carries a
migration needs it pushed to the database by hand, and the code usually ships
first. Check before deploying a merge:

    select version from supabase_migrations.schema_migrations order by version desc limit 5;

against `ls supabase/migrations | tail -5`. Twice now a merged branch has
shipped ahead of its migration; once it would have turned a bulk send of forty
reminders into "forty failed" without sending anything.

Numbers are claimed by creating the file. Three collisions have already
happened. Take the next free number and create the file immediately rather than
reserving one.

**Not every branch should be merged,** and the decision belongs in the report
rather than in silence. `feat/sms-twilio` was the standing example: it would
have replaced the live Brevo transport and removed 35 lines from a sender that
works, and the operator parked Twilio deliberately.

That branch is now retired with `git merge -s ours` — examined, tree unchanged,
not one file touched, Brevo still the live transport. Its own change had since
arrived by another route anyway: the Brevo integration split the providers into
`src/lib/sms/twilio.ts` and `brevo.ts` behind a chooser, so mainline already
carries the same `ValidityPeriod: 36000` ceiling and the same credential pair.

Which means the parking was never really held by the unmerged branch, and that
is the part worth carrying forward: an absent merge is a signal only until
someone merges it. What holds Twilio back is the trap below.

## Traps this codebase has already sprung

Worth reading before writing anything that matches text, touches grants, or
sets an environment variable in production.

- **Two SMS credentials are a provider switch.** `smsTransport()` returns
  `twilio` whenever `TWILIO_ACCOUNT_SID` and `TWILIO_AUTH_TOKEN` are both set,
  and only falls through to `brevo` otherwise. So adding those two variables
  moves every reminder in production onto Twilio — no deploy, no flag, no log
  line saying the sender changed. The precedence is deliberate (a name and a
  set of credentials can disagree, and a provider selected but not configured
  is a reminder that silently does not send), but it means the live sender is
  decided by which secrets exist. `STRIPE_SECRET_KEY` does the same thing to
  payment routing in `tenantPayments()`: a tenant with a connected account
  switches from their own key to Connect the moment the platform key appears.
- **`\b` is ASCII-only.** `/\bΑΦΜ\b/` and `/\bNIP\b/` can never match, and a
  regex that never fires looks exactly like a document that never mentioned the
  label. Every label in `src/lib/invoice-scan/fields.ts` uses explicit
  `(?<![\p{L}\p{N}])` lookarounds instead.
- **Build patterns as regex literals, not strings.** In a string literal `'\s'`
  is `s`, so `DATA\s+WYSTAWIENIA` silently becomes `DATAs+WYSTAWIENIA`.
- **`Ł` does not decompose.** NFD leaves it whole, so a pattern spelled with a
  plain L misses every Polish label containing it.
- **Thousands separators are spaces in half of Europe.** An amount pattern that
  stops at the space reads `1 230,00` as `230,00` — plausible, on the right
  line, and wrong by a factor of a thousand.
- **`anon` holds no table grants and must keep holding none.** RLS is the first
  lock; the revoked grants are the second. A new table created by a later
  migration inherits schema defaults, so it needs its own
  `revoke all … from anon`.
- **A `const` read by an immediately-invoked function above its declaration**
  compiles and throws at runtime. ESLint now catches it; do not disable
  `no-use-before-define`.
- **Nested forms are invalid HTML.** The browser drops the inner one, React
  fails to hydrate, and every button on the page stops working — not just the
  nested one.

## State as of this handover

- Branch `fix/supabase-deploy`, deployed to production.
- 340 tests, lint and build clean.
- 27 migrations in the folder, 27 recorded in the database.
- Two tenant accounts exist, so cross-tenant isolation is now testable for the
  first time — it has not been tested.
- `ANTHROPIC_API_KEY` is not set, so scanned invoices with no text layer come
  back as a form to fill in rather than being read.
- The operator is **Mobimetry sp. z o.o.**, named in `LEGAL_ENTITY`
  (`src/lib/legal.ts`) and from there in the privacy notice, the terms, the
  site footer and the structured data. On file: registered address (pl.
  Tadeusza Kościuszki 5 m. 1A, 50-029 Wrocław), KRS 0001265140, NIP
  8971978439, REGON 545676014 (the last two checksum-verified by the tests) and
  the registry court (Wrocław-Fabryczna, VI Wydział Gospodarczy KRS).
  Still owed, and rendered as nothing until they arrive: **contact email** and
  **share capital**. `LEGAL_ENTITY_MISSING` lists them. The registered postal
  address is on the page, so a data subject has a contact channel meanwhile.
- The REGON supplied was `54567601400000`, which is the nine-digit one padded
  to a fourteen-character field and fails the fourteen-digit checksum. What is
  published is the nine-digit `545676014`, which passes.
- The terms still choose **Greek law and the courts of Athens**, decided when
  the operator was assumed to be Greek. It is a lawful choice for a Polish
  company serving Greek businesses, but it is now a choice rather than the
  obvious default — worth a lawyer's eye before the first dispute.
