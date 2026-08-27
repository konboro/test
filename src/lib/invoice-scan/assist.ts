import type { ExtractedInvoice, RequiredField } from './fields';

/**
 * Filling the gaps the label reader left.
 *
 * The deterministic pass knows the layouts it has been taught and is exact on
 * them, free, and instant. What it cannot do is read a template nobody has seen
 * — and until now that produced a blank form for the operator to type, even
 * though a model was already configured for scans.
 *
 * So the model is asked whenever a required field is still empty, on the text
 * that was already extracted. That is a few hundred tokens, a fraction of a
 * cent, and only on documents the parser could not finish.
 *
 * It never overrides the parser. Anything the labels produced is kept; the model
 * only supplies what is missing, and every value it returns is checked before it
 * is believed.
 */

const MODEL = 'claude-haiku-4-5';
const ENDPOINT = 'https://api.anthropic.com/v1/messages';
const MAX_TOKENS = 600;

/** Enough of the document to hold an invoice; beyond this it is an attachment. */
const MAX_CHARS = 12_000;

const PROMPT = [
  'Read this invoice text and return the fields as JSON.',
  '',
  'Keys, all optional — omit any you cannot find rather than guessing:',
  '- debtorName: the customer being billed, never the issuer',
  '- vatNumber: the customer tax number, digits only, never the issuer one',
  '- invoiceNumber: the document number',
  '- issueDate and dueDate: ISO, YYYY-MM-DD',
  '- amountCents: the total payable including tax, as an integer in cents',
  '- currency: ISO code',
  '',
  'amountCents is what the customer owes in full, not the net value and not the tax.',
  'Answer with the JSON object only.',
].join('\n');

/**
 * Turns the answer into fields, or into nothing.
 *
 * Separated from the call so the half that matters — deciding whether to believe
 * a model about how much somebody owes — is a pure function with tests. A value
 * of the wrong shape is dropped rather than coerced.
 */
export function parseAssisted(raw: string): Partial<ExtractedInvoice> {
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
  const body = parsed as Record<string, unknown>;

  const out: Partial<ExtractedInvoice> = {};

  const text = (key: string): string | undefined => {
    const value = body[key];
    return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
  };

  const isoDate = (key: string): string | undefined => {
    const value = text(key);
    return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : undefined;
  };

  out.debtorName = text('debtorName');
  out.invoiceNumber = text('invoiceNumber');
  out.issueDate = isoDate('issueDate');
  out.dueDate = isoDate('dueDate');

  const vat = text('vatNumber')?.replace(/\D/g, '');
  if (vat && vat.length >= 8 && vat.length <= 12) out.vatNumber = vat;

  const currency = text('currency');
  if (currency && /^[A-Z]{3}$/.test(currency)) out.currency = currency;

  // A whole number of cents, positive, and small enough to be an invoice rather
  // than a decimal point that went missing.
  const amount = body.amountCents;
  if (typeof amount === 'number' && Number.isInteger(amount) && amount > 0 && amount < 1e11) {
    out.amountCents = amount;
  }

  for (const key of Object.keys(out) as Array<keyof ExtractedInvoice>) {
    if (out[key] === undefined) delete out[key];
  }

  return out;
}

export function assistConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

/** Asks the model, or gives up quietly. Never throws, never blocks the upload. */
export async function assistFields(
  text: string,
  missing: ReadonlyArray<RequiredField>,
): Promise<Partial<ExtractedInvoice> | null> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key || missing.length === 0 || text.trim() === '') return null;

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
        messages: [
          { role: 'user', content: `${PROMPT}\n\n---\n${text.slice(0, MAX_CHARS)}` },
        ],
      }),
    });

    if (!response.ok) {
      console.error('[invoice-scan] assist', response.status, (await response.text()).slice(0, 200));
      return null;
    }

    const body = (await response.json()) as {
      content?: Array<{ type: string; text?: string }>;
      usage?: { input_tokens?: number; output_tokens?: number };
    };

    const usage = body.usage;
    if (usage) {
      const cost = ((usage.input_tokens ?? 0) * 1 + (usage.output_tokens ?? 0) * 5) / 1e6;
      console.info('[invoice-scan] assist', {
        missing: missing.join(','),
        input: usage.input_tokens,
        output: usage.output_tokens,
        usd: cost.toFixed(5),
      });
    }

    const answer = (body.content ?? [])
      .filter((block) => block.type === 'text')
      .map((block) => block.text ?? '')
      .join('');

    const fields = parseAssisted(answer);
    return Object.keys(fields).length > 0 ? fields : null;
  } catch (cause) {
    console.error('[invoice-scan] assist', String(cause));
    return null;
  }
}
