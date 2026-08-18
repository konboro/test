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
import { formatDate, formatMoney } from '@/lib/money';

import { runImport, type ImportState } from './actions';

const FIELD_LABELS: Array<{ field: ImportField; label: string; required?: boolean }> = [
  { field: 'name', label: 'Nazwa klienta', required: true },
  { field: 'amount', label: 'Kwota', required: true },
  { field: 'due_date', label: 'Termin płatności' },
  { field: 'issue_date', label: 'Data wystawienia' },
  { field: 'email', label: 'E-mail' },
  { field: 'phone', label: 'Telefon' },
  { field: 'vat_number', label: 'NIP / ΑΦΜ' },
  { field: 'reference', label: 'Numer dokumentu' },
  { field: 'external_ref', label: 'ID w Twoim systemie' },
];

/**
 * Bringing a book of debts in from a spreadsheet.
 *
 * Everything is shown before anything is written: the columns as they were
 * understood, every row that will be created, and every row that will not, with
 * the reason. An import that reports "148 of 150" and nothing else leaves the
 * operator unable to tell a mis-mapped column from twelve broken rows.
 */
export function ImportForm({ termDays }: { termDays: number }) {
  const [text, setText] = useState('');
  const [mapping, setMapping] = useState<Partial<Record<ImportField, number>>>({});
  const [fileName, setFileName] = useState<string | null>(null);
  const [state, submit, busy] = useActionState<ImportState, FormData>(runImport, {});

  const table: ParsedTable | null = useMemo(() => (text ? parseCsv(text) : null), [text]);

  const preview = useMemo(() => {
    if (!table) return null;
    return buildPreview(table, mapping, new Date().toISOString().slice(0, 10), termDays);
  }, [table, mapping, termDays]);

  function load(raw: string, name: string | null) {
    const parsed = parseCsv(raw);
    setText(raw);
    setFileName(name);
    setMapping(guessColumns(parsed.headers));
  }

  async function onFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    load(await file.text(), file.name);
  }

  const ready = Boolean(preview?.rows.length && mapping.name !== undefined && mapping.amount !== undefined);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader
          title="1. Wybierz plik"
          subtitle="CSV z Excela, Google Sheets albo eksport z Twojego systemu. Nic nie zostanie zapisane, dopóki nie zatwierdzisz."
        />
        <div className="space-y-4 px-5 py-4">
          <input
            type="file"
            accept=".csv,.txt,text/csv,text/plain"
            onChange={onFile}
            className="block w-full text-sm text-ink-600 file:mr-3 file:rounded-lg file:border-0 file:bg-ink-900 file:px-3.5 file:py-2 file:text-sm file:font-medium file:text-white hover:file:bg-ink-800"
          />

          <details>
            <summary className="cursor-pointer text-sm text-ink-500 transition hover:text-ink-800">
              albo wklej dane
            </summary>
            <textarea
              rows={6}
              value={text}
              onChange={(e) => load(e.target.value, null)}
              placeholder="Nazwa;Kwota;Termin&#10;Papadopoulos AE;1.234,56;01/08/2026"
              className="mt-2 w-full rounded-lg border border-ink-300 bg-white px-3 py-2 font-mono text-xs text-ink-900 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
            />
          </details>

          {table ? (
            <p className="text-xs text-ink-500">
              {fileName ? <span className="font-medium text-ink-700">{fileName}</span> : 'Wklejone dane'}
              {' · '}
              {table.rows.length} wierszy · separator{' '}
              {table.delimiter === '\t' ? 'tab' : table.delimiter}
            </p>
          ) : null}
        </div>
      </Card>

      {table ? (
        <Card>
          <CardHeader
            title="2. Sprawdź kolumny"
            subtitle="Odgadnięte z nagłówków. Popraw, jeśli coś trafiło nie tam."
          />
          <div className="grid gap-3 px-5 py-4 sm:grid-cols-2 lg:grid-cols-3">
            {FIELD_LABELS.map(({ field, label, required }) => (
              <label key={field} className="block">
                <span className="text-sm font-medium text-ink-700">
                  {label}
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
                      {header || `Kolumna ${i + 1}`}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>

          <p className="border-t border-ink-100 px-5 py-3 text-xs leading-relaxed text-ink-500">
            Podaj <strong className="font-medium text-ink-700">ID w Twoim systemie</strong>, jeśli
            chcesz móc wgrać poprawiony plik ponownie. Bez niego ponowny import tego samego pliku nic
            nie zmieni, ale plik <em>zmieniony</em> doda nowe pozycje zamiast zaktualizować stare.
          </p>
        </Card>
      ) : null}

      {preview ? (
        <Card>
          <CardHeader
            title="3. Podgląd"
            subtitle={`Do zaimportowania: ${preview.rows.length} · odrzucone: ${preview.problems.length}`}
            action={
              <span className="tabular text-sm font-semibold text-ink-900">
                {formatMoney(preview.totalCents)}
              </span>
            }
          />

          {preview.unreachable ? (
            <p className="border-b border-ink-100 bg-amber-50 px-5 py-2.5 text-xs leading-relaxed text-amber-900">
              {preview.unreachable} pozycji nie ma ani e-maila, ani telefonu. Zaimportują się, ale
              nie da się do nich wysłać przypomnienia, dopóki nie uzupełnisz kontaktu.
            </p>
          ) : null}

          {preview.problems.length ? (
            <div className="border-b border-ink-100 px-5 py-3">
              <p className="text-xs font-medium uppercase tracking-wide text-ink-400">
                Odrzucone wiersze
              </p>
              <ul className="mt-1.5 space-y-1">
                {preview.problems.slice(0, 12).map((problem) => (
                  <li key={problem.line} className="text-xs text-red-700">
                    <span className="tabular font-medium">Wiersz {problem.line}:</span>{' '}
                    {problem.message}
                  </li>
                ))}
                {preview.problems.length > 12 ? (
                  <li className="text-xs text-ink-500">
                    …i {preview.problems.length - 12} więcej
                  </li>
                ) : null}
              </ul>
            </div>
          ) : null}

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-ink-200 text-left text-xs uppercase tracking-wide text-ink-500">
                  <th className="px-5 py-2.5 font-medium">Klient</th>
                  <th className="px-5 py-2.5 text-right font-medium">Kwota</th>
                  <th className="px-5 py-2.5 font-medium">Termin</th>
                  <th className="px-5 py-2.5 font-medium">Kontakt</th>
                </tr>
              </thead>
              <tbody>
                {preview.rows.slice(0, 25).map((row) => (
                  <tr key={row.line} className="border-b border-ink-100 last:border-0">
                    <td className="px-5 py-2.5 text-ink-800">{row.name}</td>
                    <td className="tabular px-5 py-2.5 text-right font-medium text-ink-900">
                      {formatMoney(row.amountCents)}
                    </td>
                    <td className="tabular px-5 py-2.5 text-ink-600">{formatDate(row.dueDate)}</td>
                    <td className="px-5 py-2.5 text-xs text-ink-500">
                      {row.email ?? row.phone ?? (
                        <span className="text-amber-700">brak kontaktu</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {preview.rows.length > 25 ? (
            <p className="border-t border-ink-100 px-5 py-2.5 text-xs text-ink-500">
              Pokazano 25 z {preview.rows.length}. Zaimportowane zostaną wszystkie.
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
            {busy ? 'Importowanie…' : `Zaimportuj ${preview.rows.length} pozycji`}
          </Button>

          {!ready && preview.rows.length === 0 ? (
            <p className="text-sm text-ink-500">
              Przypisz przynajmniej kolumnę z nazwą klienta i z kwotą.
            </p>
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
              <p className="font-medium">Import zakończony.</p>
              <p className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs">
                <span>Nowi klienci: {state.outcome.debtorsCreated}</span>
                <span>Dopasowani do istniejących: {state.outcome.debtorsMatched}</span>
                <span>Dodane należności: {state.outcome.invoicesCreated}</span>
                {state.outcome.duplicates ? (
                  <span>Pominięte jako już wgrane: {state.outcome.duplicates}</span>
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
        <CardHeader title="Czego oczekuje plik" />
        <div className="space-y-3 px-5 py-4 text-sm leading-relaxed text-ink-600">
          <p>
            Wystarczą dwie kolumny: <strong className="font-medium text-ink-800">nazwa klienta</strong> i{' '}
            <strong className="font-medium text-ink-800">kwota</strong>. Reszta jest opcjonalna, ale
            bez e-maila lub telefonu nie da się wysłać przypomnienia, a bez terminu płatności
            należność liczy się jako wymagalna od daty wystawienia.
          </p>
          <p>
            Kwoty rozpoznaje w obu zapisach — <code className="rounded bg-ink-100 px-1">1.234,56</code>{' '}
            i <code className="rounded bg-ink-100 px-1">1,234.56</code>. Daty czyta jako{' '}
            <strong className="font-medium text-ink-800">dzień-miesiąc-rok</strong>.
          </p>
          <div className="flex flex-wrap gap-2 pt-1">
            <Badge tone="neutral">Nazwa</Badge>
            <Badge tone="neutral">Kwota</Badge>
            <Badge tone="neutral">Termin</Badge>
            <Badge tone="neutral">E-mail</Badge>
            <Badge tone="neutral">Telefon</Badge>
            <Badge tone="neutral">NIP</Badge>
            <Badge tone="neutral">Nr dokumentu</Badge>
            <Badge tone="neutral">ID</Badge>
          </div>
        </div>
      </Card>
    </div>
  );
}
