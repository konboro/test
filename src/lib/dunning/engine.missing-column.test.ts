import { describe, expect, it } from 'vitest';

import { automationPaused, missingColumn } from './engine';

describe('missingColumn', () => {
  it('recognises undefined_column, which is what a not-yet-pushed migration looks like', () => {
    expect(missingColumn({ code: '42703' })).toBe(true);
  });

  it('does not swallow other failures', () => {
    // A permission error must not be retried as though a column were absent:
    // the fallback query would succeed with fewer columns and hide a real
    // RLS or grant problem behind a half-working feature.
    expect(missingColumn({ code: '42501' })).toBe(false);
    expect(missingColumn(null)).toBe(false);
    expect(missingColumn({})).toBe(false);
  });
});

describe('automationPaused with the column absent', () => {
  it('treats a row without the field as chased, not paused', () => {
    expect(automationPaused({})).toBe(false);
    expect(automationPaused({ automation_enabled: undefined })).toBe(false);
    expect(automationPaused({ automation_enabled: null })).toBe(false);
    expect(automationPaused({ automation_enabled: false })).toBe(true);
  });
});
