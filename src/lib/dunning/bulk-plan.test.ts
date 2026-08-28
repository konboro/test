import { describe, expect, it } from 'vitest';

import { planBulkSend } from './bulk-plan';

const rows = (pairs: Array<[string, string]>) =>
  pairs.map(([id, debtor_id]) => ({ id, debtor_id }));

describe('planning a bulk send', () => {
  it('sends one message per customer, not one per invoice', () => {
    // The daily rule means a customer with four invoices receives one message.
    // Queueing four and letting three be refused is what made a press report a
    // remainder it could never work through.
    const plan = planBulkSend(
      rows([
        ['i1', 'd1'],
        ['i2', 'd1'],
        ['i3', 'd1'],
        ['i4', 'd2'],
      ]),
      new Set(),
      200,
    );

    expect(plan.work).toEqual(['i1', 'i4']);
    expect(plan.limited).toBe(2);
    expect(plan.left).toBe(0);
  });

  it('skips customers already written to today', () => {
    const plan = planBulkSend(
      rows([
        ['i1', 'd1'],
        ['i2', 'd2'],
      ]),
      new Set(['d1']),
      200,
    );

    expect(plan.work).toEqual(['i2']);
    expect(plan.limited).toBe(1);
  });

  it('finishes a whole selection in one press', () => {
    // A hundred and forty invoices across ninety customers is ninety sends, and
    // ninety is under the ceiling — so nothing is left over and the screen stops
    // asking to be pressed again.
    const many = rows(
      Array.from({ length: 140 }, (_, i) => [`i${i}`, `d${i % 90}`] as [string, string]),
    );

    const plan = planBulkSend(many, new Set(), 200);

    expect(plan.work).toHaveLength(90);
    expect(plan.limited).toBe(50);
    expect(plan.left).toBe(0);
  });

  it('reports what is left over only when the ceiling actually bites', () => {
    const many = rows(Array.from({ length: 300 }, (_, i) => [`i${i}`, `d${i}`] as [string, string]));

    const plan = planBulkSend(many, new Set(), 200);

    expect(plan.work).toHaveLength(200);
    expect(plan.left).toBe(100);
  });

  it('never queues the same customer twice in one batch', () => {
    const many = rows(
      Array.from({ length: 60 }, (_, i) => [`i${i}`, `d${i % 5}`] as [string, string]),
    );

    const plan = planBulkSend(many, new Set(), 200);
    const customers = new Set(plan.work);

    expect(customers.size).toBe(plan.work.length);
    expect(plan.work).toHaveLength(5);
  });

  it('sends nothing when everybody has already been written to', () => {
    const plan = planBulkSend(rows([['i1', 'd1']]), new Set(['d1']), 200);

    expect(plan.work).toEqual([]);
    expect(plan.limited).toBe(1);
    expect(plan.left).toBe(0);
  });

  it('handles an empty selection without inventing work', () => {
    expect(planBulkSend([], new Set(), 200)).toEqual({ work: [], limited: 0, left: 0 });
  });
});
