# SMS handoff — Brevo

For whoever owns `fix/supabase-deploy`. Written by a parallel session that did the SMS
transport while you were building the portal. **Delete this file once you have merged.**

Short version: merge **PR #5** into your branch. It is PR #4 plus one line that the merge
does not fix by itself, and without that line the panel cannot send.

---

## The part that will not announce itself

`src/lib/providers.ts` gates the SMS channel on `YUBOTO_API_KEY`. The transport no longer
uses Yuboto, so that variable does not exist anywhere after the switch.

Nothing tells you the two disagree. **The merge is clean, `tsc` is happy, and every test
passes.** In production `smsAvailable()` just returns `false` forever: the panel refuses to
send, the sweep skips the channel, `providerStatus()` reports `sms: false`, and the
transport underneath works perfectly. A real SMS has already been delivered through
`sendSms()` end to end, so the failure is purely this gate.

That silence is deliberate elsewhere in that file — an unconfigured provider makes a
channel *unavailable* rather than *failing*, so a ladder rung is never burned on a message
that could not be sent. It is the right behaviour reading the wrong variable.

```diff
 export function smsAvailable(): boolean {
-  return Boolean(optionalEnv('YUBOTO_API_KEY')) || dryRunMode();
+  return Boolean(optionalEnv('BREVO_API_KEY')) || dryRunMode();
 }
```

The three `vi.stubEnv('YUBOTO_API_KEY', …)` calls in `engine.test.ts` move with it. Left
alone they keep passing while describing a production that cannot send.

Both changes are already in PR #5.

---

## Merging

Through the PR, or locally:

```bash
git checkout fix/supabase-deploy
git merge --no-ff integration/sms-brevo
npm ci && npm run typecheck && npm test    # 101 passing on the merged tree
```

`src/lib/sms/` is otherwise untouched on your branch, so there is nothing else to
reconcile.

---

## What the transport does now

`POST https://api.brevo.com/v3/transactionalSMS/sms`, `api-key` header, JSON body. Only
`dispatch()` knows that much — `sendSms`, `normalisePhone` and `segmentCount` keep their
signatures, so moving to Twilio or a Greek aggregator later is one function.

Two details in Brevo's contract that would otherwise have been silent bugs:

**`unicodeEnabled` defaults to `false`.** Left alone it transliterates every Greek reminder
this product sends. It is derived from the content through `usesUnicode()`, which
`segmentCount()` also uses, so the encoding rule has one definition instead of two that
drift apart. Verified live with Greek content.

**`type` is pinned to `transactional`.** Not cosmetic: marketing SMS carries consent and
quiet-hours obligations that payment reminders are exempt from. A drift here is a
compliance problem, not a formatting one.

### Why Brevo and not Twilio

Cheapest way to reach a real Greek handset today — credits sell in packs of 100 and never
expire. Twilio needs a ~$20 upgrade before an alphanumeric sender works at all, and since
Greece is alphanumeric-only there, a Twilio trial cannot reach Greece at all. Vonage's
trial only reaches verified numbers and appends its own text to the body, which is fatal
against a 70-character UCS-2 limit. AWS caps new accounts at $1/month until support lifts
it.

AWS is the better long-term home — Greece needs no sender-ID registration there and
two-way SMS is supported, so real `STOP` handling becomes possible — but it cannot be
switched on today. `feat/sms-twilio` is a complete working Twilio implementation if Brevo's
deliverability to Greek operators disappoints; PR #3 is closed but the branch is intact.

---

## Environment — already done, no action needed

`BREVO_API_KEY` and `SMS_SENDER_ID` are set in Vercel for **Production and Preview**.
`YUBOTO_API_KEY` was never set in either, which is why nothing has been sending.

Note the project is **not connected to GitHub** — deploys go through the CLI. Merging will
not ship anything by itself.

---

## Verified so far

- One real SMS sent through `sendSms()` to a live handset: `accepted → sent → delivered`
  in 2 s, Greek content, 1 credit consumed.
- Endpoint confirmed against the live API. Both `/transactionalSMS/sms` and
  `/transactionalSMS/send` exist; an invented path returns 404, so the 400 both real paths
  return is meaningful. (Probing without a key proves nothing — Brevo answers 401 to
  everything unauthenticated, including invented paths.)
- Merged tree: `tsc` clean, 101 tests passing.

**Not verified:** deliverability to Greek operators. The live test went to a Polish number,
so how Cosmote, Vodafone and Nova treat the `lefta` sender ID is still unknown. That only
resolves on the first send to a Greek handset.

---

## Yours to decide

`UNSAFE_DISABLE_CONTACT_LIMITS` is set in Production. Your own banner copy says to remove
it before anything reaches a real customer. It is genuinely useful while delivery is being
set up — that is what it is for — but it stops being harmless in the same minute the panel
can actually send.

---

## Also waiting: PR #2

Unrelated to SMS, same reviewer. Short payment links (`lefta.app/<code>` instead of
`/pay/<48 hex>`), which matters most in SMS, where the old URL ate a third of a segment.
It carries two collisions of the same kind as the one above — clean merges that silently
drop the feature:

1. You moved link building to `src/lib/dunning/dispatch.ts`; that PR edits the old line in
   `engine.ts`, which no longer exists on your branch. Both sides merge happily and nothing
   uses the short links. After merging, `dispatch.ts` needs
   `payPath(invoice.short_code ?? invoice.pay_token)`.
2. `supabase/migrations/20260816090000_tenant_stripe_key.sql` re-creates
   `get_invoice_for_payment` and sorts *after* that PR's migration, reverting the
   `short_code` match so every short link 404s. Either renumber, or fold
   `where i.short_code = p_token or i.pay_token = p_token` into your definition.

Full detail is in the PR #2 comment thread.
