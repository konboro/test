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
  { field: 'name', label: 'Επωνυμία πελάτη', required: true },
  { field: 'amount', label: 'Ποσό', required: true },
  { field: 'due_date', label: 'Ημερομηνία λήξης' },
  { field: 'issue_date', label: 'Ημερομηνία έκδοσης' },
  { field: 'email', label: 'Email' },
  { field: 'phone', label: 'Τηλέφωνο' },
  { field: 'vat_number', label: 'ΑΦΜ' },
  { field: 'reference', label: 'Αριθμός παραστατικού' },
  { field: 'external_ref', label: 'ID στο σύστημά σας' },
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
          title="1. Επιλέξτε αρχείο"
          subtitle="CSV από Excel, Google Sheets ή εξαγωγή από το σύστημά σας. Τίποτα δεν αποθηκεύεται μέχρι να εγκρίνετε."
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
              ή επικολλήστε τα δεδομένα
            </summary>
            <textarea
              rows={6}
              value={text}
              onChange={(e) => load(e.target.value, null)}
              placeholder="Επωνυμία;Ποσό;Λήξη&#10;Παπαδόπουλος ΑΕ;1.234,56;01/08/2026"
              className="mt-2 w-full rounded-lg border border-ink-300 bg-white px-3 py-2 font-mono text-xs text-ink-900 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
            />
          </details>

          {table ? (
            <p className="text-xs text-ink-500">
              {fileName ? <span className="font-medium text-ink-700">{fileName}</span> : 'Επικολλημένα δεδομένα'}
              {' · '}
              {table.rows.length} γραμμές · διαχωριστικό{' '}
              {table.delimiter === '\t' ? 'tab' : table.delimiter}
            </p>
          ) : null}
        </div>
      </Card>

      {table ? (
        <Card>
          <CardHeader
            title="2. Ελέγξτε τις στήλες"
            subtitle="Συμπληρώθηκαν από τις επικεφαλίδες — διορθώστε ό,τι δεν ταιριάζει."
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
                      {header || `Στήλη ${i + 1}`}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>

          <p className="border-t border-ink-100 px-5 py-3 text-xs leading-relaxed text-ink-500">
            Συμπληρώστε το <strong className="font-medium text-ink-700">ID στο σύστημά σας</strong> αν
            θέλετε να μπορείτε να ανεβάσετε ξανά ένα διορθωμένο αρχείο. Χωρίς αυτό, η επανεισαγωγή του
            ίδιου αρχείου δεν αλλάζει τίποτα, όμως ένα <em>διορθωμένο</em> αρχείο θα προσθέσει νέες
            εγγραφές αντί να ενημερώσει τις παλιές.
          </p>
        </Card>
      ) : null}

      {preview ? (
        <Card>
          <CardHeader
            title="3. Προεπισκόπηση"
            subtitle={`Προς εισαγωγή: ${preview.rows.length} · απορρίφθηκαν: ${preview.problems.length}`}
            action={
              <span className="tabular text-sm font-semibold text-ink-900">
                {formatMoney(preview.totalCents)}
              </span>
            }
          />

          {preview.unreachable ? (
            <p className="border-b border-ink-100 bg-amber-50 px-5 py-2.5 text-xs leading-relaxed text-amber-900">
              {preview.unreachable} εγγραφές δεν έχουν ούτε email ούτε τηλέφωνο. Θα εισαχθούν, αλλά
              δεν μπορεί να τους σταλεί υπενθύμιση μέχρι να συμπληρώσετε στοιχεία επικοινωνίας.
            </p>
          ) : null}

          {preview.problems.length ? (
            <div className="border-b border-ink-100 px-5 py-3">
              <p className="text-xs font-medium uppercase tracking-wide text-ink-400">
                Απορριφθείσες γραμμές
              </p>
              <ul className="mt-1.5 space-y-1">
                {preview.problems.slice(0, 12).map((problem) => (
                  <li key={problem.line} className="text-xs text-red-700">
                    <span className="tabular font-medium">Γραμμή {problem.line}:</span>{' '}
                    {problem.message}
                  </li>
                ))}
                {preview.problems.length > 12 ? (
                  <li className="text-xs text-ink-500">
                    …και {preview.problems.length - 12} ακόμη
                  </li>
                ) : null}
              </ul>
            </div>
          ) : null}

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-ink-200 text-left text-xs uppercase tracking-wide text-ink-500">
                  <th className="px-5 py-2.5 font-medium">Πελάτης</th>
                  <th className="px-5 py-2.5 text-right font-medium">Ποσό</th>
                  <th className="px-5 py-2.5 font-medium">Λήξη</th>
                  <th className="px-5 py-2.5 font-medium">Επικοινωνία</th>
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
                        <span className="text-amber-700">χωρίς στοιχεία</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {preview.rows.length > 25 ? (
            <p className="border-t border-ink-100 px-5 py-2.5 text-xs text-ink-500">
              Εμφανίζονται 25 από {preview.rows.length}. Θα εισαχθούν όλες.
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
            {busy ? 'Εισαγωγή…' : `Εισαγωγή ${preview.rows.length} εγγραφών`}
          </Button>

          {!ready && preview.rows.length === 0 ? (
            <p className="text-sm text-ink-500">
              Αντιστοιχίστε τουλάχιστον τη στήλη με την επωνυμία πελάτη και τη στήλη με το ποσό.
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
              <p className="font-medium">Η εισαγωγή ολοκληρώθηκε.</p>
              <p className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs">
                <span>Νέοι πελάτες: {state.outcome.debtorsCreated}</span>
                <span>Αντιστοιχίστηκαν σε υπάρχοντες: {state.outcome.debtorsMatched}</span>
                <span>Νέες απαιτήσεις: {state.outcome.invoicesCreated}</span>
                {state.outcome.duplicates ? (
                  <span>Παραλείφθηκαν ως ήδη εισηγμένες: {state.outcome.duplicates}</span>
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
        <CardHeader title="Τι περιμένει το αρχείο" />
        <div className="space-y-3 px-5 py-4 text-sm leading-relaxed text-ink-600">
          <p>
            Αρκούν δύο στήλες: <strong className="font-medium text-ink-800">επωνυμία πελάτη</strong> και{' '}
            <strong className="font-medium text-ink-800">ποσό</strong>. Τα υπόλοιπα είναι προαιρετικά —
            χωρίς email ή τηλέφωνο όμως δεν στέλνεται υπενθύμιση, και χωρίς ημερομηνία λήξης η απαίτηση
            θεωρείται απαιτητή από την ημερομηνία έκδοσης.
          </p>
          <p>
            Τα ποσά αναγνωρίζονται και στις δύο γραφές — <code className="rounded bg-ink-100 px-1">1.234,56</code>{' '}
            και <code className="rounded bg-ink-100 px-1">1,234.56</code>. Οι ημερομηνίες διαβάζονται ως{' '}
            <strong className="font-medium text-ink-800">ημέρα-μήνας-έτος</strong>.
          </p>
          <div className="flex flex-wrap gap-2 pt-1">
            <Badge tone="neutral">Επωνυμία</Badge>
            <Badge tone="neutral">Ποσό</Badge>
            <Badge tone="neutral">Λήξη</Badge>
            <Badge tone="neutral">Email</Badge>
            <Badge tone="neutral">Τηλέφωνο</Badge>
            <Badge tone="neutral">ΑΦΜ</Badge>
            <Badge tone="neutral">Αρ. παραστατικού</Badge>
            <Badge tone="neutral">ID</Badge>
          </div>
        </div>
      </Card>
    </div>
  );
}
