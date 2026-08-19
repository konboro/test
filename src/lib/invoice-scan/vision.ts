/**
 * Reading a scanned invoice with a model.
 *
 * Only reached for documents with no text layer — a photograph or a scan. A
 * generated PDF is read from its own text, which is both free and exact, so
 * this is the expensive path and it is meant to stay the rare one.
 *
 * Returns plain text rather than fields on purpose. The field extraction is
 * already written, tested against real Greek layouts, and deterministic; asking
 * a model for structured output would replace something we can pin with
 * something we would have to trust. Here the model does the one thing only it
 * can do — turn pixels into words — and the parser does the rest.
 */

const MODEL = 'claude-sonnet-5';
const ENDPOINT = 'https://api.anthropic.com/v1/messages';

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
    const isPdf = mimeType === 'application/pdf';
    const data = Buffer.from(bytes).toString('base64');

    const source = isPdf
      ? { type: 'base64', media_type: 'application/pdf', data }
      : { type: 'base64', media_type: mimeType, data };

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
          max_tokens: 4096,
          messages: [
            {
              role: 'user',
              content: [
                { type: isPdf ? 'document' : 'image', source },
                { type: 'text', text: PROMPT },
              ],
            },
          ],
        }),
      });

      if (!response.ok) {
        console.error('[invoice-scan] vision', response.status, (await response.text()).slice(0, 300));
        return null;
      }

      const body = (await response.json()) as {
        content?: Array<{ type: string; text?: string }>;
      };

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
