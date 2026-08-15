import { describe, expect, it } from 'vitest';

import { fromHeader } from './send';

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
