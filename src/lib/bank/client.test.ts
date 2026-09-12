import { createVerify, generateKeyPairSync } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { bankingConfigured, signedJwt, toCredit, toMinorUnits } from './client';

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });

afterEach(() => {
  vi.unstubAllEnvs();
});

function withApp() {
  vi.stubEnv('ENABLE_BANKING_APP_ID', 'app-123');
  vi.stubEnv('ENABLE_BANKING_PRIVATE_KEY', privateKey.export({ type: 'pkcs8', format: 'pem' }).toString());
}

describe('configuration', () => {
  it('needs both halves of the credential', () => {
    expect(bankingConfigured()).toBe(false);

    vi.stubEnv('ENABLE_BANKING_APP_ID', 'app-123');
    expect(bankingConfigured()).toBe(false);

    withApp();
    expect(bankingConfigured()).toBe(true);
  });
});

describe('signedJwt', () => {
  it('produces a token the public key actually verifies', () => {
    withApp();
    const token = signedJwt();
    const [header, payload, signature] = token.split('.');

    // The signature is the whole point: a malformed one fails at the bank, not here.
    const verified = createVerify('RSA-SHA256')
      .update(`${header}.${payload}`)
      .verify(publicKey, Buffer.from(signature ?? '', 'base64url'));

    expect(verified).toBe(true);
  });

  it('carries the claims the API checks', () => {
    withApp();
    const now = 1_760_000_000_000;
    const [rawHeader, rawPayload] = signedJwt(now).split('.');

    const header = JSON.parse(Buffer.from(rawHeader ?? '', 'base64url').toString());
    const payload = JSON.parse(Buffer.from(rawPayload ?? '', 'base64url').toString());

    expect(header).toMatchObject({ typ: 'JWT', alg: 'RS256', kid: 'app-123' });
    expect(payload).toMatchObject({ iss: 'enablebanking.com', aud: 'api.enablebanking.com' });
    // One hour, matching what the API grants. A longer claim is simply rejected.
    expect(payload.exp - payload.iat).toBe(3600);
    expect(payload.iat).toBe(Math.floor(now / 1000));
  });
});

describe('toMinorUnits', () => {
  it('converts without ever touching a float', () => {
    // 124.35 * 100 is 12434.999... in binary floating point.
    expect(toMinorUnits('124.35')).toBe(12435);
    expect(toMinorUnits('0.01')).toBe(1);
    expect(toMinorUnits('1240')).toBe(124000);
    expect(toMinorUnits('1240.5')).toBe(124050);
    expect(toMinorUnits('-45.90')).toBe(-4590);
    expect(toMinorUnits('+45.90')).toBe(4590);
  });
});

describe('toCredit', () => {
  const raw = {
    entry_reference: 'tx-1',
    transaction_amount: { amount: '1240.00', currency: 'EUR' },
    credit_debit_indicator: 'CRDT',
    booking_date: '2026-07-15',
    remittance_information: ['EXOFLISI', 'TIM 1042'],
    debtor: { name: 'PAPADOPOULOS GEORGIOS' },
    debtor_account: { iban: 'GR1601101250000000012300695' },
  };

  it('maps a credit into the shape the matcher works on', () => {
    expect(toCredit(raw)).toEqual({
      providerTxId: 'tx-1',
      amountCents: 124000,
      currency: 'EUR',
      bookedOn: '2026-07-15',
      remittance: 'EXOFLISI TIM 1042',
      counterpartyName: 'PAPADOPOULOS GEORGIOS',
      counterpartyIban: 'GR1601101250000000012300695',
      // Absent here, because this fixture carries no code. Present in the shape
      // regardless, so a bank that does send one cannot have it silently dropped.
      bankTransactionCode: null,
    });
  });

  it('carries the bank’s own classification through, in either shape', () => {
    // Of 26 credits read from a real account, 18 were the holder's own card
    // takings arriving from their acquirer — not customer payments at all. The
    // code is what separates those from a transfer or a cash deposit, and it
    // arrives either as a plain string or split ISO 20022 style.
    expect(toCredit({ ...raw, bank_transaction_code: 'PMNT-RCDT-ESCT' })?.bankTransactionCode).toBe(
      'PMNT-RCDT-ESCT',
    );

    expect(
      toCredit({
        ...raw,
        bank_transaction_code: { domain: 'PMNT', family: 'CNTR', sub_family: 'CDPT' },
      })?.bankTransactionCode,
    ).toBe('PMNT/CNTR/CDPT');
  });

  it('drops outgoing money before it can be stored', () => {
    // A creditor's own payments are none of this product's business.
    expect(toCredit({ ...raw, credit_debit_indicator: 'DBIT' })).toBeNull();
    expect(toCredit({ ...raw, credit_debit_indicator: undefined, transaction_amount: { amount: '-1240.00', currency: 'EUR' } })).toBeNull();
  });

  it('refuses anything it cannot key or value', () => {
    expect(toCredit({ ...raw, entry_reference: undefined, transaction_id: undefined })).toBeNull();
    expect(toCredit({ ...raw, transaction_amount: undefined })).toBeNull();
    expect(toCredit({ ...raw, booking_date: undefined, value_date: undefined })).toBeNull();
  });

  it('falls back to the fields a bank may use instead', () => {
    const alt = toCredit({
      ...raw,
      entry_reference: undefined,
      transaction_id: 'tx-alt',
      booking_date: undefined,
      value_date: '2026-07-16T00:00:00Z',
      remittance_information: 'single line',
    });

    expect(alt).toMatchObject({
      providerTxId: 'tx-alt',
      bookedOn: '2026-07-16',
      remittance: 'single line',
    });
  });

  it('reports an empty remittance as absent rather than blank', () => {
    // The matcher treats null as "no evidence"; '' would look like evidence.
    expect(toCredit({ ...raw, remittance_information: ['  '] })?.remittance).toBeNull();
  });
});
