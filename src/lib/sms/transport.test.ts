import { afterEach, describe, expect, it, vi } from 'vitest';

import { smsTransport } from './send';

afterEach(() => {
  vi.unstubAllEnvs();
});

function configure(env: Record<string, string>) {
  for (const key of ['BREVO_API_KEY', 'TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN']) {
    vi.stubEnv(key, env[key] ?? '');
  }
}

describe('which provider a send goes through', () => {
  it('uses Brevo while only Brevo is configured', () => {
    configure({ BREVO_API_KEY: 'xkeysib-test' });
    expect(smsTransport()).toBe('brevo');
  });

  it('switches to Twilio the moment its credentials exist', () => {
    // This is the migration: both sets present, and every subsequent message
    // goes through Twilio without a deploy.
    configure({
      BREVO_API_KEY: 'xkeysib-test',
      TWILIO_ACCOUNT_SID: 'ACtest',
      TWILIO_AUTH_TOKEN: 'secret',
    });
    expect(smsTransport()).toBe('twilio');
  });

  it('falls back to Brevo if the Twilio credentials are removed', () => {
    configure({ BREVO_API_KEY: 'xkeysib-test' });
    expect(smsTransport()).toBe('brevo');
  });

  it('ignores a half-configured Twilio rather than selecting it', () => {
    // A selected-but-unusable provider is a reminder that silently does not
    // send. Half a credential pair must not win the choice.
    configure({ BREVO_API_KEY: 'xkeysib-test', TWILIO_ACCOUNT_SID: 'ACtest' });
    expect(smsTransport()).toBe('brevo');

    configure({ BREVO_API_KEY: 'xkeysib-test', TWILIO_AUTH_TOKEN: 'secret' });
    expect(smsTransport()).toBe('brevo');
  });

  it('reports nothing when neither is configured', () => {
    configure({});
    expect(smsTransport()).toBeNull();
  });
});
