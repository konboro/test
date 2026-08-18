import { describe, expect, it } from 'vitest';

import { channelFromTag, channelTaggedUrl } from './events';

describe('channelTaggedUrl', () => {
  it('stamps each channel with its tag', () => {
    expect(channelTaggedUrl('https://lefta.app/A7K2M9PQ4X', 'email')).toBe(
      'https://lefta.app/A7K2M9PQ4X?c=e',
    );
    expect(channelTaggedUrl('https://lefta.app/A7K2M9PQ4X', 'sms')).toBe(
      'https://lefta.app/A7K2M9PQ4X?c=s',
    );
  });

  it('appends rather than clobbers when a query string already exists', () => {
    expect(channelTaggedUrl('https://lefta.app/pay/abc?x=1', 'email')).toBe(
      'https://lefta.app/pay/abc?x=1&c=e',
    );
  });

  it('round-trips through the reader', () => {
    const url = new URL(channelTaggedUrl('https://lefta.app/A7K2M9PQ4X', 'sms'));
    expect(channelFromTag(url.searchParams.get('c'))).toBe('sms');
  });
});

describe('channelFromTag', () => {
  it('maps the two known tags', () => {
    expect(channelFromTag('e')).toBe('email');
    expect(channelFromTag('s')).toBe('sms');
  });

  it('treats anything else as an untagged visit rather than guessing', () => {
    expect(channelFromTag(null)).toBe('other');
    expect(channelFromTag(undefined)).toBe('other');
    expect(channelFromTag('')).toBe('other');
    expect(channelFromTag('email')).toBe('other');
    expect(channelFromTag('E')).toBe('other');
  });
});
