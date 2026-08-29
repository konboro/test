import { describe, expect, it } from 'vitest';

import { ingestOutcome } from './sync';

/**
 * "Already have it" against "could not store it".
 *
 * The old code returned an id or null and read every failure as the former, so
 * a credit that failed to store for any other reason vanished — money in the
 * bank that never reached the review queue, on a run that reported clean.
 */
describe('ingestOutcome', () => {
  it('recognises the statement we already fetched', () => {
    // The unique index on (connection_id, provider_tx_id) doing its job. Every
    // morning re-fetches the same window on purpose.
    expect(ingestOutcome({ code: '23505', message: 'duplicate key value' }, null)).toEqual({
      kind: 'duplicate',
    });
  });

  it('reports anything else as a failure', () => {
    expect(ingestOutcome({ code: '23503', message: 'foreign key violation' }, null)).toEqual({
      kind: 'failed',
      error: 'foreign key violation',
    });

    expect(ingestOutcome({ code: '42501', message: 'permission denied' }, null)).toEqual({
      kind: 'failed',
      error: 'permission denied',
    });
  });

  it('reports an error with no code as a failure, not a duplicate', () => {
    // A dropped connection has no Postgres code at all. Reading that as "seen
    // it before" is how the credit disappeared.
    expect(ingestOutcome({ message: 'fetch failed' }, null)).toEqual({
      kind: 'failed',
      error: 'fetch failed',
    });
  });

  it('passes on a stored credit', () => {
    expect(ingestOutcome(null, 'tx-1')).toEqual({ kind: 'new', id: 'tx-1' });
  });

  it('does not call a missing row a success', () => {
    // No error and no row should not happen; if it does, it is not something to
    // hand downstream as an id.
    expect(ingestOutcome(null, null)).toEqual({
      kind: 'failed',
      error: 'the insert returned no row',
    });
    expect(ingestOutcome(null, undefined).kind).toBe('failed');
  });
});
