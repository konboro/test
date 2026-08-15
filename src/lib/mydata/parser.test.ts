import { describe, expect, it } from 'vitest';

describe('the WCF envelope AADE production actually returns', () => {
  /** Wraps a document the way mydatapi.aade.gr does: escaped, inside <string>. */
  function envelope(inner: string): string {
    const escaped = inner
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;');

    return `<string xmlns="http://schemas.microsoft.com/2003/10/Serialization/">${escaped}</string>`;
  }

  const doc = `<?xml version="1.0" encoding="utf-8"?>
<RequestedDoc xmlns="http://www.aade.gr/myDATA/invoice/v1.0">
  <continuationToken><nextPartitionKey>pk</nextPartitionKey><nextRowKey>rk</nextRowKey></continuationToken>
  <invoicesDoc>
    <invoice>
      <mark>400002863592642</mark>
      <counterpart><vatNumber>111222333</vatNumber></counterpart>
      <invoiceHeader><series>A</series><aa>1</aa><issueDate>2023-07-15</issueDate></invoiceHeader>
      <invoiceSummary><totalGrossValue>150.00</totalGrossValue></invoiceSummary>
    </invoice>
  </invoicesDoc>
</RequestedDoc>`;

  it('reads an enveloped response, which is the only shape production sends', () => {
    // Parsed as-is this yields { string: "…" }, so RequestedDoc is never found
    // and every page silently looks empty.
    const page = parseRequestedDoc(envelope(doc));

    expect(page.invoices).toHaveLength(1);
    expect(page.invoices[0]?.mark).toBe('400002863592642');
    expect(page.invoices[0]?.counterpart.vatNumber).toBe('111222333');
    expect(page.continuationToken).toEqual({ nextPartitionKey: 'pk', nextRowKey: 'rk' });
  });

  it('still reads a bare document, which is what the sandbox returns', () => {
    expect(parseRequestedDoc(doc).invoices).toHaveLength(1);
  });

  it('does not trip the entity-expansion guard on a large page', () => {
    // The real failure: a live page carried 76,699 escaped entities against a
    // default cap of 1,000, and the parse aborted instead of returning invoices.
    const many = doc.replace(
      '</invoicesDoc>',
      `${'<invoice><mark>1</mark><invoiceHeader><issueDate>2024-01-01</issueDate></invoiceHeader></invoice>'.repeat(400)}</invoicesDoc>`,
    );

    expect(() => parseRequestedDoc(envelope(many))).not.toThrow();
    expect(parseRequestedDoc(envelope(many)).invoices.length).toBeGreaterThan(300);
  });

  it('leaves a genuinely escaped ampersand in the data alone', () => {
    const withAmp = doc.replace('<vatNumber>111222333</vatNumber>', '<vatNumber>1&amp;2</vatNumber>');
    expect(parseRequestedDoc(envelope(withAmp)).invoices[0]?.counterpart.vatNumber).toBe('1&2');
  });
});

import { parseRequestedDoc } from './parser';

/** Shaped after a real AADE `RequestTransmittedDocs` response. */
const SAMPLE = `<?xml version="1.0" encoding="utf-8"?>
<RequestedDoc xmlns="http://www.aade.gr/myDATA/invoice/v1.0"
              xmlns:icls="https://www.aade.gr/myDATA/incomeClassificaton/v1.0">
  <continuationToken>
    <nextPartitionKey>!!000000123</nextPartitionKey>
    <nextRowKey>!!000000456</nextRowKey>
  </continuationToken>
  <invoicesDoc>
    <invoice>
      <issuer>
        <vatNumber>123456789</vatNumber>
        <country>GR</country>
        <branch>0</branch>
      </issuer>
      <counterpart>
        <vatNumber>987654321</vatNumber>
        <country>GR</country>
        <branch>0</branch>
      </counterpart>
      <invoiceHeader>
        <series>A</series>
        <aa>1042</aa>
        <issueDate>2026-07-01</issueDate>
        <invoiceType>1.1</invoiceType>
        <currency>EUR</currency>
      </invoiceHeader>
      <invoiceSummary>
        <totalNetValue>1000.00</totalNetValue>
        <totalVatAmount>240.00</totalVatAmount>
        <totalGrossValue>1240.00</totalGrossValue>
      </invoiceSummary>
      <mark>400001912345678</mark>
      <uid>A1B2C3</uid>
    </invoice>
    <invoice>
      <issuer><vatNumber>123456789</vatNumber><country>GR</country><branch>0</branch></issuer>
      <counterpart><vatNumber>111222333</vatNumber><country>GR</country><branch>0</branch></counterpart>
      <invoiceHeader>
        <aa>1043</aa>
        <issueDate>2026-07-02</issueDate>
        <invoiceType>1.1</invoiceType>
        <currency>EUR</currency>
      </invoiceHeader>
      <invoiceSummary>
        <totalNetValue>500.00</totalNetValue>
        <totalVatAmount>120.00</totalVatAmount>
        <totalGrossValue>620.00</totalGrossValue>
      </invoiceSummary>
      <mark>400001912345679</mark>
      <cancelledByMark>400001912999999</cancelledByMark>
    </invoice>
  </invoicesDoc>
</RequestedDoc>`;

describe('parseRequestedDoc', () => {
  it('extracts every invoice', () => {
    const page = parseRequestedDoc(SAMPLE);
    expect(page.invoices).toHaveLength(2);
  });

  it('keeps MARK as an exact string, never a number', () => {
    const [first] = parseRequestedDoc(SAMPLE).invoices;
    expect(first?.mark).toBe('400001912345678');
    expect(typeof first?.mark).toBe('string');
  });

  it('reads the gross total, which is what the debtor owes', () => {
    const [first] = parseRequestedDoc(SAMPLE).invoices;
    expect(first?.totalGrossValue).toBe(1240);
  });

  it('surfaces cancellation', () => {
    const [, second] = parseRequestedDoc(SAMPLE).invoices;
    expect(second?.cancelledByMark).toBe('400001912999999');
  });

  it('tolerates a missing optional series', () => {
    const [, second] = parseRequestedDoc(SAMPLE).invoices;
    expect(second?.series).toBeNull();
    expect(second?.aa).toBe('1043');
  });

  it('reads the counterpart VAT number used to key the debtor', () => {
    const [first] = parseRequestedDoc(SAMPLE).invoices;
    expect(first?.counterpart.vatNumber).toBe('987654321');
  });

  it('returns the continuation cursor', () => {
    expect(parseRequestedDoc(SAMPLE).continuationToken).toEqual({
      nextPartitionKey: '!!000000123',
      nextRowKey: '!!000000456',
    });
  });

  it('collapses a single-invoice response into an array', () => {
    const single = SAMPLE.replace(/<invoice>[\s\S]*?<\/invoice>\s*<invoice>[\s\S]*?<\/invoice>/, `
      <invoice>
        <issuer><vatNumber>1</vatNumber></issuer>
        <counterpart><vatNumber>2</vatNumber></counterpart>
        <invoiceHeader><aa>1</aa><issueDate>2026-01-01</issueDate><currency>EUR</currency></invoiceHeader>
        <invoiceSummary><totalGrossValue>10.00</totalGrossValue></invoiceSummary>
        <mark>1</mark>
      </invoice>`);

    expect(parseRequestedDoc(single).invoices).toHaveLength(1);
  });

  it('treats an empty result set as zero invoices, not an error', () => {
    const empty = `<?xml version="1.0"?><RequestedDoc xmlns="http://www.aade.gr/myDATA/invoice/v1.0"></RequestedDoc>`;
    const page = parseRequestedDoc(empty);
    expect(page.invoices).toEqual([]);
    expect(page.continuationToken).toBeNull();
  });

  it('has no cursor on the last page', () => {
    const lastPage = SAMPLE.replace(/<continuationToken>[\s\S]*?<\/continuationToken>/, '');
    expect(parseRequestedDoc(lastPage).continuationToken).toBeNull();
  });
});
