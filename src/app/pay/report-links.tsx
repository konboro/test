'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * The two quiet exits from the payment page.
 *
 * A debtor who already paid by transfer, or who thinks the document is wrong,
 * used to have exactly nothing to press — and got tomorrow's reminder anyway.
 * These links file a report with the creditor and pause the chasing for this
 * document while it is reviewed.
 *
 * Deliberately understated: the page's job is still the payment, and these
 * exist for the visitor who cannot use the button, not to compete with it.
 *
 * The panel is a chat when the server offers one and a plain form when it does
 * not (no model configured, or a call failed) — the server decides, this
 * component follows. Greek hardcoded, like every other string on this page.
 */

type Kind = 'paid_claim' | 'dispute';
type Msg = { role: 'user' | 'assistant'; content: string };
type Phase = 'chat' | 'form' | 'done' | 'failed';

const TITLES: Record<Kind, string> = {
  paid_claim: 'Έχω ήδη πληρώσει',
  dispute: 'Υπάρχει πρόβλημα με το παραστατικό',
};

const linkClass =
  'text-ink-500 underline decoration-ink-300 underline-offset-2 transition hover:text-ink-800';

export function ReportLinks({ token }: { token: string }) {
  const [kind, setKind] = useState<Kind | null>(null);

  return (
    <div className="mt-4 border-t border-ink-100 pt-3">
      {kind === null ? (
        <p className="flex items-center justify-center gap-4 text-center text-xs">
          <button type="button" onClick={() => setKind('paid_claim')} className={linkClass}>
            {TITLES.paid_claim}
          </button>
          <span aria-hidden className="text-ink-300">
            ·
          </span>
          <button type="button" onClick={() => setKind('dispute')} className={linkClass}>
            {TITLES.dispute}
          </button>
        </p>
      ) : (
        <ReportPanel token={token} kind={kind} onClose={() => setKind(null)} />
      )}
    </div>
  );
}

function ReportPanel({
  token,
  kind,
  onClose,
}: {
  token: string;
  kind: Kind;
  onClose: () => void;
}) {
  const [phase, setPhase] = useState<Phase>('chat');
  const [messages, setMessages] = useState<Msg[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);

  const post = async (body: object) => {
    const response = await fetch('/api/pay/report', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, kind, messages: [], ...body }),
    });
    if (!response.ok) throw new Error(String(response.status));
    return (await response.json()) as {
      reply?: string;
      done?: boolean;
      mode?: 'form';
    };
  };

  // The greeting: canned server-side, so the panel opens instantly. `mode:
  // 'form'` here means no model is configured and the plain form takes over.
  useEffect(() => {
    // A conversation that already has content keeps it — the greeting is only
    // for a panel that just opened empty.
    if (messages.length) return;

    let cancelled = false;

    post({})
      .then((data) => {
        if (cancelled) return;
        if (data.mode === 'form') setPhase('form');
        else if (data.reply) setMessages([{ role: 'assistant', content: data.reply }]);
      })
      .catch(() => {
        if (!cancelled) setPhase('form');
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind]);

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight });
  }, [messages, busy]);

  const send = async () => {
    const content = draft.trim();
    if (!content || busy) return;

    const next: Msg[] = [...messages, { role: 'user', content }];
    setMessages(next);
    setDraft('');
    setBusy(true);

    try {
      const data = await post({ messages: next });

      if (data.mode === 'form') {
        setPhase('form');
      } else if (data.reply) {
        setMessages([...next, { role: 'assistant', content: data.reply }]);
        if (data.done) setPhase('done');
      }
    } catch {
      setPhase('form');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-xl border border-ink-200 bg-white p-4 text-left">
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm font-medium text-ink-900">{TITLES[kind]}</p>
        <button
          type="button"
          onClick={onClose}
          aria-label="Κλείσιμο"
          className="text-ink-400 transition hover:text-ink-700"
        >
          ✕
        </button>
      </div>

      {phase === 'form' ? (
        <ReportForm token={token} kind={kind} onDone={() => setPhase('done')} />
      ) : (
        <>
          <div ref={scroller} className="mt-3 max-h-64 space-y-2 overflow-y-auto pr-1">
            {messages.map((message, index) => (
              <p
                key={index}
                className={
                  message.role === 'assistant'
                    ? 'mr-6 rounded-lg rounded-tl-sm bg-ink-50 px-3 py-2 text-sm text-ink-800'
                    : 'ml-6 rounded-lg rounded-tr-sm bg-brand-600 px-3 py-2 text-sm text-white'
                }
              >
                {message.content}
              </p>
            ))}
            {busy ? <p className="mr-6 px-3 text-sm text-ink-400">…</p> : null}
          </div>

          {phase === 'done' ? (
            <p className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-center text-xs text-emerald-800">
              Η δήλωσή σας καταχωρήθηκε και ο εκδότης ενημερώθηκε.
            </p>
          ) : (
            <form
              className="mt-3 flex gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                void send();
              }}
            >
              <input
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                maxLength={1200}
                autoFocus
                placeholder="Γράψτε εδώ…"
                aria-label="Το μήνυμά σας"
                className="min-w-0 flex-1 rounded-lg border border-ink-300 px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
              />
              <button
                type="submit"
                disabled={busy || !draft.trim()}
                className="rounded-lg bg-ink-900 px-3.5 py-2 text-sm font-medium text-white transition enabled:hover:bg-ink-700 disabled:opacity-40"
              >
                Αποστολή
              </button>
            </form>
          )}
        </>
      )}
    </div>
  );
}

/**
 * The dependable door: the same facts through a plain form, filed by the same
 * server path. Shown when no model is configured or a model call failed —
 * a visitor mid-statement is never turned away with an error.
 */
function ReportForm({
  token,
  kind,
  onDone,
}: {
  token: string;
  kind: Kind;
  onDone: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;

    const data = new FormData(event.currentTarget);
    const form = {
      message: String(data.get('message') ?? '').trim(),
      paid_on: String(data.get('paid_on') ?? '') || undefined,
      amount: String(data.get('amount') ?? '').trim() || undefined,
      reference: String(data.get('reference') ?? '').trim() || undefined,
      contact: String(data.get('contact') ?? '').trim() || undefined,
    };
    if (!form.message) return;

    setBusy(true);
    setFailed(false);

    try {
      const response = await fetch('/api/pay/report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, kind, messages: [], form }),
      });
      if (!response.ok) throw new Error(String(response.status));
      onDone();
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="mt-3 space-y-3">
      <label className="block text-xs text-ink-500">
        {kind === 'paid_claim' ? 'Πώς και πότε πληρώσατε;' : 'Τι δεν συμφωνεί;'}
        <textarea
          name="message"
          required
          rows={3}
          maxLength={2000}
          className="mt-1 w-full rounded-lg border border-ink-300 px-3 py-2 text-sm text-ink-800 outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
        />
      </label>

      {kind === 'paid_claim' ? (
        <div className="grid grid-cols-2 gap-3">
          <label className="block text-xs text-ink-500">
            Ημερομηνία πληρωμής
            <input
              type="date"
              name="paid_on"
              className="mt-1 w-full rounded-lg border border-ink-300 px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
            />
          </label>
          <label className="block text-xs text-ink-500">
            Ποσό
            <input
              name="amount"
              inputMode="decimal"
              placeholder="π.χ. 455,00"
              className="mt-1 w-full rounded-lg border border-ink-300 px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
            />
          </label>
          <label className="col-span-2 block text-xs text-ink-500">
            Αιτιολογία ή τράπεζα (προαιρετικά)
            <input
              name="reference"
              maxLength={200}
              className="mt-1 w-full rounded-lg border border-ink-300 px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
            />
          </label>
        </div>
      ) : (
        <label className="block text-xs text-ink-500">
          Τρόπος επικοινωνίας για την απάντηση (προαιρετικά)
          <input
            name="contact"
            maxLength={200}
            className="mt-1 w-full rounded-lg border border-ink-300 px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
          />
        </label>
      )}

      {failed ? (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">
          Η καταχώρηση δεν ολοκληρώθηκε. Δοκιμάστε ξανά.
        </p>
      ) : null}

      <button
        type="submit"
        disabled={busy}
        className="w-full rounded-lg bg-ink-900 px-3.5 py-2 text-sm font-medium text-white transition enabled:hover:bg-ink-700 disabled:opacity-40"
      >
        {busy ? 'Καταχώρηση…' : 'Καταχώρηση'}
      </button>
    </form>
  );
}
