/**
 * Database types for lefta.app.
 *
 * Hand-maintained to mirror `supabase/migrations`. Once the project is linked,
 * `pnpm db:types` regenerates this file straight from the live schema — keep the
 * two in sync when you add a migration.
 */

export type InvoiceStatus = 'pending' | 'paid' | 'cancelled' | 'written_off';
export type CommChannel = 'email' | 'sms';
export type CommStatus = 'sent' | 'failed' | 'skipped';
export type DunningStep = 'pre_due' | 'overdue_2' | 'overdue_10';
export type MyDataEnvironment = 'production' | 'sandbox';

export type UserRow = {
  id: string;
  email: string;
  company_name: string | null;
  vat_number: string | null;
  phone: string | null;
  mydata_user_id: string | null;
  mydata_subscription_key_enc: string | null;
  mydata_environment: MyDataEnvironment;
  mydata_last_sync_at: string | null;
  stripe_customer_id: string | null;
  sms_credits: number;
  automation_enabled: boolean;
  reply_to_email: string | null;
  default_payment_terms_days: number;
  created_at: string;
  updated_at: string;
}

export type DebtorRow = {
  id: string;
  user_id: string;
  name: string;
  vat_number: string | null;
  email: string | null;
  phone: string | null;
  notes: string | null;
  muted: boolean;
  created_at: string;
  updated_at: string;
}

export type InvoiceRow = {
  id: string;
  user_id: string;
  debtor_id: string;
  mark: string | null;
  invoice_number: string | null;
  series: string | null;
  amount_cents: number;
  currency: string;
  issue_date: string;
  due_date: string;
  status: InvoiceStatus;
  paid_at: string | null;
  paid_amount_cents: number | null;
  stripe_checkout_session_id: string | null;
  stripe_payment_intent_id: string | null;
  pay_token: string;
  source: 'mydata' | 'manual';
  created_at: string;
  updated_at: string;
}

export type DunningContactRow = {
  id: string;
  user_id: string;
  debtor_id: string;
  invoice_id: string;
  step: DunningStep;
  contact_on: string;
  created_at: string;
}

export type CommunicationLogRow = {
  id: string;
  user_id: string;
  debtor_id: string;
  invoice_id: string | null;
  contact_id: string | null;
  channel: CommChannel;
  step: DunningStep | null;
  status: CommStatus;
  recipient: string;
  subject: string | null;
  content: string;
  provider_message_id: string | null;
  error: string | null;
  sent_on: string;
  sent_at: string;
}

export type SmsCreditPurchaseRow = {
  id: string;
  user_id: string;
  credits: number;
  amount_cents: number;
  currency: string;
  stripe_checkout_session_id: string;
  created_at: string;
}

export type PaymentPageInvoice = {
  invoice_id: string;
  invoice_number: string | null;
  amount_cents: number;
  currency: string;
  issue_date: string;
  due_date: string;
  status: InvoiceStatus;
  debtor_name: string;
  creditor_name: string;
}

/**
 * Insert shape for a table: `Required` names the columns the caller must supply;
 * everything else is optional, because it is either nullable or filled in by a
 * database default.
 */
type InsertOf<Row, Required extends keyof Row> = Pick<Row, Required> &
  Partial<Omit<Row, Required>>;

/**
 * postgrest-js requires a `Relationships` entry on every table for its embedded
 * -resource inference. Nothing in this app selects across a relationship, so an
 * empty tuple is both accurate and sufficient.
 */
type NoRelationships = [];

export interface Database {
  public: {
    Tables: {
      users: {
        Row: UserRow;
        // `id` comes from auth.users; the row is normally created by trigger.
        Insert: InsertOf<UserRow, 'id' | 'email'>;
        Update: Partial<UserRow>;
        Relationships: NoRelationships;
      };
      debtors: {
        Row: DebtorRow;
        Insert: InsertOf<DebtorRow, 'user_id' | 'name'>;
        Update: Partial<DebtorRow>;
        Relationships: NoRelationships;
      };
      invoices: {
        Row: InvoiceRow;
        Insert: InsertOf<
          InvoiceRow,
          'user_id' | 'debtor_id' | 'amount_cents' | 'issue_date' | 'due_date'
        >;
        Update: Partial<InvoiceRow>;
        Relationships: NoRelationships;
      };
      dunning_contacts: {
        Row: DunningContactRow;
        Insert: InsertOf<DunningContactRow, 'user_id' | 'debtor_id' | 'invoice_id' | 'step'>;
        // Append-only in practice: the RLS grants and a database trigger both
        // refuse mutation. Typed as Partial anyway, since postgrest-js requires
        // a real object type here.
        Update: Partial<DunningContactRow>;
        Relationships: NoRelationships;
      };
      communications_log: {
        Row: CommunicationLogRow;
        Insert: InsertOf<
          CommunicationLogRow,
          'user_id' | 'debtor_id' | 'channel' | 'recipient' | 'content'
        >;
        Update: Partial<CommunicationLogRow>;
        Relationships: NoRelationships;
      };
      sms_credit_purchases: {
        Row: SmsCreditPurchaseRow;
        Insert: InsertOf<
          SmsCreditPurchaseRow,
          'user_id' | 'credits' | 'amount_cents' | 'stripe_checkout_session_id'
        >;
        Update: Partial<SmsCreditPurchaseRow>;
        Relationships: NoRelationships;
      };
    };
    // `{ [_ in never]: never }` is the empty-map form supabase's own generated
    // types use. `Record<string, never>` would carry a string index signature,
    // and postgrest-js intersects Tables with Views — which would collapse every
    // table row type to `never`.
    Views: { [_ in never]: never };
    Functions: {
      get_invoice_for_payment: {
        Args: { p_token: string };
        Returns: PaymentPageInvoice[];
      };
      consume_sms_credit: {
        Args: { p_user_id: string };
        Returns: boolean;
      };
      grant_sms_credits: {
        Args: {
          p_user_id: string;
          p_credits: number;
          p_amount_cents: number;
          p_session_id: string;
        };
        Returns: boolean;
      };
    };
    Enums: {
      invoice_status: InvoiceStatus;
      comm_channel: CommChannel;
      comm_status: CommStatus;
      dunning_step: DunningStep;
    };
    CompositeTypes: { [_ in never]: never };
  };
}
