# The payment page stops being a dead end

The page had exactly one verb: pay. A debtor who already paid by transfer had
no way to say so; a debtor who thinks the invoice is wrong had none either.
Both got tomorrow's reminder — and being chased for money you have already
sent, by a small company you know personally, is the single fastest way for
this product to make its own customer look bad.

Two quiet links under the payment button fix that:

* **«Έχω ήδη πληρώσει»** — I already paid
* **«Υπάρχει πρόβλημα με το παραστατικό»** — something is wrong

Either one opens a short conversation that collects the facts, files a
**report** against the invoice, pauses the chasing, and emails the creditor.
The debtor needs no account and gets no access: the payment credential they
already hold is the only key, and it can do nothing but pay this one document
or attach a report to it.

## What a report is

One row in `invoice_reports`: which invoice, which kind (`paid_claim` or
`dispute`), what was said (a structured `details` object plus the verbatim
transcript), and a lifecycle (`open → resolved | dismissed`). At most **one
open report per invoice and kind** — enforced by a partial unique index, which
is also the anti-spam mechanism: the anonymous endpoint cannot be used to pile
up rows.

While a report is open:

* the nightly sweep **skips the invoice** (`open paid_claim report`), exactly
  as it skips a muted debtor or a snoozed promise;
* the manual reminder button **refuses**, with the reason and the place to
  resolve it — a button that quietly overrides "I already paid" would make the
  whole feature a lie.

This is an abuse trade-off made consciously: yes, a debtor can pause their own
reminders by claiming payment. But the claim lands on the creditor's desk the
same minute, resolution is one click, and the alternative — keep chasing
someone who says they paid — costs more than a day of silence ever will.

## The conversation

A chat, because the two facts we need ("when, how, roughly what reference" or
"what exactly is wrong") arrive as prose from people who would abandon a
seven-field form. It runs on Claude (`claude-opus-5`), with:

* a system prompt that knows only what the payment page already shows —
  document number, amounts, dates, the two names. It can record and ask; it
  cannot negotiate, promise, discount, or discuss anything else;
* one strict tool, `submit_report`. When the model has enough, it calls the
  tool; the server validates the payload, writes the report, notifies, and the
  model says goodbye. The model never writes to the database — it asks the
  server to, through a schema;
* hard caps: 16 turns, 1 200 characters per message, small `max_tokens`. The
  transcript travels from the browser each turn, so the server holds no
  session state;
* server-side refusal fallbacks enabled (`fallbacks: "default"`), so a
  spurious safety decline degrades to a sibling model instead of an error.

**No API key, or Claude down → a plain form** with the same fields, posting to
the same submit path. The feature's availability does not depend on the AI;
the AI is the pleasant way in, not the only one.

The greeting is canned (server-side, no model call), so opening the panel is
instant and free; the first billed call happens when the visitor actually
writes.

## The bank feed already knows

A `paid_claim` naming a date and an amount is checked against
`bank_transactions` at submit time: unmatched or in-review credits within 2%
of the claimed (or invoice) amount, booked on or after the claimed date. Up to
three candidates are stored on the report and shown to the creditor —
"they say they paid €455 on the 3rd; there is an unmatched €455 credit from
the 4th" is usually the whole review.

## The creditor's side

Open reports surface at the top of the invoices screen, newest first, with the
summary, the collected details, the bank-feed hint, and two buttons:

* `paid_claim`: **Επιβεβαίωση εξόφλησης** (settles the invoice and resolves
  the report) or **Απόρριψη** (chasing resumes tomorrow);
* `dispute`: **Επιλύθηκε** or **Απόρριψη**.

Rows with an open report carry a badge. All mutations go through server
actions under the service role with explicit ownership checks — the table
accepts no writes from browsers at all; reading is RLS-scoped to the active
company like everything else.

An email goes to the creditor the moment a report is filed. This data —
"the debtor claims payment" / "the debtor disputes" — exists nowhere else in
the market these SMEs live in, and it arrives labelled and structured.

## Deliberately not here

* **File uploads** (the transfer confirmation PDF). Wants the storage bucket,
  signed URLs and an antivirus stance; the structured claim plus the bank feed
  covers the review need today.
* **Debtor-facing status** ("your report was accepted"). Needs a way to reach
  the debtor that is not the reminder ladder; later.
* **Funnel events for reports.** The `funnel_events` check constraint knows
  two events; widening it is its own small migration when we want the metric.
