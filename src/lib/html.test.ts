import { describe, expect, it } from 'vitest';

import { escapeHtml } from './html';

/**
 * The report notification is the one mail whose contents a stranger writes: a
 * debtor holding a payment link fills in free text, and it goes to the
 * creditor's inbox from lefta's own verified sending domain. Interpolated raw,
 * that is an authentic-looking message carrying somebody else's markup.
 */
describe('escapeHtml', () => {
  it('defuses a tag', () => {
    expect(escapeHtml('<script>alert(1)</script>')).toBe(
      '&lt;script&gt;alert(1)&lt;/script&gt;',
    );
  });

  it('defuses both kinds of attribute quote', () => {
    // Either one closes an attribute and starts a new one — an injected
    // `onerror`, or an href pointing somewhere else.
    expect(escapeHtml('" onmouseover="x')).toBe('&quot; onmouseover=&quot;x');
    expect(escapeHtml("' onmouseover='x")).toBe('&#39; onmouseover=&#39;x');
  });

  it('escapes the ampersand first, so nothing is double-decoded', () => {
    // `&` last would turn the `&` of `&lt;` into `&amp;lt;` and the browser
    // would render a literal "&lt;" instead of a defused tag.
    expect(escapeHtml('&lt;script&gt;')).toBe('&amp;lt;script&amp;gt;');
    expect(escapeHtml('a & b')).toBe('a &amp; b');
  });

  it('leaves ordinary text exactly as written', () => {
    // Including the languages this product actually receives.
    expect(escapeHtml('Πλήρωσα στις 12/08 με έμβασμα')).toBe('Πλήρωσα στις 12/08 με έμβασμα');
    expect(escapeHtml('Paid on 12/08 by transfer')).toBe('Paid on 12/08 by transfer');
    expect(escapeHtml('')).toBe('');
  });

  it('escapes every occurrence, not just the first', () => {
    expect(escapeHtml('<b><i>')).toBe('&lt;b&gt;&lt;i&gt;');
  });

  it('leaves nothing that can open a tag or an attribute', () => {
    const nasty = `</p><a href="https://evil.example" style='x'>Pay here</a>&`;
    const escaped = escapeHtml(nasty);

    expect(escaped).not.toMatch(/[<>"']/);
  });
});
