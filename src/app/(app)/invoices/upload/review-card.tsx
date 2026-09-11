'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';

import { Badge, Button, Field, inputClass } from '@/components/ui';
import { DEFAULT_CURRENCY, SUPPORTED_CURRENCIES } from '@/lib/currency';
import { useT } from '@/lib/i18n/provider';

import type { Scenario } from '@/lib/dunning/scenario';

import { InvoiceScenarioEditor } from '../scenario-editor';
import { commitUpload, discardUpload, type UploadState } from './actions';

export interface Proposal {
  id: string;
  filename: string;
  source: 'pdf_text' | 'vision' | 'manual';
  missing: string[];
  problem: string | null;
  fileUrl: string | null;
  fields: {
    debtorName: string | null;
    vatNumber: string | null;
    invoiceNumber: string | null;
    issueDate: string | null;
    dueDate: string | null;
    amount: string | null;
    currency: string | null;
    email: string | null;
    phone: string | null;
  };
}

function Commit() {
  const t = useT();
  const { pending } = useFormStatus();

  return (
    <Button type="submit" disabled={pending}>
      {pending ? t.upload.committing : t.upload.commit}
    </Button>
  );
}

/**
 * One document, and what we think it says.
 *
 * Every field is editable and nothing is pre-confirmed. A reading that came from
 * a scan is labelled as such, and a field we could not find is marked rather
 * than left as a confident blank — the operator needs to be able to tell "we read
 * this" from "we guessed" at a glance, because they are about to turn it into a
 * demand for money.
 */
export function ReviewCard({
  proposal,
  scenario,
  notice,
}: {
  proposal: Proposal;
  scenario: Scenario;
  /** The notice wording, for the quick editor — see InvoiceScenarioEditor. */
  notice?: { emailSubject: string; emailBody: string; smsBody: string };
}) {
  const t = useT();
  const [state, action] = useActionState<UploadState, FormData>(commitUpload, {});

  const missing = new Set(proposal.missing);
  const flag = (field: string) => (missing.has(field) ? 'ring-1 ring-amber-400' : '');

  const sourceLabel =
    proposal.source === 'pdf_text'
      ? t.upload.sourcePdf
      : proposal.source === 'vision'
        ? t.upload.sourceVision
        : t.upload.sourceManual;

  return (
    <div className="rounded-xl border border-ink-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-ink-900">{proposal.filename}</p>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <Badge tone={proposal.source === 'pdf_text' ? 'positive' : 'warning'}>
              {sourceLabel}
            </Badge>
            {proposal.fileUrl ? (
              <a
                href={proposal.fileUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex min-h-11 items-center sm:min-h-0 text-sm text-brand-700 underline sm:text-xs"
              >
                {t.upload.openFile}
              </a>
            ) : null}
          </div>
        </div>

        <form action={discardUpload}>
          <input type="hidden" name="id" value={proposal.id} />
          <button
            type="submit"
            className="rounded-lg border border-ink-300 px-3 py-1.5 text-sm text-ink-700 transition hover:bg-ink-50"
          >
            {t.upload.discard}
          </button>
        </form>
      </div>

      {proposal.problem ? (
        <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
          {t.upload.problems[proposal.problem] ?? proposal.problem}
        </p>
      ) : null}

      <form action={action} className="mt-4 space-y-4">
        <input type="hidden" name="id" value={proposal.id} />

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t.importer.fields.name ?? ''}>
            <input
              name="debtorName"
              required
              defaultValue={proposal.fields.debtorName ?? ''}
              className={`${inputClass} ${flag('customer')}`}
            />
          </Field>
          <Field label={t.importer.fields.vat_number ?? ''}>
            <input
              name="vatNumber"
              defaultValue={proposal.fields.vatNumber ?? ''}
              className={inputClass}
            />
          </Field>
          <Field label={t.importer.fields.reference ?? ''}>
            <input
              name="invoiceNumber"
              defaultValue={proposal.fields.invoiceNumber ?? ''}
              className={`${inputClass} ${flag('invoiceNumber')}`}
            />
          </Field>
          <Field label={t.importer.fields.amount ?? ''}>
            <input
              name="amount"
              required
              inputMode="decimal"
              defaultValue={proposal.fields.amount ?? ''}
              className={`${inputClass} ${flag('amountCents')}`}
            />
          </Field>
          {/* The reader names a currency from the document, and falls back to
              euros when it finds none. That guess was invisible here and
              uncorrectable: a zloty invoice read as euros would be filed,
              chased and charged as euros with nothing on screen to catch it. */}
          <Field label={t.importer.fields.currency ?? ''}>
            <select
              name="currency"
              defaultValue={proposal.fields.currency ?? DEFAULT_CURRENCY}
              className={inputClass}
            >
              {SUPPORTED_CURRENCIES.map((code) => (
                <option key={code} value={code}>
                  {code}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t.importer.fields.issue_date ?? ''}>
            <input
              name="issueDate"
              type="date"
              required
              defaultValue={proposal.fields.issueDate ?? ''}
              className={`${inputClass} ${flag('issueDate')}`}
            />
          </Field>
          <Field label={t.importer.fields.due_date ?? ''}>
            <input
              name="dueDate"
              type="date"
              defaultValue={proposal.fields.dueDate ?? ''}
              className={inputClass}
            />
          </Field>
          <Field label={t.fields.email} hint={t.fields.emailHint}>
            <input
              name="email"
              type="email"
              defaultValue={proposal.fields.email ?? ''}
              className={inputClass}
            />
          </Field>
          <Field label={t.fields.mobile} hint={t.fields.mobileHint}>
            <input name="phone" defaultValue={proposal.fields.phone ?? ''} className={inputClass} />
          </Field>
        </div>

        {missing.size > 0 ? (
          <p className="text-xs text-amber-700">
            {t.upload.missingNote}
            {[...missing].join(', ')}
          </p>
        ) : null}

        {/* Confirming a reading is the moment this becomes a real invoice and
            the customer starts hearing from us. The choice about what they hear
            belongs here, not on a screen somebody has to remember to visit. */}
        <div className="border-t border-ink-100 pt-4">
          {/* The editor's switch row carries its own title. */}
          <InvoiceScenarioEditor scenario={scenario} notice={notice} />
        </div>

        {state.error ? (
          <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
            {t.upload.errors[state.error] ?? state.error}
          </p>
        ) : null}

        <Commit />
      </form>
    </div>
  );
}
