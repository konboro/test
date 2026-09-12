/**
 * Reading a scanned invoice with a model.
 *
 * Only reached for documents with no text layer — a photograph or a scan. A
 * generated PDF is read from its own text, which is both free and exact, so
 * this is the expensive path and it is meant to stay the rare one.
 *
 * Returns plain text rather than fields on purpose. The field extraction is
 * already written, tested against real Greek, English and Polish layouts, and
 * deterministic; asking a model for structured output would replace something
 * we can pin with something we would have to trust. Here the model does the one
 * thing only it can do — turn pixels into words — and the parser does the rest.
 */

/**
 * Haiku 4.5, at $1 per million input tokens and $5 per million output.
 *
 * Measured on a real one-page invoice rather than estimated: 1,982 input and
 * 647 output tokens, $0.0052, 7.6 seconds, transcription exact. Transcription is
 * not a reasoning task, so the cheapest capable model is also the fastest and
 * loses nothing here. Thinking is deliberately not requested for the same reason.
 */
const MODEL = 'claude-haiku-4-5';
const ENDPOINT = 'https://api.anthropic.com/v1/messages';

/**
 * Three times the 647 tokens a real invoice needed.
 *
 * Headroom matters more than the saving would: a total sits at the *bottom* of
 * an invoice, so a transcription cut short loses precisely the field the whole
 * exercise is for. Truncation is detected below rather than trusted.
 */
const MAX_TOKENS = 2048;

/** Beyond this a scan is a batch of documents, and the bill is per page. */
const MAX_BYTES = 6 * 1024 * 1024;

const PROMPT = [
  'Transcribe this invoice exactly as it appears, line by line.',
  'Keep the original language, the original labels, and the numbers exactly as printed.',
  'Do not translate, do not reformat numbers or dates, do not summarise, do not explain.',
  'Output only the transcription.',
].join(' ');

export function visionConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

/**
 * The reader, or null when no key is configured.
 *
 * Null rather than a stub that throws: the caller treats its absence as "this
 * document needs typing in", which is a working outcome, and an upload must
 * never fail because an optional integration is missing.
 */
export function visionReader():
  | ((input: { bytes: Uint8Array; mimeType: string }) => Promise<string | null>)
  | null {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return null;

  return async ({ bytes, mimeType }) => {
    if (bytes.byteLength > MAX_BYTES) {
      console.error('[invoice-scan] vision skipped, file too large', bytes.byteLength);
      return null;
    }

    const isPdf = mimeType === 'application/pdf';
    const data = Buffer.from(bytes).toString('base64');

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
            {
              role: 'user',
              content: [
                {
                  type: isPdf ? 'document' : 'image',
                  source: { type: 'base64', media_type: mimeType, data },
                },
                { type: 'text', text: PROMPT },
              ],
            },
          ],
        }),
      });

      if (!response.ok) {
        console.error(
          '[invoice-scan] vision',
          response.status,
          (await response.text()).slice(0, 300),
        );
        return null;
      }

      const body = (await response.json()) as {
        content?: Array<{ type: string; text?: string }>;
        stop_reason?: string;
        usage?: { input_tokens?: number; output_tokens?: number };
      };

      // A transcription that ran out of room is worse than none. The total is
      // the last thing on the page, so a truncated read looks complete and is
      // missing the one number that matters.
      if (body.stop_reason === 'max_tokens') {
        console.error('[invoice-scan] vision truncated at max_tokens');
        return null;
      }

      const usage = body.usage;
      if (usage) {
        const cost = ((usage.input_tokens ?? 0) * 1 + (usage.output_tokens ?? 0) * 5) / 1e6;
        // Logged because the budget is small and spending is otherwise invisible.
        console.info('[invoice-scan] vision', {
          input: usage.input_tokens,
          output: usage.output_tokens,
          usd: cost.toFixed(5),
        });
      }

      const text = (body.content ?? [])
        .filter((block) => block.type === 'text')
        .map((block) => block.text ?? '')
        .join('\n')
        .trim();

      return text || null;
    } catch (cause) {
      // A network failure here is not an upload failure: the document is stored
      // and the row simply asks to be filled in.
      console.error('[invoice-scan] vision', String(cause));
      return null;
    }
  };
}
