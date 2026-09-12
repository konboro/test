import { afterEach, describe, expect, it, vi } from 'vitest';

import { normalisePhone, segmentCount, sendSms, usesUnicode } from './send';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

/** Captures what the transport actually put on the wire. */
function mockFetch(reply: { ok?: boolean; status?: number; body?: unknown } = {}) {
  const calls: Array<{ url: string; init: RequestInit }> = [];

  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return {
        ok: reply.ok ?? true,
        status: reply.status ?? 201,
        json: async () => reply.body ?? {},
      } as Response;
    }),
  );

  return calls;
}

/** The request under assertion, or a failure that names what went wrong. */
function firstCall(calls: Array<{ url: string; init: RequestInit }>) {
  const call = calls[0];
  if (!call) throw new Error('expected a request to the provider, none was made');
  return call;
}

function sentBody(calls: Array<{ url: string; init: RequestInit }>) {
  return JSON.parse(firstCall(calls).init.body as string) as Record<string, unknown>;
}

describe('normalisePhone', () => {
  it('accepts the shapes a Greek debtor actually types', () => {
    expect(normalisePhone('6971234567')).toBe('+306971234567');
    expect(normalisePhone('00306971234567')).toBe('+306971234567');
    expect(normalisePhone('306971234567')).toBe('+306971234567');
    expect(normalisePhone('+30 697 123 4567')).toBe('+306971234567');
    expect(normalisePhone('(697) 123-4567')).toBe('+306971234567');
  });

  it('refuses anything it cannot vouch for', () => {
    // Skipping the send is cheaper than burning a credit on a message nobody gets.
    expect(normalisePhone('')).toBeNull();
    expect(normalisePhone(null)).toBeNull();
    expect(normalisePhone('123')).toBeNull();
    expect(normalisePhone('2101234567')).toBeNull(); // landline, not a mobile
  });
});

describe('encoding', () => {
  it('recognises Greek text as needing UCS-2', () => {
    expect(usesUnicode('Υπενθύμιση')).toBe(true);
    expect(usesUnicode('Reminder')).toBe(false);
  });

  it('counts Latin text against the 160/153 GSM limits', () => {
    expect(segmentCount('a'.repeat(160))).toBe(1);
    expect(segmentCount('a'.repeat(161))).toBe(2);
  });

  it('counts Greek text against the 70/67 UCS-2 limits', () => {
    // The cost trap: a Greek reminder over 70 characters is two segments.
    expect(segmentCount('α'.repeat(70))).toBe(1);
    expect(segmentCount('α'.repeat(71))).toBe(2);
  });

  it('keeps the euro sign in GSM-7, where the standard puts it', () => {
    // This one had a price on it. Every English reminder formats its amount as
    // "455,00 €", the old check saw a byte above ASCII and declared UCS-2, and
    // Brevo — which believes the flag — sent a 94-character message as two
    // segments. The euro sign is in the GSM-7 extension table.
    expect(usesUnicode('Invoice 1042, 455,00 € overdue.')).toBe(false);
    expect(segmentCount('Invoice 1042, 455,00 € overdue.')).toBe(1);
  });

  it('charges extension-table characters two septets each', () => {
    // 80 euro signs fill a segment exactly; the eighty-first starts a second.
    expect(segmentCount('€'.repeat(80))).toBe(1);
    expect(segmentCount('€'.repeat(81))).toBe(2);
  });

  it('keeps the languages GSM-7 actually covers out of UCS-2', () => {
    // Worth an explicit list: on these markets a reminder has 160 characters to
    // work with, not 70, and mistaking that halves the useful length.
    expect(usesUnicode('Rechnung 1042 überfällig')).toBe(false); // niemiecki
    expect(usesUnicode('La fattura 1042 è scaduta')).toBe(false); // włoski
    expect(usesUnicode('Faktura 1042 har förfallit')).toBe(false); // szwedzki
    expect(usesUnicode('Facture 1042 échue')).toBe(false); // francuski
    expect(usesUnicode('Factuur 1042 is verlopen')).toBe(false); // niderlandzki
  });

  it('sends the rest of the world UCS-2, because the table has no room', () => {
    expect(usesUnicode('Faktura 1042 zaległa')).toBe(true); // polski, ł
    expect(usesUnicode('La factura 1042 está vencida')).toBe(true); // hiszpański, á
    expect(usesUnicode('Factura 1042 este scadentă')).toBe(true); // rumuński, ă
    expect(usesUnicode('1042 fatura gecikmiş')).toBe(true); // turecki, ı ş
    expect(usesUnicode('A fatura 1042 está em atraso')).toBe(true); // portugalski
    expect(usesUnicode('Reçu manquant')).toBe(true); // francuski, ç minuskuła
    expect(usesUnicode('счёт 1042 просрочен')).toBe(true); // rosyjski
    expect(usesUnicode('請求 1042 期限超過')).toBe(true); // japoński
  });

  it('treats an emoji as UCS-2 and bills its surrogate pair as two', () => {
    expect(usesUnicode('Paid 👍')).toBe(true);
    // 35 emoji are 70 UTF-16 code units — exactly one segment, not 35 of 70.
    expect(segmentCount('👍'.repeat(35))).toBe(1);
    expect(segmentCount('👍'.repeat(36))).toBe(2);
  });

  it('keeps the ten Greek capitals GSM-7 does carry', () => {
    // Δ Φ Γ Λ Ω Π Ψ Σ Θ Ξ are in the default alphabet; Κ and Ρ are not, because
    // they are meant to be typed as Latin K and P.
    expect(usesUnicode('ΔΦΓΛΩΠΨΣΘΞ')).toBe(false);
    expect(usesUnicode('Κ')).toBe(true);
  });
});

describe('sendSms without credentials', () => {
  it('dry-runs outside production instead of failing', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    const calls = mockFetch();

    const result = await sendSms({ phone: '6971234567', message: 'test' });

    expect(result.ok).toBe(true);
    expect(calls).toHaveLength(0);
  });

  it('fails loudly in production rather than silently dropping the reminder', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    const calls = mockFetch();

    const result = await sendSms({ phone: '6971234567', message: 'test' });

    expect(result.ok).toBe(false);
    // Provider-neutral since the transport became a choice: what matters is
    // that it refuses loudly, not which vendor was missing.
    expect(result.error).toContain('No SMS provider is configured');
    expect(calls).toHaveLength(0);
  });
});

describe('sendSms transport', () => {
  it('posts the message to the transactional endpoint with the api-key header', async () => {
    vi.stubEnv('BREVO_API_KEY', 'xkeysib-test');
    const calls = mockFetch({ body: { messageId: 291 } });

    const result = await sendSms({ phone: '6971234567', message: 'Reminder' });

    expect(result).toEqual({ ok: true, messageId: '291' });

    const { url, init } = firstCall(calls);
    expect(url).toBe('https://api.brevo.com/v3/transactionalSMS/sms');

    const headers = init.headers as Record<string, string>;
    expect(headers['api-key']).toBe('xkeysib-test');
    expect(headers['Content-Type']).toBe('application/json');

    const body = sentBody(calls);
    expect(body.recipient).toBe('+306971234567');
    expect(body.sender).toBe('lefta');
    expect(body.content).toBe('Reminder');
    // Marketing traffic carries consent and quiet-hours obligations these
    // reminders are exempt from — the classification must not drift.
    expect(body.type).toBe('transactional');
  });

  it('flags Greek content as unicode, because Brevo defaults it off', async () => {
    vi.stubEnv('BREVO_API_KEY', 'xkeysib-test');
    const calls = mockFetch({ body: { messageId: 1 } });

    await sendSms({ phone: '6971234567', message: 'Το παραστατικό σας λήγει' });

    // Without this the provider transliterates every Greek reminder we send.
    expect(sentBody(calls).unicodeEnabled).toBe(true);
  });

  it('leaves Latin content on the cheaper GSM encoding', async () => {
    vi.stubEnv('BREVO_API_KEY', 'xkeysib-test');
    const calls = mockFetch({ body: { messageId: 1 } });

    await sendSms({ phone: '6971234567', message: 'Reminder' });

    expect(sentBody(calls).unicodeEnabled).toBe(false);
  });

  it('sends from the configured brand when one is set', async () => {
    vi.stubEnv('BREVO_API_KEY', 'xkeysib-test');
    vi.stubEnv('SMS_SENDER_ID', 'Penny');
    const calls = mockFetch({ body: { messageId: 1 } });

    await sendSms({ phone: '6971234567', message: 'test' });

    expect(sentBody(calls).sender).toBe('Penny');
  });

  it('never reaches the provider with an unusable number', async () => {
    vi.stubEnv('BREVO_API_KEY', 'xkeysib-test');
    const calls = mockFetch();

    const result = await sendSms({ phone: '2101234567', message: 'test' });

    expect(result.ok).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it('surfaces the provider’s reason for a rejection', async () => {
    vi.stubEnv('BREVO_API_KEY', 'xkeysib-test');
    mockFetch({
      ok: false,
      status: 400,
      body: { code: 'invalid_parameter', message: 'Not enough credits' },
    });

    const result = await sendSms({ phone: '6971234567', message: 'test' });

    expect(result.ok).toBe(false);
    // Out of credits and a bad sender both land here; the log has to tell them apart.
    expect(result.error).toContain('400');
    expect(result.error).toContain('Not enough credits');
  });

  it('reports a rejection even when the body carries no explanation', async () => {
    vi.stubEnv('BREVO_API_KEY', 'xkeysib-test');
    mockFetch({ ok: false, status: 404, body: null });

    const result = await sendSms({ phone: '6971234567', message: 'test' });

    expect(result.ok).toBe(false);
    expect(result.error).toContain('404');
  });

  it('reports a timeout as a failed send, not a crash', async () => {
    vi.stubEnv('BREVO_API_KEY', 'xkeysib-test');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        const abort = new Error('aborted');
        abort.name = 'AbortError';
        throw abort;
      }),
    );

    const result = await sendSms({ phone: '6971234567', message: 'test' });

    expect(result).toEqual({ ok: false, error: 'SMS request timed out' });
  });
});
