'use client';

import { useActionState, useMemo, useState } from 'react';

import { Badge, Button, Card, CardHeader } from '@/components/ui';
import {
  buildPreview,
  guessColumns,
  parseCsv,
  type ImportField,
  type ParsedTable,
} from '@/lib/import/parse';
import { useT } from '@/lib/i18n/provider';
import { formatDate, formatMoney } from '@/lib/money';

import { assistMapping, readSheetFile, runImport, type ImportState } from './actions';

/**
 * The order the mapping controls appear in, and which two are required.
 *
 * Only the order and the requirement live here now — the labels come from the
 * dictionary. They used to be written into this array in Greek, which meant the
 * whole importer stayed Greek for a tenant reading the rest of the product in
 * English.
 */
const FIELDS: Array<{ field: ImportField; required?: boolean }> = [
  { field: 'name', required: true },
  { field: 'amount', required: true },
  { field: 'due_date' },
  { field: 'issue_date' },
  { field: 'email' },
  { field: 'phone' },
  { field: 'vat_number' },
  { field: 'reference' },
  { field: 'external_ref' },
];

const PREVIEW_ROWS = 25;
const PREVIEW_PROBLEMS = 12;

/**
 * Bringing a book of debts in from a spreadsheet.
 *
 * Everything is shown before anything is written: the columns as they were
 * understood, every row that will be created, and every row that will not, with
 * the reason. An import that reports "148 of 150" and nothing else leaves the
 * operator unable to tell a mis-mapped column from twelve broken rows.
 */
export function ImportForm({ termDays }: { termDays: number }) {
  const t = useT();
  const [text, setText] = useState('');
  const [mapping, setMapping] = useState<Partial<Record<ImportField, number>>>({});
  const [sheetNote, setSheetNote] = useState<string[]>([]);
  const [reading, setReading] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);
  const [state, submit, busy] = useActionState<ImportState, FormData>(runImport, {});

  const table: ParsedTable | null = useMemo(() => (text ? parseCsv(text) : null), [text]);

  const preview = useMemo(() => {
    if (!table) return null;
    return buildPreview(table, mapping, new Date().toISOString().slice(0, 10), termDays);
  }, [table, mapping, termDays]);

  function load(raw: string, name: string | null, ready?: Partial<Record<ImportField, number>>) {
    const parsed = parseCsv(raw);
    setText(raw);
    setFileName(name);
    setMapping(ready ?? guessColumns(parsed.headers));
  }

  /**
   * For a CSV or a pasted table, which the browser parses itself.
   *
   * Only asks the server when the header words left the two fields nothing can
   * be imported without still unmapped — otherwise a perfectly readable file
   * would make a network call, and a model call, for nothing.
   */
  async function loadText(raw: string, name: string | null) {
    const parsed = parseCsv(raw);
    const guessed = guessColumns(parsed.headers);

    if (guessed.name !== undefined && guessed.amount !== undefined) {
      load(raw, name, guessed);
      return;
    }

    setReading(true);
    try {
      const helped = await assistMapping(parsed.headers, parsed.rows.slice(0, 3));
      if (helped.mappedBy === 'ai') setSheetNote([t.importer.mappedByAi]);
      load(raw, name, helped.mapping);
    } finally {
      setReading(false);
    }
  }

  const isSpreadsheet = (file: File) => /.xlsx$|.xlsm$/i.test(file.name);

  async function onFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    setSheetNote([]);

    // A CSV is already text; a workbook has to be opened on the server, where
    // the parser lives and where the file does not have to leave the request.
    if (!isSpreadsheet(file)) {
      await loadText(await file.text(), file.name);
      return;
    }

    setReading(true);
    try {
      const body = new FormData();
      body.set('file', file);
      const result = await readSheetFile(body);

      if (result.error || !result.text) {
        setSheetNote([result.error ?? t.importer.sheetErrors.unreadable ?? '']);
        return;
      }

      // Says which sheet was taken and where the header was found, because both
      // are guesses and a wrong one is easier to spot than to debug.
      const notes = [t.importer.sheetChosen(result.sheetName ?? '', result.headerRow ?? 1)];
      const others = (result.sheets ?? []).filter((name) => name !== result.sheetName);
      if (others.length) notes.push(t.importer.sheetOthers(others.join(', ')));
      if (result.truncated) notes.push(t.importer.sheetTruncated);

      if (result.mappedBy === 'ai') notes.push(t.importer.mappedByAi);

      setSheetNote(notes);
      load(result.text, file.name, result.mapping);
    } finally {
      setReading(false);
    }
  }

  const ready = Boolean(
    preview?.rows.length && mapping.name !== undefined && mapping.amount !== undefined,
  );

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader title={t.importer.step1} subtitle={t.importer.step1Hint} />
        <div className="space-y-4 px-5 py-4">
          <input
            type="file"
            accept=".csv,.txt,.xlsx,.xlsm,text/csv,text/plain,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            onChange={onFile}
            className="block w-full text-sm text-ink-600 file:mr-3 file:rounded-lg file:border-0 file:bg-ink-900 file:px-3.5 file:py-2 file:text-sm file:font-medium file:text-white hover:file:bg-ink-800"
          />

          {reading ? <p className="text-sm text-ink-500">{t.importer.reading}</p> : null}

          {sheetNote.length ? (
            <ul className="space-y-1 rounded-lg bg-ink-50 px-3 py-2 text-xs text-ink-600">
              {sheetNote.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          ) : null}

          <details>
            <summary className="cursor-pointer text-sm text-ink-500 transition hover:text-ink-800">
              {t.importer.orPaste}
            </summary>
            <textarea
              rows={6}
              value={text}
              onChange={(e) => void loadText(e.target.value, null)}
              placeholder={t.importer.pastePlaceholder}
              className="mt-2 w-full rounded-lg border border-ink-300 bg-white px-3 py-2 font-mono text-xs text-ink-900 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
            />
          </details>

          {table ? (
            <p className="text-xs text-ink-500">
              {fileName ? (
                <span className="font-medium text-ink-700">{fileName}</span>
              ) : (
                t.importer.pastedData
              )}
              {' · '}
              {t.importer.fileSummary(
                table.rows.length,
                table.delimiter === '\t' ? 'tab' : table.delimiter,
              )}
            </p>
          ) : null}
        </div>
      </Card>

      {table ? (
        <Card>
          <CardHeader title={t.importer.step2} subtitle={t.importer.step2Hint} />
          <div className="grid gap-3 px-5 py-4 sm:grid-cols-2 lg:grid-cols-3">
            {FIELDS.map(({ field, required }) => (
              <label key={field} className="block">
                <span className="text-sm font-medium text-ink-700">
                  {t.importer.fields[field]}
                  {required ? <span className="text-red-600"> *</span> : null}
                </span>
                <select
                  value={mapping[field] ?? ''}
                  onChange={(e) =>
                    setMapping((current) => ({
                      ...current,
                      [field]: e.target.value === '' ? undefined : Number(e.target.value),
                    }))
                  }
                  className="mt-1.5 w-full rounded-lg border border-ink-300 bg-white px-3 py-2 text-sm text-ink-900 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
                >
                  <option value="">—</option>
                  {table.headers.map((header, i) => (
                    <option key={`${header}:${i}`} value={i}>
                      {header || t.importer.columnFallback(i + 1)}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>

          <p className="border-t border-ink-100 px-5 py-3 text-xs leading-relaxed text-ink-500">
            {t.importer.externalRefHint}
          </p>
        </Card>
      ) : null}

      {preview ? (
        <Card>
          <CardHeader
            title={t.importer.step3}
            subtitle={t.importer.step3Hint(preview.rows.length, preview.problems.length)}
            action={
              <span className="tabular text-sm font-semibold text-ink-900">
                {formatMoney(preview.totalCents)}
              </span>
            }
          />

          {preview.unreachable ? (
            <p className="border-b border-ink-100 bg-amber-50 px-5 py-2.5 text-xs leading-relaxed text-amber-900">
              {t.importer.unreachable(preview.unreachable)}
            </p>
          ) : null}

          {preview.problems.length ? (
            <div className="border-b border-ink-100 px-5 py-3">
              <p className="text-xs font-medium uppercase tracking-wide text-ink-400">
                {t.importer.rejected}
              </p>
              <ul className="mt-1.5 space-y-1">
                {preview.problems.slice(0, PREVIEW_PROBLEMS).map((problem) => (
                  <li key={problem.line} className="text-xs text-red-700">
                    <span className="tabular font-medium">
                      {t.importer.rejectedLine(problem.line)}
                    </span>{' '}
                    {problem.message}
                  </li>
                ))}
                {preview.problems.length > PREVIEW_PROBLEMS ? (
                  <li className="text-xs text-ink-500">
                    {t.importer.andMore(preview.problems.length - PREVIEW_PROBLEMS)}
                  </li>
                ) : null}
              </ul>
            </div>
          ) : null}

          {/* Confirming an import is a decision about money, and on a phone
              it was made by dragging a four-column table sideways to find the
              amount. The card shows all four at once. */}
          <ul className="divide-y divide-ink-100 md:hidden">
            {preview.rows.slice(0, PREVIEW_ROWS).map((row) => (
              <li key={row.line} className="px-4 py-3">
                <div className="flex items-start justify-between gap-3">
                  <span className="min-w-0 flex-1 break-words text-sm text-ink-800">{row.name}</span>
                  <span className="tabular shrink-0 text-sm font-semibold text-ink-900">
                    {formatMoney(row.amountCents)}
                  </span>
                </div>
                <p className="tabular mt-1 text-xs text-ink-500">{formatDate(row.dueDate)}</p>
                <p className="mt-0.5 break-all text-sm text-ink-600">
                  {row.email ?? row.phone ?? (
                    <span className="text-amber-700">{t.importer.noContact}</span>
                  )}
                </p>
              </li>
            ))}
          </ul>

          <div className="hidden overflow-x-auto md:block">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-ink-200 text-left text-xs uppercase tracking-wide text-ink-500">
                  <th className="px-5 py-2.5 font-medium">{t.importer.colCustomer}</th>
                  <th className="px-5 py-2.5 text-right font-medium">{t.importer.colAmount}</th>
                  <th className="px-5 py-2.5 font-medium">{t.importer.colDue}</th>
                  <th className="px-5 py-2.5 font-medium">{t.importer.colContact}</th>
                </tr>
              </thead>
              <tbody>
                {preview.rows.slice(0, PREVIEW_ROWS).map((row) => (
                  <tr key={row.line} className="border-b border-ink-100 last:border-0">
                    <td className="px-5 py-2.5 text-ink-800">{row.name}</td>
                    <td className="tabular px-5 py-2.5 text-right font-medium text-ink-900">
                      {formatMoney(row.amountCents)}
                    </td>
                    <td className="tabular px-5 py-2.5 text-ink-600">{formatDate(row.dueDate)}</td>
                    <td className="px-5 py-2.5 text-xs text-ink-500">
                      {row.email ?? row.phone ?? (
                        <span className="text-amber-700">{t.importer.noContact}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {preview.rows.length > PREVIEW_ROWS ? (
            <p className="border-t border-ink-100 px-5 py-2.5 text-xs text-ink-500">
              {t.importer.showing(PREVIEW_ROWS, preview.rows.length)}
            </p>
          ) : null}
        </Card>
      ) : null}

      {preview ? (
        <form action={submit} className="space-y-3">
          <input type="hidden" name="text" value={text} />
          <input type="hidden" name="mapping" value={JSON.stringify(mapping)} />
          <input type="hidden" name="term_days" value={termDays} />

          <Button type="submit" variant="brand" disabled={!ready || busy}>
            {busy ? t.importer.submitting : t.importer.submit(preview.rows.length)}
          </Button>

          {!ready && preview.rows.length === 0 ? (
            <p className="text-sm text-ink-500">{t.importer.needMapping}</p>
          ) : null}

          {state.error ? (
            <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
              {state.error}
            </p>
          ) : null}

          {state.outcome ? (
            <div
              role="status"
              className="rounded-lg bg-emerald-50 px-4 py-3 text-sm text-emerald-800"
            >
              <p className="font-medium">{t.importer.doneTitle}</p>
              <p className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs">
                <span>{t.importer.doneCreated(state.outcome.debtorsCreated)}</span>
                <span>{t.importer.doneMatched(state.outcome.debtorsMatched)}</span>
                <span>{t.importer.doneInvoices(state.outcome.invoicesCreated)}</span>
                {state.outcome.duplicates ? (
                  <span>{t.importer.doneDuplicates(state.outcome.duplicates)}</span>
                ) : null}
              </p>
              {state.outcome.errors.length ? (
                <ul className="mt-2 space-y-0.5 text-xs text-red-700">
                  {state.outcome.errors.map((error) => (
                    <li key={error}>{error}</li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}
        </form>
      ) : null}

      <Card>
        <CardHeader title={t.importer.expectTitle} />
        <div className="space-y-3 px-5 py-4 text-sm leading-relaxed text-ink-600">
          <p>{t.importer.expectBody1}</p>
          <p>{t.importer.expectBody2}</p>
          <div className="flex flex-wrap gap-2 pt-1">
            {t.importer.badges.map((badge) => (
              <Badge key={badge} tone="neutral">
                {badge}
              </Badge>
            ))}
          </div>
        </div>
      </Card>
    </div>
  );
}
