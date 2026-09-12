import { describe, expect, it } from 'vitest';

import { fromHeader, isRateLimited } from './send';

describe('the From header', () => {
  const ADDRESS = 'noreply@lefta.app';
  const ANGLED = `lefta.app <${ADDRESS}>`;

  it('shows the creditor as the sender, on the platform address', () => {
    // The recipient owes the creditor, not the platform, so that is the name
    // worth reading. The address stays put: it is the one with SPF and DKIM.
    expect(fromHeader(ADDRESS, 'Penny IKE')).toBe(`Penny IKE <${ADDRESS}>`);
  });

  it('replaces a display name already present in the configuration', () => {
    expect(fromHeader(ANGLED, 'Penny IKE')).toBe(`Penny IKE <${ADDRESS}>`);
  });

  it('leaves the configured value alone when there is no creditor name', () => {
    expect(fromHeader(ANGLED, undefined)).toBe(ANGLED);
    expect(fromHeader(ADDRESS, undefined)).toBe(ADDRESS);
  });

  it('falls back to the platform address when nothing is configured', () => {
    expect(fromHeader(undefined, undefined)).toBe('lefta.app <noreply@lefta.app>');
    expect(fromHeader('', 'Penny IKE')).toBe('Penny IKE <noreply@lefta.app>');
  });

  it('cannot be used to inject header content', () => {
    // A tenant types their own company name. Unescaped, a newline would end the
    // From header and let the rest be read as headers of its own.
    const header = fromHeader(ADDRESS, 'Evil"\r\nBcc: victim@example.com');

    expect(header).not.toContain('\r');
    expect(header).not.toContain('\n');
    expect(header).not.toContain('"');
    expect(header).toBe(`Evil Bcc: victim@example.com <${ADDRESS}>`);
  });

  it('cannot close the address early with angle brackets', () => {
    expect(fromHeader(ADDRESS, 'Evil <attacker@example.com>')).toBe(
      `Evil attacker@example.com <${ADDRESS}>`,
    );
  });

  it('ignores a name that is only punctuation once stripped', () => {
    expect(fromHeader(ANGLED, '""')).toBe(ANGLED);
    expect(fromHeader(ANGLED, '   ')).toBe(ANGLED);
  });
});

/**
 * A rate limit is not a delivery failure.
 *
 * Eighty-seven reminders went out in one press and thirty-six came back
 * "Too many requests. You can only make 10 requests per second." — all of them
 * to good addresses, all recorded as failed. Telling that apart from a real
 * rejection is what makes it worth retrying rather than reporting.
 */
describe('recognising a rate limit', () => {
  it('recognises what the provider actually said', () => {
    expect(
      isRateLimited(
        'Too many requests. You can only make 10 requests per second. See rate limit response headers for more information.',
      ),
    ).toBe(true);
  });

  it('recognises the other spellings of it', () => {
    expect(isRateLimited('rate limit exceeded')).toBe(true);
    expect(isRateLimited('HTTP 429')).toBe(true);
  });

  it('does not treat a real rejection as one', () => {
    // These do not get better by waiting, and retrying them would send nothing
    // while making the batch slower.
    expect(isRateLimited('Invalid `to` field: not an email address')).toBe(false);
    expect(isRateLimited('The domain is not verified')).toBe(false);
    expect(isRateLimited('RESEND_API_KEY is not configured')).toBe(false);
    expect(isRateLimited(null)).toBe(false);
    expect(isRateLimited(undefined)).toBe(false);
    expect(isRateLimited('')).toBe(false);
  });
});
