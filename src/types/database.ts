/**
 * Database types for lefta.app.
 *
 * Hand-maintained to mirror `supabase/migrations`. Once the project is linked,
 * `pnpm db:types` regenerates this file straight from the live schema — keep the
 * two in sync when you add a migration.
 */

import type { Locale } from '@/lib/i18n/dictionaries';

export type InvoiceStatus = 'pending' | 'paid' | 'cancelled' | 'written_off';
export type CommChannel = 'email' | 'sms';
export type CommStatus = 'sent' | 'failed' | 'skipped';
/**
 * One rung of the ladder, identified rather than described.
 *
 * The names are historical. A step's timing is whatever offset its tenant gave
 * it, so `overdue_2` has not meant "two days late" since the scenario became
 * configurable, and `step_4` upwards were never named at all — they are slots.
 * The one that genuinely differs in kind is `on_issue`, which is not measured
 * from the due date: it fires once, when the invoice is confirmed.
 */
export type DunningStep =
  | 'on_issue'
  | 'pre_due'
  | 'overdue_2'
  | 'overdue_10'
  | 'step_4'
  | 'step_5'
  | 'step_6'
  | 'step_7'
  | 'step_8';

/** Every rung except the one that fires on issue — the due-date ladder. */
export type RelativeDunningStep = Exclude<DunningStep, 'on_issue'>;

/** How a scenario applies to one invoice. */
export type InvoiceScenarioMode = 'default' | 'custom' | 'off';
export type MyDataEnvironment = 'production' | 'sandbox';
/** Viva runs two separate estates; a credential pair belongs to exactly one. */
export type VivaEstate = 'demo' | 'production';
/** Revolut runs two estates too; a Merchant key belongs to exactly one. */
export type RevolutEstate = 'sandbox' | 'production';
export type PaymentProviderName = 'stripe' | 'viva' | 'revolut';
/**
 * Portal interface language. Reminder copy is unaffected.
 *
 * An alias rather than a union of its own. It was written out as `'el' | 'en'`
 * a second time here, and a second list of the languages is a list that will
 * eventually be one language behind the first: adding a language would compile
 * everywhere, and the column that stores the choice would refuse the value.
 */
export type UserLocale = Locale;
/** What a person may do in a company they belong to. */
export type MemberRole = 'owner' | 'member' | 'viewer';

/**
 * One company (tenant).
 *
 * The table is called `users` for historical reasons — it holds companies, not
 * people. Who may act for one is `organization_members`, and `user_id` on every
 * other table is this row's id. See docs/multi-company.md.
 */
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
  /** Revolut Merchant API key, same envelope as the Stripe and Viva ones. */
  revolut_secret_key_enc: string | null;
  revolut_environment: RevolutEstate;
  /** Preferred provider when both are set up. Null resolves to whichever is. */
  payment_provider: PaymentProviderName | null;
  sms_credits: number;
  automation_enabled: boolean;
  /**
   * Whether this channel may be used to reach a debtor at all.
   *
   * An account-wide no, above the per-step choice: a tenant who does not want
   * text messages wants one switch, and wants it to hold for the rungs they have
   * not configured yet. Both default true, so they only ever mean something a
   * person has actually said.
   */
  email_enabled: boolean;
  sms_enabled: boolean;
  reply_to_email: string | null;
  locale: UserLocale;
  /**
   * IANA name. Which calendar day an invoice is late on, and which local hour
   * the sweep sends at. Defaults to Europe/Athens, where the product started.
   */
  timezone: string;
  /** general | landlord. Chooses the vocabulary and whether leases are offered. */
  business_mode: 'general' | 'landlord';
  /** Email the creditor when an invoice settles. */
  notify_on_payment: boolean;
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
  /** No reminders until this date has passed. Null means not snoozed. */
  snoozed_until: string | null;
  /** Why they are paused. Cleared when the pause is lifted. */
  snooze_note: string | null;
  /** Reminder language. Null derives it from the phone number. */
  locale: string | null;
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
  /** False pauses the automatic sweep for this invoice alone. Manual sends are unaffected. */
  automation_enabled: boolean;
  /**
   * Which scenario this invoice follows: the tenant's, its own, or none.
   *
   * `off` and `automation_enabled: false` say the same thing and are kept in
   * step; the flag stays because it is what the row switch has always written.
   */
  scenario_mode: InvoiceScenarioMode;
  /**
   * When the customer was told this invoice exists.
   *
   * Claimed before the notice is rendered, so it doubles as the exactly-once
   * lock. Null means the notice is still owed.
   */
  issue_notice_sent_at: string | null;
  paid_at: string | null;
  paid_amount_cents: number | null;
  stripe_checkout_session_id: string | null;
  stripe_payment_intent_id: string | null;
  /** Set when the payment starts; the return route settles only a matching order. */
  viva_order_code: string | null;
  /** Set only after the transaction was read back from Viva, never from a redirect. */
  viva_transaction_id: string | null;
  /** Set only after the order was read back from Revolut, never from a redirect. */
  revolut_order_id: string | null;
  pay_token: string;
  /** The short public credential the reminder link carries. */
  short_code: string;
  source: 'mydata' | 'manual' | 'elorus' | 'import' | 'lease';
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

/**
 * One rung overridden for a single invoice.
 *
 * Only consulted when the invoice is in `custom` mode. Rows are stored rather
 * than a jsonb blob so the same check constraints that bound a tenant scenario
 * bound these too — otherwise the bounds would hold everywhere except the one
 * place a person is most likely to reach for them.
 */
export type InvoiceDunningStepRow = {
  invoice_id: string;
  step: DunningStep;
  enabled: boolean;
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
  /** Local Europe/Athens hour the sweep may contact this tenant at. */
  send_hour: number;
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

export type LeaseRow = {
  id: string;
  user_id: string;
  debtor_id: string;
  /** What the landlord calls the place, in their own words. */
  property: string;
  amount_cents: number;
  currency: string;
  /** 1–31, clamped to the month when a charge is generated. */
  due_day: number;
  starts_on: string;
  ends_on: string | null;
  /** The earliest month this lease may bill for. */
  generate_from: string;
  active: boolean;
  created_at: string;
  updated_at: string;
};

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

/** One minted Revolut order. Every press of Pay adds a row; none is ever lost. */
export type RevolutOrderRow = {
  order_id: string;
  user_id: string;
  invoice_id: string;
  /** What the order was minted for — the amount Revolut actually charges. */
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

/**
 * A document dropped on the uploader, and what we managed to read from it.
 *
 * A proposal until someone confirms it: `status` stays 'pending' and no invoice
 * exists yet. See supabase/migrations/20260819150000_invoice_uploads.sql.
 */
export type InvoiceUploadRow = {
  id: string;
  user_id: string;
  storage_path: string;
  filename: string;
  mime_type: string;
  size_bytes: number;
  /** How the fields were obtained: the PDF's own text, a model, or nothing. */
  source: 'pdf_text' | 'vision' | 'manual';
  extracted: Record<string, unknown>;
  /**
   * The values the operator actually saved, written once at commit.
   *
   * Where this differs from `extracted` the reader was wrong, and the document
   * it was wrong about is still in storage beside it.
   */
  confirmed: Record<string, unknown> | null;
  /** The text the fields were read from, kept so a correction can be explained. */
  source_text: string | null;
  /** Required fields the reader could not find, for the review screen to flag. */
  missing: string[];
  status: 'pending' | 'committed' | 'discarded';
  invoice_id: string | null;
  created_at: string;
  updated_at: string;
}

/** How far a proposed reading rule has got. */
export type ScanRuleStatus = 'proposed' | 'approved' | 'rejected' | 'withdrawn';

/**
 * Something the reader has been taught, or is asking to be taught.
 *
 * Never reaches a document until `status` is 'approved'. The chain from a
 * correction to a rule runs through a person on purpose: a reader that rewrites
 * its own rules cannot be predicted or tested, and this one decides who is
 * asked for money.
 */
export type ScanRuleRow = {
  id: string;
  user_id: string;
  /** The layout it is true about, not the supplier. */
  signature: string;
  signature_parts: string[];
  kind: string;
  payload: Record<string, unknown>;
  status: ScanRuleStatus;
  /** How many times the same correction was seen before it was believed. */
  seen_count: number;
  evidence: unknown[];
  created_at: string;
  decided_at: string | null;
  decided_by: string | null;
  updated_at: string;
}

/**
 * Who may act for a company, and how.
 *
 * Written only through the security-definer functions — the browser has select
 * and nothing else, so that "who has access" cannot be edited by the client
 * that access is being granted to.
 */
export type OrganizationMemberRow = {
  organization_id: string;
  member_id: string;
  /** Carried here so the members screen never has to read `auth.users`. */
  member_email: string;
  role: MemberRole;
  invited_by: string | null;
  created_at: string;
}

/** A pending invitation. The token itself is never selectable — only its hash is stored. */
export type OrganizationInviteRow = {
  id: string;
  organization_id: string;
  email: string;
  role: MemberRole;
  created_at: string;
  expires_at: string;
  accepted_at: string | null;
}

/** What a debtor can say about an invoice from the payment page. */
export type ReportKind = 'paid_claim' | 'dispute';
export type ReportStatus = 'open' | 'resolved' | 'dismissed';

/**
 * A payment claim or a dispute, filed anonymously from the payment page.
 *
 * Written only by the server: the debtor's side arrives via the service role
 * after the payment credential is verified, the creditor's resolution goes
 * through an ownership-checked action. Browsers can read, never write.
 */
export type InvoiceReportRow = {
  id: string;
  user_id: string;
  invoice_id: string;
  debtor_id: string;
  kind: ReportKind;
  status: ReportStatus;
  details: ReportDetails;
  /** The conversation verbatim — the debtor's words, not our paraphrase. */
  transcript: Array<{ role: 'user' | 'assistant'; content: string }> | null;
  /** Unmatched bank credits that plausibly are the claimed payment. */
  bank_match: ReportBankHint[] | null;
  created_at: string;
  resolved_at: string | null;
  resolved_by: string | null;
}

/** The structured outcome of the collection chat (or the fallback form). */
export type ReportDetails = {
  /** One or two sentences for the creditor, in Greek. */
  summary?: string;
  /** ISO date the debtor says they paid. */
  claimed_paid_on?: string;
  claimed_amount_cents?: number;
  method?: 'transfer' | 'cash' | 'card' | 'other';
  /** Payment reference, sender bank, or whatever identifies the transfer. */
  reference?: string;
  /** What is wrong with the document, in the debtor's words. */
  dispute_reason?: string;
  /** How to reach the debtor about this, if they offered a way. */
  contact?: string;
}

export type ReportBankHint = {
  booked_on: string;
  amount_cents: number;
  counterparty_name: string | null;
}

/**
 * One invoice's own wording for one outgoing message.
 *
 * A row wins over the account template for that invoice/step/channel; no row
 * means the account wording — including its future edits — applies. Text
 * identical to the account template is never stored (see
 * lib/dunning/invoice-messages).
 */
export type InvoiceMessageRow = {
  invoice_id: string;
  user_id: string;
  step: DunningStep;
  channel: CommChannel;
  /** Null for SMS, which has no subject line. */
  subject: string | null;
  body: string;
  created_at: string;
  updated_at: string;
}

/** One row of `my_organizations()` — the companies the caller may act for. */
export type MyOrganizationRow = {
  organization_id: string;
  company_name: string | null;
  vat_number: string | null;
  role: MemberRole;
  joined_at: string;
}

/** `my_organizations()` with the receivables position of each company. */
export type MyOrganizationSummaryRow = MyOrganizationRow & {
  open_cents: number;
  open_count: number;
  overdue_count: number;
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
        // Created by the signup trigger, or by create_organization() for a
        // second company. Never inserted from a browser: `authenticated` has no
        // insert grant on this table.
        Insert: InsertOf<UserRow, 'id' | 'email'>;
        Update: Partial<UserRow>;
        Relationships: NoRelationships;
      };
      organization_members: {
        Row: OrganizationMemberRow;
        Insert: InsertOf<OrganizationMemberRow, 'organization_id' | 'member_id' | 'member_email'>;
        Update: Partial<OrganizationMemberRow>;
        Relationships: NoRelationships;
      };
      organization_invites: {
        Row: OrganizationInviteRow;
        Insert: InsertOf<OrganizationInviteRow, 'organization_id' | 'email' | 'role' | 'expires_at'>;
        Update: Partial<OrganizationInviteRow>;
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
      invoice_dunning_steps: {
        Row: InvoiceDunningStepRow;
        Insert: InsertOf<InvoiceDunningStepRow, 'invoice_id' | 'step' | 'offset_days'>;
        Update: Partial<InvoiceDunningStepRow>;
        Relationships: NoRelationships;
      };
      leases: {
        Row: LeaseRow;
        Insert: InsertOf<
          LeaseRow,
          'user_id' | 'debtor_id' | 'property' | 'amount_cents' | 'due_day' | 'starts_on' | 'generate_from'
        >;
        Update: Partial<LeaseRow>;
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
      scan_rules: {
        Row: ScanRuleRow;
        Insert: InsertOf<ScanRuleRow, 'user_id' | 'signature' | 'kind' | 'payload'>;
        Update: Partial<ScanRuleRow>;
        Relationships: NoRelationships;
      };
      invoice_uploads: {
        Row: InvoiceUploadRow;
        Insert: InsertOf<InvoiceUploadRow, 'user_id' | 'storage_path' | 'filename' | 'mime_type' | 'size_bytes' | 'source'>;
        Update: Partial<InvoiceUploadRow>;
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
      revolut_orders: {
        Row: RevolutOrderRow;
        Insert: InsertOf<RevolutOrderRow, 'order_id' | 'user_id' | 'invoice_id' | 'amount_cents'>;
        Update: Partial<RevolutOrderRow>;
        Relationships: NoRelationships;
      };
      invoice_reports: {
        Row: InvoiceReportRow;
        Insert: InsertOf<InvoiceReportRow, 'user_id' | 'invoice_id' | 'debtor_id' | 'kind'>;
        Update: Partial<InvoiceReportRow>;
        Relationships: NoRelationships;
      };
      invoice_messages: {
        Row: InvoiceMessageRow;
        Insert: InsertOf<InvoiceMessageRow, 'invoice_id' | 'user_id' | 'step' | 'channel' | 'body'>;
        Update: Partial<InvoiceMessageRow>;
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
      // Spends one turn of the public chat's daily allowance for an invoice and
      // says whether there was one to spend. Service role only.
      claim_pay_chat_turn: {
        Args: { p_invoice: string; p_limit: number; p_day: string };
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
      // Companies and membership. All security definer: they check the caller
      // against organization_members themselves, because the browser has no
      // write access to that table at all.
      my_organizations: {
        Args: Record<PropertyKey, never>;
        Returns: MyOrganizationRow[];
      };
      my_organizations_summary: {
        Args: { p_today: string };
        Returns: MyOrganizationSummaryRow[];
      };
      create_organization: {
        Args: { p_company_name: string; p_vat_number?: string | null };
        Returns: string;
      };
      delete_organization: {
        Args: { p_org: string };
        Returns: undefined;
      };
      invite_member: {
        Args: { p_email: string; p_role: MemberRole };
        /** The token, returned once so it can be emailed. Not recoverable. */
        Returns: string;
      };
      revoke_invite: {
        Args: { p_invite: string };
        Returns: undefined;
      };
      accept_invite: {
        Args: { p_token: string };
        /** The company just joined. */
        Returns: string;
      };
      set_member_role: {
        Args: { p_member: string; p_role: MemberRole };
        Returns: undefined;
      };
      remove_member: {
        Args: { p_member: string };
        Returns: undefined;
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
