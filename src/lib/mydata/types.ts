/** Shapes returned by the myDATA (AADE) REST API, normalised for our use. */

export interface MyDataCredentials {
  userId: string;
  subscriptionKey: string;
  environment: 'production' | 'sandbox';
}

export interface MyDataParty {
  vatNumber: string | null;
  country: string | null;
  branch: number | null;
  name: string | null;
}

export interface MyDataInvoice {
  /** AADE's unique document id. Stored verbatim, never reformatted. */
  mark: string;
  uid: string | null;
  /** Present when the document has been cancelled by a later filing. */
  cancelledByMark: string | null;
  issuer: MyDataParty;
  counterpart: MyDataParty;
  series: string | null;
  aa: string | null;
  issueDate: string; // YYYY-MM-DD
  invoiceType: string | null;
  currency: string;
  totalNetValue: number;
  totalVatAmount: number;
  totalGrossValue: number;
}

export interface MyDataPage {
  invoices: MyDataInvoice[];
  /** Opaque paging cursor; absent on the last page. */
  continuationToken: { nextPartitionKey: string; nextRowKey: string } | null;
}

export class MyDataError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly body?: string,
  ) {
    super(message);
    this.name = 'MyDataError';
  }
}
