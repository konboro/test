import { describe, expect, it } from 'vitest';

import { parseSuggestedMapping } from './ai-mapping';

describe('what comes back from the model is checked, not believed', () => {
  it('takes a well-formed answer', () => {
    const mapping = parseSuggestedMapping('{"name": 0, "amount": 3, "due_date": 4}', 6);
    expect(mapping).toEqual({ name: 0, amount: 3, due_date: 4 });
  });

  it('reads an answer wrapped in prose or fences', () => {
    const mapping = parseSuggestedMapping(
      'Here is the mapping:\n```json\n{"name": 1, "amount": 2}\n```\nHope that helps.',
      4,
    );
    expect(mapping).toEqual({ name: 1, amount: 2 });
  });

  it('drops a column number that does not exist', () => {
    // Pointing at column 9 of a 4-column file would read undefined for every
    // row and import a table of blanks without complaining once.
    expect(parseSuggestedMapping('{"name": 0, "amount": 9}', 4)).toEqual({ name: 0 });
    expect(parseSuggestedMapping('{"amount": -1}', 4)).toEqual({});
  });

  it('refuses to point two fields at one column', () => {
    // The second one is the mistake: whichever field loses would silently read
    // the other field's data.
    expect(parseSuggestedMapping('{"amount": 2, "due_date": 2}', 5)).toEqual({ amount: 2 });
  });

  it('ignores fields this product does not have', () => {
    expect(parseSuggestedMapping('{"name": 0, "salesperson": 1}', 3)).toEqual({ name: 0 });
  });

  it('ignores anything that is not a whole column number', () => {
    expect(parseSuggestedMapping('{"name": "0", "amount": 1.5, "phone": null}', 4)).toEqual({});
  });

  it('survives an answer that is not JSON at all', () => {
    expect(parseSuggestedMapping('I could not work this out.', 4)).toEqual({});
    expect(parseSuggestedMapping('', 4)).toEqual({});
    expect(parseSuggestedMapping('{broken', 4)).toEqual({});
  });
});
