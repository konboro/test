'use client';

import { useState, useTransition } from 'react';

import { Button } from '@/components/ui';
import { useT } from '@/lib/i18n/provider';

import { approveScanRule, rejectScanRule, withdrawScanRule } from './scan-rule-actions';

export interface ScanRuleView {
  id: string;
  status: 'proposed' | 'approved';
  /** What the layout is, in words a person can recognise. */
  parts: string[];
  field: string;
  wrong: string | null;
  right: string | null;
  context: string[];
  seenCount: number;
}

/**
 * What the reader is asking to be taught, and what it has been taught.
 *
 * The whole point of this screen is that nothing on it is in force until
 * somebody presses a button. A proposal is evidence and a suggestion; an
 * approval is a decision, recorded with a name against it, and reversible.
 */
export function ScanRules({ rules }: { rules: ReadonlyArray<ScanRuleView> }) {
  const t = useT();
  const [pending, start] = useTransition();
  const [note, setNote] = useState<string | null>(null);

  const run = (action: () => Promise<{ error?: string; success?: string }>) =>
    start(async () => {
      const result = await action();
      setNote(result.error ?? result.success ?? null);
    });

  const proposed = rules.filter((rule) => rule.status === 'proposed');
  const approved = rules.filter((rule) => rule.status === 'approved');

  if (rules.length === 0) {
    return (
      <p className="px-4 py-6 text-sm text-ink-500 sm:px-5">{t.scanRules.empty}</p>
    );
  }

  const card = (rule: ScanRuleView) => (
    <li key={rule.id} className="px-4 py-4 sm:px-5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <p className="text-sm font-medium text-ink-900">{t.scanRules.field(rule.field)}</p>
        {rule.status === 'proposed' ? (
          <p className="text-xs text-ink-500">{t.scanRules.seen(rule.seenCount)}</p>
        ) : null}
      </div>

      {/* What it would change, stated as the correction it came from. */}
      <p className="tabular mt-1.5 break-words text-sm text-ink-700">
        <span className="text-ink-400 line-through">{rule.wrong ?? '—'}</span>
        <span className="px-2 text-ink-400">→</span>
        <span className="font-medium text-ink-900">{rule.right ?? '—'}</span>
      </p>

      {rule.context.length ? (
        <pre className="mt-2 overflow-x-auto rounded-lg bg-ink-50 px-3 py-2 text-xs leading-relaxed text-ink-600">
          {rule.context.join('\n')}
        </pre>
      ) : null}

      <p className="mt-2 text-xs text-ink-500">{t.scanRules.appliesTo(rule.parts.join(', '))}</p>

      <div className="mt-3 flex flex-wrap gap-2">
        {rule.status === 'proposed' ? (
          <>
            <Button
              type="button"
              disabled={pending}
              onClick={() => run(() => approveScanRule(rule.id))}
            >
              {t.scanRules.approve}
            </Button>
            <Button
              type="button"
              variant="secondary"
              disabled={pending}
              onClick={() => run(() => rejectScanRule(rule.id))}
            >
              {t.scanRules.reject}
            </Button>
          </>
        ) : (
          <Button
            type="button"
            variant="secondary"
            disabled={pending}
            onClick={() => run(() => withdrawScanRule(rule.id))}
          >
            {t.scanRules.withdraw}
          </Button>
        )}
      </div>
    </li>
  );

  return (
    <div>
      {note ? (
        <p role="status" className="border-b border-ink-100 px-4 py-2.5 text-sm text-ink-700 sm:px-5">
          {note}
        </p>
      ) : null}

      {proposed.length ? (
        <>
          <p className="border-b border-ink-100 bg-ink-50/60 px-4 py-2 text-xs font-medium uppercase tracking-wide text-ink-500 sm:px-5">
            {t.scanRules.waiting}
          </p>
          <ul className="divide-y divide-ink-100">{proposed.map(card)}</ul>
        </>
      ) : null}

      {approved.length ? (
        <>
          <p className="border-y border-ink-100 bg-ink-50/60 px-4 py-2 text-xs font-medium uppercase tracking-wide text-ink-500 sm:px-5">
            {t.scanRules.inForce}
          </p>
          <ul className="divide-y divide-ink-100">{approved.map(card)}</ul>
        </>
      ) : null}
    </div>
  );
}
