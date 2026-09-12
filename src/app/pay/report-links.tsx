'use client';

import { useEffect, useRef, useState } from 'react';

import type { PayCopy } from './copy';

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
 * component follows. Every word comes from `t`, resolved on the server to the
 * language the reminder that linked here was written in.
 */

type Kind = 'paid_claim' | 'dispute';
type Msg = { role: 'user' | 'assistant'; content: string };
type Phase = 'chat' | 'form' | 'done' | 'failed';

const titleFor = (t: PayCopy, kind: Kind) => (kind === 'paid_claim' ? t.paidClaim : t.dispute);

const linkClass =
  'text-ink-500 underline decoration-ink-300 underline-offset-2 transition hover:text-ink-800';

export function ReportLinks({ token, t }: { token: string; t: PayCopy }) {
  const [kind, setKind] = useState<Kind | null>(null);

  return (
    <div className="mt-4 border-t border-ink-100 pt-3">
      {/* These are the only two things a customer can do here other than pay.
          They were 16px tall and squeezed side by side; on a phone they now sit
          one above the other with a real tap area each. */}
      {kind === null ? (
        <div className="flex flex-col items-center gap-1 text-center text-sm sm:flex-row sm:justify-center sm:gap-4">
          <button
            type="button"
            onClick={() => setKind('paid_claim')}
            className={`inline-flex min-h-11 items-center px-2 ${linkClass}`}
          >
            {t.paidClaim}
          </button>
          <span aria-hidden className="hidden text-ink-300 sm:inline">
            ·
          </span>
          <button
            type="button"
            onClick={() => setKind('dispute')}
            className={`inline-flex min-h-11 items-center px-2 ${linkClass}`}
          >
            {t.dispute}
          </button>
        </div>
      ) : (
        <ReportPanel token={token} kind={kind} t={t} onClose={() => setKind(null)} />
      )}
    </div>
  );
}

function ReportPanel({
  token,
  kind,
  t,
  onClose,
}: {
  token: string;
  kind: Kind;
  t: PayCopy;
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
        <p className="text-sm font-medium text-ink-900">{titleFor(t, kind)}</p>
        <button
          type="button"
          onClick={onClose}
          aria-label={t.close}
          className="-mr-2 inline-flex h-11 w-11 items-center justify-center text-ink-400 transition hover:text-ink-700"
        >
          ✕
        </button>
      </div>

      {phase === 'form' ? (
        <ReportForm token={token} kind={kind} t={t} onDone={() => setPhase('done')} />
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
              {t.reportSent}
            </p>
          ) : (
            <form
              className="mt-3 flex gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                void send();
              }}
            >
              {/* 16px on a phone, or iOS zooms the whole page in on focus and
                  the visitor has to pinch back out to read their own answer. */}
              <input
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                maxLength={1200}
                autoFocus
                placeholder={t.writeHere}
                aria-label={t.yourMessage}
                className="min-w-0 flex-1 rounded-lg border border-ink-300 px-3 py-2 text-base outline-none focus-visible:ring-2 focus-visible:ring-brand-500 sm:text-sm"
              />
              <button
                type="submit"
                disabled={busy || !draft.trim()}
                className="rounded-lg bg-ink-900 px-3.5 py-2 text-sm font-medium text-white transition enabled:hover:bg-ink-700 disabled:opacity-40"
              >
                {t.send}
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
  t,
  onDone,
}: {
  token: string;
  kind: Kind;
  t: PayCopy;
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
        {kind === 'paid_claim' ? t.howAndWhen : t.whatIsWrong}
        <textarea
          name="message"
          required
          rows={3}
          maxLength={2000}
          className="mt-1 w-full rounded-lg border border-ink-300 px-3 py-2 text-base text-ink-800 outline-none focus-visible:ring-2 focus-visible:ring-brand-500 sm:text-sm"
        />
      </label>

      {/* One column on a phone: side by side each field was about 120px,
          narrower than iOS renders a date input, and both clipped. */}
      {kind === 'paid_claim' ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="block text-xs text-ink-500">
            {t.paidOn}
            <input
              type="date"
              name="paid_on"
              className="mt-1 min-h-11 w-full rounded-lg border border-ink-300 px-3 py-2 text-base outline-none focus-visible:ring-2 focus-visible:ring-brand-500 sm:min-h-0 sm:text-sm"
            />
          </label>
          <label className="block text-xs text-ink-500">
            {t.amount}
            <input
              name="amount"
              inputMode="decimal"
              placeholder={t.amountPlaceholder}
              className="mt-1 min-h-11 w-full rounded-lg border border-ink-300 px-3 py-2 text-base outline-none focus-visible:ring-2 focus-visible:ring-brand-500 sm:min-h-0 sm:text-sm"
            />
          </label>
          {/* `col-span-2` in a one-column grid spanned a column that is not
              there, and the field went missing on a phone. */}
          <label className="block text-xs text-ink-500 sm:col-span-2">
            {t.referenceOptional}
            <input
              name="reference"
              maxLength={200}
              className="mt-1 min-h-11 w-full rounded-lg border border-ink-300 px-3 py-2 text-base outline-none focus-visible:ring-2 focus-visible:ring-brand-500 sm:min-h-0 sm:text-sm"
            />
          </label>
        </div>
      ) : (
        <label className="block text-xs text-ink-500">
          {t.contactOptional}
          <input
            name="contact"
            maxLength={200}
            className="mt-1 min-h-11 w-full rounded-lg border border-ink-300 px-3 py-2 text-base outline-none focus-visible:ring-2 focus-visible:ring-brand-500 sm:min-h-0 sm:text-sm"
          />
        </label>
      )}

      {failed ? (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{t.submitFailed}</p>
      ) : null}

      <button
        type="submit"
        disabled={busy}
        className="min-h-11 w-full rounded-lg bg-ink-900 px-3.5 py-2 text-sm font-medium text-white transition enabled:hover:bg-ink-700 disabled:opacity-40"
      >
        {busy ? t.submitting : t.submit}
      </button>
    </form>
  );
}
