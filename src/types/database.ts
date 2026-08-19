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
/** Viva runs two separate estates; a credential pair belongs to exactly one. */
export type VivaEstate = 'demo' | 'production';
export type PaymentProviderName = 'stripe' | 'viva';
/** Portal interface language. Reminder copy is unaffected. */
export type UserLocale = 'el' | 'en';

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
  /** Highest MARK seen by a sync, including skipped documents. The resume point. */
  mydata_last_mark: string | null;
  /** Elorus API key, AES-256-GCM, same envelope as the myDATA one. */
  elorus_api_key_enc: string | null;
  elorus_organization_id: string | null;
  elorus_last_sync_at: string | null;
  stripe_customer_id: string | null;
  /** Connected Stripe account. Invoices are charged directly on it. */
  stripe_account_id: string | null;
  stripe_charges_enabled: boolean;
  stripe_connected_at: string | null;
  /** The tenant’s own Stripe key, used until Connect has a platform to run on. */
  stripe_secret_key_enc: string | null;
  /** Viva Smart Checkout credentials, same envelope as the Stripe and Elorus ones. */
  viva_client_id_enc: string | null;
  viva_client_secret_enc: string | null;
  /** Null books orders against the account's default source. */
  viva_source_code: string | null;
  viva_environment: VivaEstate;
  /** Preferred provider when both are set up. Null resolves to whichever is. */
  payment_provider: PaymentProviderName | null;
  sms_credits: number;
  automation_enabled: boolean;
  reply_to_email: string | null;
  locale: UserLocale;
  default_payment_terms_days: number;
  created_at: string;
  updated_at: string;
}

export type DebtorRow = {
  id: string;
  user_id: string;
  name: string;
  /** Stable id in the billing system, when the customer came from there. */
  elorus_contact_id: string | null;
  /** The customer id in the system they were imported from. */
  external_ref: string | null;
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
  /** Set when the payment starts; the return route settles only a matching order. */
  viva_order_code: string | null;
  /** Set only after the transaction was read back from Viva, never from a redirect. */
  viva_transaction_id: string | null;
  pay_token: string;
  /** The short public credential the reminder link carries. */
  short_code: string;
  source: 'mydata' | 'manual' | 'elorus' | 'import';
  /** Stable id in the billing system; its own numbers repeat across sequences. */
  elorus_invoice_id: string | null;
  /** Identifier from wherever an imported debt came from. Keeps re-imports idempotent. */
  external_ref: string | null;
  created_at: string;
  updated_at: string;
}

/** One configured rung of a tenant's scenario. */
export type DunningStepRow = {
  user_id: string;
  step: DunningStep;
  enabled: boolean;
  /** Days from the due date; negative is before it. Bounded by a check constraint. */
  offset_days: number;
  channels: CommChannel[];
  updated_at: string;
}

/** Whether the final step comes round again, and how often. */
export type DunningSettingsRow = {
  user_id: string;
  repeat_enabled: boolean;
  repeat_every_days: number;
  repeat_max: number;
  updated_at: string;
}

export type DunningContactRow = {
  id: string;
  user_id: string;
  debtor_id: string;
  invoice_id: string;
  /** Null for a manual reminder — those sit outside the ladder. */
  step: DunningStep | null;
  manual: boolean;
  contact_on: string;
  /** 0 is the first pass; each repeat of the final step increments it. */
  cycle: number;
  created_at: string;
}

/**
 * A template slot: a ladder step, or `null` for the manual reminder. Mirrors the
 * nullable `step` column on both dunning_contacts and message_templates.
 */
export type TemplateStep = DunningStep | null;

export type MessageTemplateRow = {
  id: string;
  user_id: string;
  step: TemplateStep;
  channel: CommChannel;
  // Names a manual wording; null is the plain manual reminder. Set only where
  // step is null, which a check constraint enforces rather than convention.
  variant: string | null;
  subject: string | null;
  body: string;
  created_at: string;
  updated_at: string;
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

/** One bank account a creditor has linked for reading their own statement. */
export type BankConnectionRow = {
  id: string;
  user_id: string;
  institution_id: string;
  institution_name: string;
  /** Both stay null until the creditor returns from their bank. */
  authorization_id: string | null;
  account_id: string | null;
  status: 'pending' | 'active' | 'expired' | 'revoked';
  /** Consent is finite; when it lapses the feed stops without an error. */
  consent_expires_at: string | null;
  last_synced_at: string | null;
  /** What the last successful read returned, before and after parsing. */
  last_fetched_count: number | null;
  last_credit_count: number | null;
  /** Field-presence counts and observed key names. Never any values. */
  last_read_diagnostic: unknown;
  created_at: string;
  updated_at: string;
}

/** An incoming credit. Debits are dropped before they can be stored. */
export type BankTransactionRow = {
  id: string;
  user_id: string;
  connection_id: string;
  provider_tx_id: string;
  booked_on: string;
  amount_cents: number;
  currency: string;
  remittance: string | null;
  counterparty_name: string | null;
  counterparty_iban: string | null;
  /** The bank's own classification of the movement, verbatim. */
  bank_transaction_code: string | null;
  state: 'unmatched' | 'review' | 'settled' | 'dismissed';
  matched_invoice_id: string | null;
  /** Which evidence fired: 'reference' | 'name' | 'iban'. */
  match_signals: string[];
  matched_at: string | null;
  /** Null when matched automatically; the operator's id when confirmed by hand. */
  matched_by: string | null;
  rejected_invoice_ids: string[];
  created_at: string;
}

/** One minted Viva order. Every press of Pay adds a row; none is ever lost. */
export type VivaOrderRow = {
  order_code: string;
  user_id: string;
  invoice_id: string;
  /** What the order was minted for — the amount Viva actually charges. */
  amount_cents: number;
  created_at: string;
}

export type FunnelEventRow = {
  id: string;
  user_id: string;
  invoice_id: string;
  debtor_id: string | null;
  /** Read off the ?c= tag the dispatch stamps per channel; null when untagged. */
  channel: 'email' | 'sms' | 'other' | null;
  event: 'page_view' | 'checkout_started';
  occurred_at: string;
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
  /** Whether the creditor's connected Stripe account can take a card today. */
  payments_enabled: boolean;
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
      dunning_steps: {
        Row: DunningStepRow;
        Insert: InsertOf<DunningStepRow, 'user_id' | 'step' | 'offset_days'>;
        Update: Partial<DunningStepRow>;
        Relationships: NoRelationships;
      };
      dunning_settings: {
        Row: DunningSettingsRow;
        Insert: InsertOf<DunningSettingsRow, 'user_id'>;
        Update: Partial<DunningSettingsRow>;
        Relationships: NoRelationships;
      };
      message_templates: {
        Row: MessageTemplateRow;
        Insert: InsertOf<MessageTemplateRow, 'user_id' | 'channel' | 'body'>;
        Update: Partial<MessageTemplateRow>;
        Relationships: NoRelationships;
      };
      dunning_contacts: {
        Row: DunningContactRow;
        Insert: InsertOf<DunningContactRow, 'user_id' | 'debtor_id' | 'invoice_id'>;
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
      bank_connections: {
        Row: BankConnectionRow;
        Insert: InsertOf<BankConnectionRow, 'user_id' | 'institution_id' | 'institution_name'>;
        Update: Partial<BankConnectionRow>;
        Relationships: NoRelationships;
      };
      bank_transactions: {
        Row: BankTransactionRow;
        Insert: InsertOf<
          BankTransactionRow,
          'user_id' | 'connection_id' | 'provider_tx_id' | 'booked_on' | 'amount_cents' | 'currency'
        >;
        Update: Partial<BankTransactionRow>;
        Relationships: NoRelationships;
      };
      funnel_events: {
        Row: FunnelEventRow;
        Insert: InsertOf<FunnelEventRow, 'user_id' | 'invoice_id' | 'event'>;
        Update: Partial<FunnelEventRow>;
        Relationships: NoRelationships;
      };
      viva_orders: {
        Row: VivaOrderRow;
        Insert: InsertOf<VivaOrderRow, 'order_code' | 'user_id' | 'invoice_id' | 'amount_cents'>;
        Update: Partial<VivaOrderRow>;
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
