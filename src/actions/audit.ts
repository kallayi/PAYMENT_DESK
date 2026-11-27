'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getCurrentUserContext } from '@/lib/auth';
import type { ActionResult, AuditStatus, PaymentBatch, PaymentItem } from '@/types/database';

const auditBatchSchema = z.object({
  batchId: z.string().uuid('Valid batch ID is required.'),
  status: z.enum(['AUDITED', 'FLAGGED']),
  note: z.string().trim().max(500).optional().nullable(),
});

const auditSingleSchema = z.object({
  paymentId: z.string().uuid('Valid payment ID is required.'),
  status: z.enum(['AUDITED', 'FLAGGED']),
  note: z.string().trim().max(500).optional().nullable(),
});

/**
 * Audit or flag an entire payment batch in one click (AUDITOR or Admin only).
 * Stamps audited_at, audited_by, audit_status, and audit_note on both payment_batches
 * and all PAID payment_items in that batch, plus writes an audit_logs entry.
 */
export async function auditPaymentBatch(input: {
  batchId: string;
  status: 'AUDITED' | 'FLAGGED';
  note?: string;
}): Promise<ActionResult<{ batch: PaymentBatch; payments: PaymentItem[] }>> {
  const parsed = auditBatchSchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues[0]?.message || 'Invalid batch audit input.',
    };
  }

  const { batchId, status, note } = parsed.data;
  const cleanNote = note?.trim() || null;

  if (status === 'FLAGGED' && !cleanNote) {
    return {
      success: false,
      error: 'Please enter a brief discrepancy note when flagging a batch.',
    };
  }

  const supabase = await createClient();
  const { user, profile, activeCompany } = await getCurrentUserContext();

  if (!user || !profile || !profile.is_active) {
    return { success: false, error: 'Unauthorized. Please sign in.' };
  }

  if (profile.role !== 'AUDITOR' && !profile.is_admin) {
    return {
      success: false,
      error: 'Access denied: Only an active Auditor or Administrator can audit batches.',
    };
  }

  if (!activeCompany) {
    return { success: false, error: 'Active company workspace could not be determined.' };
  }

  const { data: existingBatch, error: batchFetchErr } = await supabase
    .from('payment_batches')
    .select('*')
    .eq('id', batchId)
    .eq('company_id', activeCompany.id)
    .single();

  if (batchFetchErr || !existingBatch) {
    return { success: false, error: 'Payment batch not found in the active company.' };
  }

  const { data: batchItems, error: itemsFetchErr } = await supabase
    .from('payment_items')
    .select('id, status')
    .eq('batch_id', batchId)
    .eq('company_id', activeCompany.id)
    .eq('status', 'PAID');

  if (itemsFetchErr || !batchItems || batchItems.length === 0) {
    return { success: false, error: 'No PAID items found inside this batch.' };
  }

  const nowIso = new Date().toISOString();
  const auditedAtValue = status === 'AUDITED' ? nowIso : null;
  const auditedByValue = status === 'AUDITED' ? user.id : null;

  // Update all PAID items in the batch (validated by trg_enforce_payment_integrity)
  const { data: updatedItems, error: itemsUpdateErr } = await supabase
    .from('payment_items')
    .update({
      audit_status: status,
      audit_note: cleanNote,
      audited_by: auditedByValue,
      audited_at: auditedAtValue,
    })
    .eq('batch_id', batchId)
    .eq('company_id', activeCompany.id)
    .eq('status', 'PAID')
    .select(
      '*, vendor:vendors(*), source_bank:company_banks(*), creator:profiles!created_by(id, full_name, role), verifier:profiles!verified_by(id, full_name, role), approver:profiles!approved_by(id, full_name, role), payer:profiles!paid_by(id, full_name, role), auditor:profiles!audited_by(id, full_name, role), batch:payment_batches(*)'
    );

  if (itemsUpdateErr || !updatedItems) {
    return {
      success: false,
      error: itemsUpdateErr?.message || 'Failed to update audit status on batch items.',
    };
  }

  const { data: updatedBatch, error: batchUpdateErr } = await supabase
    .from('payment_batches')
    .update({
      audit_status: status,
      audit_note: cleanNote,
      audited_at: auditedAtValue,
      audited_by: auditedByValue,
      updated_at: nowIso,
    })
    .eq('id', batchId)
    .eq('company_id', activeCompany.id)
    .select('*, source_bank:company_banks(*), creator:profiles!created_by(id, full_name, role), auditor:profiles!audited_by(id, full_name, role)')
    .single();

  if (batchUpdateErr || !updatedBatch) {
    return {
      success: false,
      error: batchUpdateErr?.message || 'Failed to update batch audit status.',
    };
  }

  try {
    const db =
      process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY
        ? createAdminClient()
        : supabase;
    await db.from('audit_logs').insert({
      table_name: 'payment_batches',
      record_id: batchId,
      company_id: activeCompany.id,
      action: status === 'AUDITED' ? 'BATCH_AUDITED' : 'BATCH_FLAGGED',
      old_data: {
        audit_status: existingBatch.audit_status || 'PENDING',
        audited_at: existingBatch.audited_at,
      },
      new_data: {
        audit_status: status,
        audit_note: cleanNote,
        item_count: updatedItems.length,
      },
      changed_by: user.id,
    });
  } catch (err) {
    console.warn('[Audit] Non-blocking batch audit log insert failed:', err);
  }

  revalidatePath('/audit');
  revalidatePath('/history');
  revalidatePath('/print');

  return {
    success: true,
    data: {
      batch: updatedBatch as PaymentBatch,
      payments: updatedItems as PaymentItem[],
    },
  };
}

/**
 * Audit or flag a single PAID payment (and automatically sync its parent batch's audit status if batched).
 */
export async function auditSinglePayment(input: {
  paymentId: string;
  status: 'AUDITED' | 'FLAGGED';
  note?: string;
}): Promise<ActionResult<{ payment: PaymentItem; batch: PaymentBatch | null }>> {
  const parsed = auditSingleSchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues[0]?.message || 'Invalid audit parameters.',
    };
  }

  const { paymentId, status, note } = parsed.data;
  const cleanNote = note?.trim() || null;

  if (status === 'FLAGGED' && !cleanNote) {
    return {
      success: false,
      error: 'Please enter a brief discrepancy note when flagging a payment.',
    };
  }

  const supabase = await createClient();
  const { user, profile, activeCompany } = await getCurrentUserContext();

  if (!user || !profile || !profile.is_active) {
    return { success: false, error: 'Unauthorized. Please sign in.' };
  }

  if (profile.role !== 'AUDITOR' && !profile.is_admin) {
    return {
      success: false,
      error: 'Access denied: Only an active Auditor or Administrator can audit payments.',
    };
  }

  if (!activeCompany) {
    return { success: false, error: 'Active company workspace could not be determined.' };
  }

  const { data: existing, error: fetchErr } = await supabase
    .from('payment_items')
    .select('id, status, batch_id')
    .eq('id', paymentId)
    .eq('company_id', activeCompany.id)
    .single();

  if (fetchErr || !existing) {
    return { success: false, error: 'Payment item not found in the active company.' };
  }

  if (existing.status !== 'PAID') {
    return { success: false, error: 'Only PAID payments can be audited or flagged.' };
  }

  const nowIso = new Date().toISOString();
  const auditedAtValue = status === 'AUDITED' ? nowIso : null;
  const auditedByValue = status === 'AUDITED' ? user.id : null;

  const { data: updatedPayment, error: updateErr } = await supabase
    .from('payment_items')
    .update({
      audit_status: status,
      audit_note: cleanNote,
      audited_by: auditedByValue,
      audited_at: auditedAtValue,
    })
    .eq('id', paymentId)
    .eq('company_id', activeCompany.id)
    .eq('status', 'PAID')
    .select(
      '*, vendor:vendors(*), source_bank:company_banks(*), creator:profiles!created_by(id, full_name, role), verifier:profiles!verified_by(id, full_name, role), approver:profiles!approved_by(id, full_name, role), payer:profiles!paid_by(id, full_name, role), auditor:profiles!audited_by(id, full_name, role), batch:payment_batches(*)'
    )
    .single();

  if (updateErr || !updatedPayment) {
    return {
      success: false,
      error: updateErr?.message || 'Failed to update payment audit status.',
    };
  }

  let syncedBatch: PaymentBatch | null = null;
  if (existing.batch_id) {
    const { data: siblings } = await supabase
      .from('payment_items')
      .select('id, audit_status, audited_at')
      .eq('batch_id', existing.batch_id)
      .eq('company_id', activeCompany.id)
      .eq('status', 'PAID');

    if (siblings && siblings.length > 0) {
      const hasFlagged = siblings.some((s) => s.audit_status === 'FLAGGED');
      const allAudited = siblings.every(
        (s) => s.audit_status === 'AUDITED' || Boolean(s.audited_at)
      );

      const nextBatchStatus: AuditStatus = hasFlagged
        ? 'FLAGGED'
        : allAudited
          ? 'AUDITED'
          : 'PENDING';

      const { data: batchUpdated } = await supabase
        .from('payment_batches')
        .update({
          audit_status: nextBatchStatus,
          audit_note: hasFlagged ? cleanNote : null,
          audited_at: nextBatchStatus === 'AUDITED' ? nowIso : null,
          audited_by: nextBatchStatus === 'AUDITED' ? user.id : null,
          updated_at: nowIso,
        })
        .eq('id', existing.batch_id)
        .eq('company_id', activeCompany.id)
        .select('*, source_bank:company_banks(*), creator:profiles!created_by(id, full_name, role), auditor:profiles!audited_by(id, full_name, role)')
        .single();

      if (batchUpdated) {
        syncedBatch = batchUpdated as PaymentBatch;
      }
    }
  }

  revalidatePath('/audit');
  revalidatePath('/history');
  revalidatePath('/print');

  return {
    success: true,
    data: {
      payment: updatedPayment as PaymentItem,
      batch: syncedBatch,
    },
  };
}
