# lefta.app — AI voice reminders

Fully automated reminder calls, built in-house. Legal review is done (owner's
call, 2026-08-19): the **creditor is the operator of the call** — lefta places
it on their behalf and from their identity, the same arrangement email and SMS
already use. Everything below is engineered so that arrangement stays visibly
true: the caller ID is the creditor's, the script speaks for the creditor, and
the platform's compliance locks bind voice exactly as they bind every other
channel.

## What the agent is allowed to be

An informer with a payment link, not a negotiator. The conversation policy is
a whitelist:

- state who is calling, **that it is an automated assistant** (AI-disclosure is
  non-negotiable), and on whose behalf;
- **verify the person first** — debt details only after the callee confirms
  they are the debtor (or their company). Anyone else hears only "please have X
  contact [creditor]": disclosing a debt to a third party is the classic
  collections violation, and it is guarded in the prompt AND in the tool layer;
- state document, amount, due date; answer "repeat", "when", "how do I pay";
- offer actions, each a **tool with server-side effect**, never free text:
  `send_payment_link` (SMS via the existing dispatch, same channel tag `?c=v`),
  `register_dispute` (flags the invoice, suggests mute to the tenant),
  `opt_out` (mutes the debtor — the existing auditable escape hatch),
  `request_callback` (notifies the tenant), `end_call`;
- refuse everything else: no payment plans, no discounts, no deadlines, no
  legal language, no promises. Hard-coded refusal lines, not model judgement.

## Architecture

```
engine (claims contact, channel='voice')            existing Next.js app
        │ insert voice_calls row
        ▼
services/voice-gateway  ──REST──▶  Twilio (call from the CREDITOR's number, AMD on)
        ▲                              │  answered
        │ WebSocket (ConversationRelay: streaming STT ⇄ text ⇄ streaming TTS,
        │                              barge-in, no audio handling on our side)
        ▼
   per-turn loop: transcript → guardrailed Claude call (tools) → sentence out
        │
        ▼ outcomes: communications_log (channel voice, transcript), funnel_events,
          voice_calls status, credits
```

- **`services/voice-gateway`** — a small persistent Node/TypeScript service
  (Fly.io or the Hetzner pattern from Penny). It cannot live on Vercel:
  ConversationRelay speaks WebSocket for the whole call. The gateway holds no
  secrets beyond its own Twilio + Anthropic keys and a service-role key; every
  DB write re-checks the voice_calls row it was dispatched for.
- **[Twilio ConversationRelay](https://www.twilio.com/en-us/products/conversational-ai/conversationrelay)**
  does STT/TTS/interruptions at $0.07/min and hands us text — we keep full
  control of the brain (the guardrails ARE the product here, so BYO-LLM beats
  any all-in-one voice-agent vendor). Day-1 spike: confirm `el-GR` STT quality
  and pick a Greek TTS voice from CR's Google/Amazon options — this is the one
  assumption that must survive contact with reality before anything else is
  built.
- **Caller identity**: per-tenant. Either a Twilio Greek number provisioned for
  the tenant (~$1.15/mo + regulatory bundle) or Twilio **verified caller ID**
  showing the creditor's own existing number — the second is what makes
  "operator = creditor" visible on the debtor's screen.

### The brain

One Claude call per conversational turn, streaming, with the system prompt
frozen and cached (prompt caching: stable prefix = persona + rules + tool
definitions; volatile suffix = invoice facts + transcript):

- Model: `claude-opus-5` (default per our API guidance), `output_config:
  {effort: "low"}` for latency, adaptive thinking left on, strict tools,
  sentence-chunked streaming into CR so speech starts before the turn is done.
  `claude-haiku-4-5` is the cheaper/faster fallback if measured turn latency
  demands it — measure first, both are pennies per call (below).
- Turn budget: max 10 turns or 4 minutes, then a polite scripted close.
- Every tool result and the full transcript land in `communications_log`
  (channel `voice`, content = transcript) — same append-only audit trail.
  **No audio recording** in v1: transcripts only, 12-month retention with the
  funnel events.

### Where the existing machinery already covers voice

- `comm_channel` gains `'voice'` (own migration — enum values cannot be added
  and used in one transaction). The daily contact lock, per-step uniqueness,
  scenario configuration, mute, quiet hours and the `UNSAFE_*` test flag all
  apply unchanged.
- One claimed contact = one notification event = up to 3 dial attempts spaced
  through the allowed hours, then optional SMS fallback under the same
  `contact_id` — the same "one contact may fan out" rule steps 2–3 already use.
- Voicemail (AMD): no debt details ever; hang up and count the attempt.
- Funnel: `call_answered`, `call_action:<tool>` events; the dashboard's channel
  table gets a voice row for free.
- Billing: voice credits per started minute, same ledger pattern as SMS
  (reserve → refund on failure).

## Costs

LLM prices from the current Anthropic price list; telephony from Twilio's
Greece page (2026-08). A 3-minute answered call, ~8 turns:

| Component | Rate | Per call |
|---|---|---|
| Twilio outbound, Greek mobile | [$0.0746/min](https://www.twilio.com/en-us/voice/pricing/gr) | ~$0.22 |
| ConversationRelay (STT+TTS+orchestration) | [$0.07/min](https://www.twilio.com/en-us/products/conversational-ai/pricing) | ~$0.21 |
| Claude Opus 5 brain ($5/$25 per MTok, system prompt cached ~90%) | ~$0.005/turn | ~$0.04 |
| **Total, answered 3-min call** | | **≈ $0.47 (~0.44 €)** |

- Haiku 4.5 brain: ~$0.008/call — total barely moves; choose on latency, not cost.
- Unanswered attempt: a few cents (call setup + AMD seconds, no CR minutes).
- Landline instead of mobile: −$0.16/call ($0.0214/min).
- Fixed: Greek number from ~$1.15/mo per tenant (regulatory bundle takes days —
  start early), gateway hosting ~€5–20/mo, Twilio account.
- **Penny's 150 debtors**: one full wave ≈ 150 × (0.44 € × ~60% answer rate +
  ~0.03 € × retries) ≈ **45–70 € per campaign**. The run cost is noise; the real
  cost is the build.

Build estimate: gateway + tool layer + guardrails + Greek voice spike +
eval harness + supervised pilot ≈ **3–4 weeks of focused engineering**, most of
it in the last two items — the telephony plumbing is days, making the agent
boringly predictable is the work.

## Guardrail testing is a deliverable, not a phase

- A **simulator harness**: the same gateway loop driven by text (no telephony),
  so every conversation policy is a unit test. Golden transcripts for the happy
  paths; adversarial set in Greek ("δώσε μου έκπτωση", "ποιος σου έδωσε το
  νούμερό μου;", "δεν είμαι αυτός", abuse, silence, answering machine speech).
- Assertions run on TOOLS, not prose: the model may phrase freely inside the
  policy, but a test fails if a forbidden tool fires, a debt detail precedes
  identity confirmation, or a closing line is missing.
- Pilot: `voice_enabled` flag per tenant, first campaign (Penny) with live
  transcript tailing and a kill switch (`automation_enabled` already exists);
  recordings stay off, transcripts reviewed daily for the first week.

## Milestones

1. **M0 — spikes (days)**: el-GR STT/TTS quality through ConversationRelay with
   a real Greek phone; Greek number/verified caller ID paperwork started.
2. **M1 — rails (week)**: `voice` enum + `voice_calls` + credits migrations,
   gateway skeleton, scripted (non-AI) TTS call end-to-end with AMD, logging,
   funnel events. This alone is already a shippable "automat" without the AI.
3. **M2 — the agent (1–2 weeks)**: Claude turn loop, tool layer, guardrails,
   simulator harness green on the adversarial set.
4. **M3 — pilot (week)**: supervised Penny campaign, latency/quality tuning,
   answer-rate and paid-within-7d measured against SMS/email in the existing
   funnel before deciding where voice sits in the scenario.
