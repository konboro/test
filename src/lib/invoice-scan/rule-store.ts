import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '@/types/database';

import type { ExamplePayload, RuleProposal } from './rules';

/**
 * Storing what has been proposed, and reading back what has been approved.
 *
 * The two halves are deliberately asymmetric. Proposing is cheap, automatic and
 * has no effect on anything; approving is a person's decision and is the only
 * thing that changes how a document is read.
 */

type Admin = SupabaseClient<Database>;

/**
 * Records proposals, or raises the count on ones already waiting.
 *
 * The same fault on the same layout arriving twice is not two proposals — it is
 * one proposal with better evidence, which is the number a person needs to
 * decide whether they are looking at a pattern or at somebody's typo.
 */
export async function proposeRules(
  admin: Admin,
  userId: string,
  proposals: ReadonlyArray<RuleProposal>,
  uploadId: string,
): Promise<void> {
  for (const proposal of proposals) {
    const field = proposal.payload.field;

    const { data: open } = await admin
      .from('scan_rules')
      .select('id, seen_count, evidence')
      .eq('user_id', userId)
      .eq('signature', proposal.signature)
      .eq('kind', proposal.kind)
      .eq('status', 'proposed')
      .filter('payload->>field', 'eq', field)
      .maybeSingle();

    if (open) {
      await admin
        .from('scan_rules')
        .update({
          seen_count: open.seen_count + 1,
          // The newest correction wins the payload: a layout that changed is
          // better described by what it looks like now.
          payload: proposal.payload as unknown as Record<string, unknown>,
          evidence: [...(open.evidence ?? []), uploadId].slice(-10),
          updated_at: new Date().toISOString(),
        })
        .eq('id', open.id);

      continue;
    }

    await admin.from('scan_rules').insert({
      user_id: userId,
      signature: proposal.signature,
      signature_parts: proposal.signatureParts,
      kind: proposal.kind,
      payload: proposal.payload as unknown as Record<string, unknown>,
      evidence: [uploadId],
    });
  }
}

/**
 * The approved examples for a document of this shape.
 *
 * Only 'approved'. A proposal waiting for review, or one that was rejected, has
 * no effect on any reading — which is the entire point of the review.
 */
export async function approvedExamples(
  admin: Admin,
  userId: string,
  signature: string,
  limit = 6,
): Promise<ExamplePayload[]> {
  const { data } = await admin
    .from('scan_rules')
    .select('payload')
    .eq('user_id', userId)
    .eq('signature', signature)
    .eq('kind', 'example')
    .eq('status', 'approved')
    .order('updated_at', { ascending: false })
    .limit(limit);

  return (data ?? []).map((row) => row.payload as unknown as ExamplePayload);
}
