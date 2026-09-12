import type { ImportField } from './parse';

/**
 * Naming the columns when the header words do not.
 *
 * The deterministic guesser knows a few hundred header words across the
 * languages these files arrive in, and it handles the ordinary export. What it
 * cannot do is read "Poz.", "Wart. do zapł." or a Greek accounting package's
 * internal abbreviations — and a file whose amount column is unrecognised is a
 * file the operator has to map by hand, column by column.
 *
 * So this runs only when the guesser has already failed, on the headers and a
 * couple of sample rows. Same discipline as the scanned-invoice reader: the
 * cheapest capable model, a tiny prompt, and an answer that is validated rather
 * than believed. The mapping it returns is still only a suggestion — the screen
 * shows it and the operator confirms it before anything is written.
 */

const MODEL = 'claude-haiku-4-5';
const ENDPOINT = 'https://api.anthropic.com/v1/messages';

/** The answer is a short JSON object; anything longer is a misunderstanding. */
const MAX_TOKENS = 400;

/** Enough to show what a column holds, few enough to stay a rounding error. */
const SAMPLE_ROWS = 3;

const FIELDS: ImportField[] = [
  'name',
  'email',
  'phone',
  'vat_number',
  'amount',
  'due_date',
  'issue_date',
  'reference',
  'external_ref',
];

/**
 * Turns whatever came back into a mapping, or nothing.
 *
 * Separated from the call so the risky half — trusting a model's word about
 * which column holds the money — is a pure function with tests. Every entry has
 * to name a field this product has and point at a column that exists; anything
 * else is dropped rather than repaired, and a duplicate index is dropped too,
 * because two fields reading one column is a guess that went wrong.
 */
export function parseSuggestedMapping(
  raw: string,
  headerCount: number,
): Partial<Record<ImportField, number>> {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) return {};

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.slice(start, end + 1));
  } catch {
    return {};
  }

  if (!parsed || typeof parsed !== 'object') return {};

  const mapping: Partial<Record<ImportField, number>> = {};
  const taken = new Set<number>();

  for (const field of FIELDS) {
    const value = (parsed as Record<string, unknown>)[field];
    if (typeof value !== 'number' || !Number.isInteger(value)) continue;
    if (value < 0 || value >= headerCount) continue;
    if (taken.has(value)) continue;

    mapping[field] = value;
    taken.add(value);
  }

  return mapping;
}

function promptFor(headers: string[], rows: string[][]): string {
  const columns = headers.map((header, index) => `${index}: ${header || '(empty)'}`).join('\n');

  const samples = rows
    .slice(0, SAMPLE_ROWS)
    .map((row) => headers.map((_, index) => row[index] ?? '').join(' | '))
    .join('\n');

  return [
    'This is a table of unpaid invoices exported from an accounting system.',
    'Map its columns to these fields, using the column numbers:',
    FIELDS.join(', '),
    '',
    'Columns:',
    columns,
    '',
    'Sample rows, in column order:',
    samples,
    '',
    'Answer with a JSON object only, mapping field names to column numbers.',
    'Omit any field the table does not contain. Never map two fields to one column.',
    'amount is the money owed. due_date is when payment was due, issue_date when the document was issued.',
  ].join('\n');
}

/**
 * Asks the model, or gives up quietly.
 *
 * Never throws and never blocks the import: without a key, or on any failure,
 * the operator simply maps the columns by hand, which is what they would have
 * done anyway.
 */
export async function suggestMapping(
  headers: string[],
  rows: string[][],
): Promise<Partial<Record<ImportField, number>> | null> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key || headers.length === 0) return null;

  try {
    const response = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        messages: [{ role: 'user', content: promptFor(headers, rows) }],
      }),
    });

    if (!response.ok) {
      console.error('[import:ai]', response.status, (await response.text()).slice(0, 200));
      return null;
    }

    const body = (await response.json()) as {
      content?: Array<{ type: string; text?: string }>;
      usage?: { input_tokens?: number; output_tokens?: number };
    };

    const usage = body.usage;
    if (usage) {
      const cost = ((usage.input_tokens ?? 0) * 1 + (usage.output_tokens ?? 0) * 5) / 1e6;
      console.info('[import:ai]', {
        input: usage.input_tokens,
        output: usage.output_tokens,
        usd: cost.toFixed(5),
      });
    }

    const text = (body.content ?? [])
      .filter((block) => block.type === 'text')
      .map((block) => block.text ?? '')
      .join('');

    const mapping = parseSuggestedMapping(text, headers.length);
    return Object.keys(mapping).length > 0 ? mapping : null;
  } catch (cause) {
    console.error('[import:ai]', String(cause));
    return null;
  }
}
