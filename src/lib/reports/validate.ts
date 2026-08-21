import { z } from 'zod';

import { PAY_CODE_LENGTH } from '@/lib/pay-code';
import type { ReportDetails, ReportKind } from '@/types/database';

/**
 * What the anonymous endpoint accepts.
 *
 * Everything here arrives from a visitor holding nothing but a payment link,
 * so the caps are the security model: a bounded transcript bounds the model
 * bill, and a bounded payload bounds what a hostile client can make us store.
 */

/** Turns beyond this are not a report being filed, they are a chat being farmed. */
export const MAX_TURNS = 16;
export const MAX_MESSAGE_CHARS = 1200;

export const chatMessageSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string().trim().min(1).max(MAX_MESSAGE_CHARS),
});

export type ChatMessage = z.infer<typeof chatMessageSchema>;

export const chatRequestSchema = z.object({
  // Either payment credential — the short code or the 48-character legacy
  // token — with the same bounds the payment endpoint itself applies.
  token: z
    .string()
    .min(PAY_CODE_LENGTH)
    .max(128)
    .regex(/^[A-Za-z0-9]+$/),
  kind: z.enum(['paid_claim', 'dispute']),
  messages: z.array(chatMessageSchema).max(MAX_TURNS),
  /**
   * The fallback form, used when the chat is unavailable. Present means "file
   * exactly this, no model involved".
   */
  form: z
    .object({
      message: z.string().trim().min(1).max(2000),
      paid_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      amount: z.string().trim().max(20).optional(),
      reference: z.string().trim().max(200).optional(),
      contact: z.string().trim().max(200).optional(),
    })
    .optional(),
});

/**
 * What the model is allowed to file — the `submit_report` tool's payload.
 *
 * Declared with `strict: true` on the tool as well, so the API validates the
 * shape before we ever see it; this schema is the server refusing to rely on
 * that, because the row it produces is what a creditor makes a money decision
 * on.
 */
export const submitReportSchema = z.object({
  kind: z.enum(['paid_claim', 'dispute']),
  summary: z.string().trim().min(1).max(500),
  claimed_paid_on: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  claimed_amount_cents: z.number().int().min(1).max(100_000_000_00).optional(),
  method: z.enum(['transfer', 'cash', 'card', 'other']).optional(),
  reference: z.string().trim().max(200).optional(),
  dispute_reason: z.string().trim().max(1000).optional(),
  contact: z.string().trim().max(200).optional(),
});

export type SubmitReport = z.infer<typeof submitReportSchema>;

/** "1.234,56", "1234.56", "455" — money as Greek humans type it, in cents. */
export function parseClaimedAmount(value: string | undefined): number | null {
  if (!value) return null;

  const cleaned = value.replace(/[€\s]/g, '');
  // Greek writes 1.234,56 — when both separators appear, the last one is the
  // decimal mark; when only a comma appears, it is the decimal mark.
  const normalised =
    cleaned.includes(',') && cleaned.lastIndexOf(',') > cleaned.lastIndexOf('.')
      ? cleaned.replace(/\./g, '').replace(',', '.')
      : cleaned.replace(/,/g, '');

  const parsed = Number(normalised);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;

  return Math.round(parsed * 100);
}

/** The details object as stored, from either the tool call or the plain form. */
export function detailsFrom(kind: ReportKind, submitted: SubmitReport): ReportDetails {
  return {
    summary: submitted.summary,
    ...(submitted.claimed_paid_on ? { claimed_paid_on: submitted.claimed_paid_on } : {}),
    ...(submitted.claimed_amount_cents
      ? { claimed_amount_cents: submitted.claimed_amount_cents }
      : {}),
    ...(submitted.method ? { method: submitted.method } : {}),
    ...(submitted.reference ? { reference: submitted.reference } : {}),
    ...(kind === 'dispute' && submitted.dispute_reason
      ? { dispute_reason: submitted.dispute_reason }
      : {}),
    ...(submitted.contact ? { contact: submitted.contact } : {}),
  };
}
