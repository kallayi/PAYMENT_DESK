'use server';

import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import {
  createPaymentSchema,
  updateDraftPaymentSchema,
  rejectPaymentSchema,
  switchBankSchema,
  markPaidSchema,
  settlePaymentBatchSchema,
  type CreatePaymentInput,
  type UpdateDraftPaymentInput,
  type MarkPaidInput,
  type SettlePaymentBatchInput,
} from '@/lib/validators';
import type { ActionResult, AuditLog, Database, PaymentBatch, PaymentItem } from '@/types/database';
import { getCurrentUserContext } from '@/lib/auth';
import { dispatchWorkflowNotification } from '@/lib/notifications-server';
import { validateDocumentMagicBytes } from '@/lib/file-validation';
import { sendPushToUsers } from '@/lib/push';
import { formatINR, getCurrentISTInfo, getTodayISTDateString, round2 } from '@/lib/format';

type PaymentItemUpdate = Database['public']['Tables']['payment_items']['Update'];

const uuidSchema = z.string().uuid('Valid ID is required');

async function ensureSavedPaymentPurpose(
  supabase: Awaited<ReturnType<typeof createClient>>,
  companyId: string,
  userId: string,
  purposeLabel: string
): Promise<void> {
  const cleanLabel = purposeLabel.trim().slice(0, 80);
  if (!companyId || !cleanLabel) return;
  try {
    const { data: existing } = await supabase
      .from('payment_purposes')
      .select('id')
      .eq('company_id', companyId)
      .ilike('label', cleanLabel)
      .limit(1);

    if (existing && existing.length > 0) return;

    await supabase.from('payment_purposes').insert({
      company_id: companyId,
      label: cleanLabel,
      created_by: userId,
    });
  } catch {
    // Non-blocking: never fail payment creation/update if purpose auto-save fails
  }
}

async function syncReminderCompletionOnTransition(params: {
  companyId: string;
  reminderId: string | null | undefined;
  action: 'MARK_DONE' | 'REOPEN_IF_NO_ACTIVE';
}): Promise<void> {
  const { companyId, reminderId, action } = params;
  if (!companyId || !reminderId) return;

  try {
    const db =
      process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY
        ? createAdminClient()
        : await createClient();

    const { yearMonth, monthStartIso, nextMonthStartIso } = getCurrentISTInfo();

    if (action === 'MARK_DONE') {
      await db
        .from('recurring_reminders')
        .update({
          last_completed_month: yearMonth,
          updated_at: new Date().toISOString(),
        })
        .eq('id', reminderId)
        .eq('company_id', companyId);
      revalidatePath('/reminders');
      return;
    }

    const { data: activeSiblings } = await db
      .from('payment_items')
      .select('id')
      .eq('company_id', companyId)
      .eq('recurring_reminder_id', reminderId)
      .gte('created_at', monthStartIso)
      .lt('created_at', nextMonthStartIso)
      .not('status', 'in', '("REJECTED","CANCELLED")')
      .limit(1);

    if (!activeSiblings || activeSiblings.length === 0) {
      await db
        .from('recurring_reminders')
        .update({
          last_completed_month: null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', reminderId)
        .eq('company_id', companyId)
        .eq('last_completed_month', yearMonth);
      revalidatePath('/reminders');
    }
  } catch (err) {
    console.warn('[Reminders] Sync completion transition failed:', err);
  }
}

const MAX_FILE_SIZE = 4 * 1024 * 1024; // 4 MB
const ALLOWED_MIME_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
];

// Generic invoice reference values that should NOT trigger duplicate warnings
const GENERIC_INVOICE_REFS = new Set([
  'na',
  'n/a',
  'none',
  'on account',
  'onaccount',
  'advance',
  'transfer',
  '-',
  '--',
]);

// =========================================================================
// PART 1: ACCOUNTANT WORKSPACE ACTIONS
// =========================================================================

/**
 * Check if a vendor already has an active payment entry with the same Invoice / Ref No.
 * Ignores generic refs like 'NA', 'On Account', etc.
 */
export async function checkDuplicateInvoice(
  vendorId: string,
  invoiceRef: string,
  excludePaymentId?: string
): Promise<
  ActionResult<{
    isDuplicate: boolean;
    existingPayment?: { id: string; invoice_ref: string; sheet_date: string; status: string };
  }>
> {
  if (!vendorId || !invoiceRef) {
    return { success: true, data: { isDuplicate: false } };
  }

  const normalized = invoiceRef.trim().toLowerCase();
  if (GENERIC_INVOICE_REFS.has(normalized)) {
    return { success: true, data: { isDuplicate: false } };
  }

  const supabase = await createClient();
  const { user, activeCompany } = await getCurrentUserContext();
  if (!user) {
    return { success: true, data: { isDuplicate: false } };
  }

  let query = supabase
    .from('payment_items')
    .select('id, invoice_ref, sheet_date, status')
    .eq('vendor_id', vendorId)
    .ilike('invoice_ref', invoiceRef.trim())
    .not('status', 'in', '("REJECTED","CANCELLED")');

  if (activeCompany) {
    query = query.eq('company_id', activeCompany.id);
  }

  if (excludePaymentId) {
    query = query.neq('id', excludePaymentId);
  }

  const { data, error } = await query.limit(1);

  if (error) {
    return { success: false, error: error.message };
  }

  if (data && data.length > 0) {
    return {
      success: true,
      data: {
        isDuplicate: true,
        existingPayment: data[0],
      },
    };
  }

  return { success: true, data: { isDuplicate: false } };
}

/**
 * Upload an invoice attachment directly to the private 'supplier-invoices' bucket.
 */
export async function uploadInvoiceFile(
  formData: FormData
): Promise<ActionResult<{ filePath: string; fileName: string }>> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { success: false, error: 'Unauthorized. Please sign in.' };
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, is_admin, is_active')
    .eq('id', user.id)
    .single();

  if (
    !profile ||
    !profile.is_active ||
    (profile.role !== 'PREPARER' && profile.role !== 'APPROVER' && !profile.is_admin)
  ) {
    return { success: false, error: 'Unauthorized to upload payment invoices.' };
  }

  const file = formData.get('file') as File | null;
  if (!file || file.size === 0) {
    return { success: false, error: 'Please select an invoice file.' };
  }

  if (file.size > MAX_FILE_SIZE) {
    return { success: false, error: 'Invoice file exceeds 4 MB limit.' };
  }

  if (!ALLOWED_MIME_TYPES.includes(file.type)) {
    return { success: false, error: 'Invalid file format. Allowed: PDF, JPG, PNG, WEBP.' };
  }

  const { activeCompany } = await getCurrentUserContext();
  if (!activeCompany) {
    return { success: false, error: 'Active company workspace could not be determined.' };
  }

  const sanitizedName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80);
  const filePath = `${activeCompany.id}/invoices/${Date.now()}_${sanitizedName}`;

  const arrayBuffer = await file.arrayBuffer();
  const buffer = new Uint8Array(arrayBuffer);

  const magicCheck = validateDocumentMagicBytes(buffer, file.type);
  if (!magicCheck.valid) {
    return { success: false, error: magicCheck.error || 'Invalid file contents.' };
  }

  const { error: uploadError } = await supabase.storage
    .from('supplier-invoices')
    .upload(filePath, buffer, {
      contentType: magicCheck.detectedMime || file.type,
      upsert: false,
    });

  if (uploadError) {
    return { success: false, error: `Upload failed: ${uploadError.message}` };
  }

  return { success: true, data: { filePath, fileName: file.name } };
}

/**
 * Create a new payment entry as DRAFT or directly submit as PENDING_VERIFICATION.
 */
export async function createPayment(
  input: CreatePaymentInput,
  initialStatus: 'DRAFT' | 'PENDING_VERIFICATION' | 'PENDING_APPROVAL' = 'DRAFT'
): Promise<ActionResult<PaymentItem>> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { success: false, error: 'Unauthorized. Please sign in.' };
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, is_admin, is_active')
    .eq('id', user.id)
    .single();

  if (
    !profile ||
    !profile.is_active ||
    (profile.role !== 'PREPARER' && profile.role !== 'APPROVER' && !profile.is_admin)
  ) {
    return {
      success: false,
      error: 'Access denied: Only Preparers or Approvers can create payments.',
    };
  }

  const parsed = createPaymentSchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues[0]?.message || 'Invalid payment entry data.',
    };
  }

  const { activeCompany } = await getCurrentUserContext();
  if (!activeCompany) {
    return { success: false, error: 'Active company workspace could not be determined.' };
  }
  const company_id = activeCompany.id;

  const {
    sheet_date,
    due_date,
    vendor_id,
    invoice_ref,
    purpose,
    amount,
    tds = 0,
    source_bank_id,
    remarks,
    invoice_file_path,
    recurring_reminder_id,
  } = parsed.data;

  // Validate reminder belongs to the active company if provided
  let verifiedReminderId: string | null = null;
  if (recurring_reminder_id) {
    const { data: reminderCheck } = await supabase
      .from('recurring_reminders')
      .select('id')
      .eq('id', recurring_reminder_id)
      .eq('company_id', company_id)
      .maybeSingle();
    if (reminderCheck?.id) {
      verifiedReminderId = reminderCheck.id;
    }
  }

  // Safe rounding to 2 decimal places
  const cleanAmount = Math.round(amount * 100) / 100;
  const cleanTds = Math.round((tds || 0) * 100) / 100;

  const nowIso = new Date().toISOString();
  const isDirectSubmit = initialStatus === 'PENDING_VERIFICATION' || initialStatus === 'PENDING_APPROVAL';

  const { data: payment, error: insertError } = await supabase
    .from('payment_items')
    .insert({
      company_id,
      sheet_date,
      due_date,
      vendor_id,
      invoice_ref: invoice_ref.trim(),
      purpose: purpose.trim(),
      payment_type: parsed.data.payment_type || 'AGAINST_BILL',
      payment_mode: parsed.data.payment_mode || 'NEFT_RTGS',
      amount: cleanAmount,
      tds: cleanTds,
      source_bank_id,
      invoice_file_path: invoice_file_path || null,
      remarks: remarks?.trim() || null,
      recurring_reminder_id: verifiedReminderId,
      status: initialStatus,
      created_by: user.id,
      submitted_at: isDirectSubmit ? nowIso : null,
    })
    .select(
      '*, vendor:vendors(id, name, party_name, beneficiary_name, account_number, ifsc_code, whatsapp_number, remarks), source_bank:company_banks(id, short_name, full_name, short_code, bank_name, account_number_masked, account_mask), payer:profiles!paid_by(id, full_name, role)'
    )
    .single();

  if (insertError || !payment) {
    return {
      success: false,
      error: insertError?.message || 'Failed to create payment entry.',
    };
  }

  await ensureSavedPaymentPurpose(supabase, company_id, user.id, purpose);

  if (isDirectSubmit && company_id && verifiedReminderId) {
    await syncReminderCompletionOnTransition({
      companyId: company_id,
      reminderId: verifiedReminderId,
      action: 'MARK_DONE',
    });
  } else if (verifiedReminderId) {
    revalidatePath('/reminders');
  }

  if (initialStatus === 'PENDING_VERIFICATION' && company_id) {
    const partyName =
      payment.vendor?.party_name || payment.vendor?.name || 'Vendor';
    await dispatchWorkflowNotification({
      companyId: company_id,
      paymentItemId: payment.id,
      eventType: 'SUBMITTED_FOR_VERIFICATION',
      actorId: user.id,
      partyName,
      netPayable: Number(payment.net_payable || cleanAmount - cleanTds),
    });
  } else if (initialStatus === 'PENDING_APPROVAL' && company_id) {
    const partyName =
      payment.vendor?.party_name || payment.vendor?.name || 'Vendor';
    await dispatchWorkflowNotification({
      companyId: company_id,
      paymentItemId: payment.id,
      eventType: 'VERIFIED_FOR_APPROVAL',
      actorId: user.id,
      partyName,
      netPayable: Number(payment.net_payable || cleanAmount - cleanTds),
    });
  }

  revalidatePath('/payments');
  revalidatePath('/verify');
  revalidatePath('/approvals');
  revalidatePath('/tracker');
  return { success: true, data: payment };
}

/**
 * Update an existing DRAFT payment entry.
 */
export async function updateDraftPayment(
  input: UpdateDraftPaymentInput,
  targetStatus?: 'DRAFT' | 'PENDING_VERIFICATION' | 'PENDING_APPROVAL'
): Promise<ActionResult<PaymentItem>> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { success: false, error: 'Unauthorized. Please sign in.' };
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, is_admin, is_active')
    .eq('id', user.id)
    .single();

  if (
    !profile ||
    !profile.is_active ||
    (profile.role !== 'PREPARER' && profile.role !== 'APPROVER' && !profile.is_admin)
  ) {
    return {
      success: false,
      error: 'Access denied: Only Preparers or Approvers can edit payments.',
    };
  }

  const parsed = updateDraftPaymentSchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues[0]?.message || 'Invalid payment update data.',
    };
  }

  const {
    id,
    sheet_date,
    due_date,
    vendor_id,
    invoice_ref,
    purpose,
    payment_type,
    payment_mode,
    amount,
    tds = 0,
    source_bank_id,
    remarks,
    invoice_file_path,
    recurring_reminder_id,
  } = parsed.data;

  // Verify payment exists and belongs to activeCompany in DRAFT status
  const { activeCompany } = await getCurrentUserContext();
  if (!activeCompany) {
    return { success: false, error: 'Active company workspace could not be determined.' };
  }

  const { data: existing, error: fetchError } = await supabase
    .from('payment_items')
    .select('id, company_id, status, recurring_reminder_id')
    .eq('id', id)
    .eq('company_id', activeCompany.id)
    .single();

  if (fetchError || !existing) {
    return { success: false, error: 'Payment record not found.' };
  }

  if (existing.status !== 'DRAFT') {
    return {
      success: false,
      error: `Cannot edit payment in '${existing.status}' status. Only DRAFT records can be edited.`,
    };
  }

  let nextReminderId: string | null = existing.recurring_reminder_id ?? null;
  if (recurring_reminder_id !== undefined) {
    if (recurring_reminder_id) {
      const { data: reminderCheck } = await supabase
        .from('recurring_reminders')
        .select('id')
        .eq('id', recurring_reminder_id)
        .eq('company_id', activeCompany.id)
        .maybeSingle();
      nextReminderId = reminderCheck?.id || null;
    } else {
      nextReminderId = null;
    }
  }

  const cleanAmount = Math.round(amount * 100) / 100;
  const cleanTds = Math.round((tds || 0) * 100) / 100;

  const updatePayload: PaymentItemUpdate = {
    sheet_date,
    due_date,
    vendor_id,
    invoice_ref: invoice_ref.trim(),
    purpose: purpose.trim(),
    payment_type: payment_type || 'AGAINST_BILL',
    payment_mode: payment_mode || 'NEFT_RTGS',
    amount: cleanAmount,
    tds: cleanTds,
    source_bank_id,
    invoice_file_path: invoice_file_path || null,
    remarks: remarks?.trim() || null,
    recurring_reminder_id: nextReminderId,
    updated_at: new Date().toISOString(),
  };

  if (targetStatus === 'PENDING_VERIFICATION' || targetStatus === 'PENDING_APPROVAL') {
    updatePayload.status = targetStatus;
    updatePayload.submitted_at = new Date().toISOString();
  }

  const { data: updated, error: updateError } = await supabase
    .from('payment_items')
    .update(updatePayload)
    .eq('id', id)
    .select(
      '*, vendor:vendors(id, name, party_name, beneficiary_name, account_number, ifsc_code, whatsapp_number, remarks), source_bank:company_banks(id, short_name, full_name, short_code, bank_name, account_number_masked, account_mask), payer:profiles!paid_by(id, full_name, role)'
    )
    .single();

  if (updateError || !updated) {
    return {
      success: false,
      error: updateError?.message || 'Failed to update payment record.',
    };
  }

  if (targetStatus === 'PENDING_VERIFICATION' && updated.company_id) {
    const partyName =
      updated.vendor?.party_name || updated.vendor?.name || 'Vendor';
    await dispatchWorkflowNotification({
      companyId: updated.company_id,
      paymentItemId: updated.id,
      eventType: 'SUBMITTED_FOR_VERIFICATION',
      actorId: user.id,
      partyName,
      netPayable: Number(updated.net_payable || cleanAmount - cleanTds),
    });
  } else if (targetStatus === 'PENDING_APPROVAL' && updated.company_id) {
    const partyName =
      updated.vendor?.party_name || updated.vendor?.name || 'Vendor';
    await dispatchWorkflowNotification({
      companyId: updated.company_id,
      paymentItemId: updated.id,
      eventType: 'VERIFIED_FOR_APPROVAL',
      actorId: user.id,
      partyName,
      netPayable: Number(updated.net_payable || cleanAmount - cleanTds),
    });
  }

  await ensureSavedPaymentPurpose(supabase, activeCompany.id, user.id, purpose);

  if (
    (targetStatus === 'PENDING_VERIFICATION' || targetStatus === 'PENDING_APPROVAL') &&
    updated.company_id &&
    nextReminderId
  ) {
    await syncReminderCompletionOnTransition({
      companyId: updated.company_id,
      reminderId: nextReminderId,
      action: 'MARK_DONE',
    });
  } else if (nextReminderId || existing.recurring_reminder_id) {
    revalidatePath('/reminders');
  }

  revalidatePath('/payments');
  revalidatePath('/verify');
  revalidatePath('/approvals');
  revalidatePath('/tracker');
  return { success: true, data: updated };
}

/**
 * Submit an existing DRAFT payment to Verifier queue (PENDING_VERIFICATION).
 */
export async function submitPayment(
  paymentId: string
): Promise<ActionResult<PaymentItem>> {
  const parsedId = uuidSchema.safeParse(paymentId);
  if (!parsedId.success) {
    return { success: false, error: 'Invalid payment ID.' };
  }

  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { success: false, error: 'Unauthorized. Please sign in.' };
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, is_admin, is_active')
    .eq('id', user.id)
    .single();

  if (
    !profile ||
    !profile.is_active ||
    (profile.role !== 'PREPARER' && profile.role !== 'APPROVER' && !profile.is_admin)
  ) {
    return {
      success: false,
      error: 'Access denied: Only Preparers or Approvers can submit payments.',
    };
  }

  const { activeCompany } = await getCurrentUserContext();
  if (!activeCompany) {
    return { success: false, error: 'Active company workspace could not be determined.' };
  }

  const { data: existing, error: fetchError } = await supabase
    .from('payment_items')
    .select('id, company_id, status, recurring_reminder_id')
    .eq('id', paymentId)
    .eq('company_id', activeCompany.id)
    .single();

  if (fetchError || !existing) {
    return { success: false, error: 'Payment item not found.' };
  }

  if (existing.status !== 'DRAFT') {
    return {
      success: false,
      error: `Payment is already in '${existing.status}' status and cannot be re-submitted.`,
    };
  }

  const nowIso = new Date().toISOString();

  const { data: updated, error: updateError } = await supabase
    .from('payment_items')
    .update({
      status: 'PENDING_VERIFICATION',
      submitted_at: nowIso,
      updated_at: nowIso,
    })
    .eq('id', paymentId)
    .select(
      '*, vendor:vendors(id, name, party_name, beneficiary_name, account_number, ifsc_code, whatsapp_number, remarks), source_bank:company_banks(id, short_name, full_name, short_code, bank_name, account_number_masked, account_mask), payer:profiles!paid_by(id, full_name, role)'
    )
    .single();

  if (updateError || !updated) {
    return {
      success: false,
      error: updateError?.message || 'Failed to submit payment for verification.',
    };
  }

  if (updated.company_id) {
    const partyName =
      updated.vendor?.party_name || updated.vendor?.name || 'Vendor';
    await dispatchWorkflowNotification({
      companyId: updated.company_id,
      paymentItemId: updated.id,
      eventType: 'SUBMITTED_FOR_VERIFICATION',
      actorId: user.id,
      partyName,
      netPayable: Number(updated.net_payable || 0),
    });
  }

  if (updated.company_id && existing.recurring_reminder_id) {
    await syncReminderCompletionOnTransition({
      companyId: updated.company_id,
      reminderId: existing.recurring_reminder_id,
      action: 'MARK_DONE',
    });
  }

  revalidatePath('/payments');
  revalidatePath('/verify');
  revalidatePath('/approvals');
  revalidatePath('/tracker');
  return { success: true, data: updated };
}

export const submitForVerification = submitPayment;

/**
 * Verify a payment request (Senior Accountant / Verifier or Owner / Approver).
 * Transitions status from PENDING_VERIFICATION -> PENDING_APPROVAL.
 */
export async function verifyPayment(
  paymentId: string
): Promise<ActionResult<PaymentItem>> {
  const parsedId = uuidSchema.safeParse(paymentId);
  if (!parsedId.success) {
    return { success: false, error: 'Invalid payment ID.' };
  }

  const supabase = await createClient();
  const { user, profile } = await getCurrentUserContext();

  if (!user || !profile || !profile.is_active) {
    return { success: false, error: 'Unauthorized. Please sign in.' };
  }

  if (profile.role !== 'VERIFIER' && profile.role !== 'APPROVER' && !profile.is_admin) {
    return {
      success: false,
      error: 'Access denied: Only Verifiers, Approvers, or Admins can verify payments.',
    };
  }

  const { activeCompany } = await getCurrentUserContext();
  if (!activeCompany) {
    return { success: false, error: 'Active company workspace could not be determined.' };
  }

  const { data: existing, error: fetchError } = await supabase
    .from('payment_items')
    .select('id, company_id, status, recurring_reminder_id')
    .eq('id', paymentId)
    .eq('company_id', activeCompany.id)
    .single();

  if (fetchError || !existing) {
    return { success: false, error: 'Payment item not found.' };
  }

  if (existing.status !== 'PENDING_VERIFICATION') {
    return {
      success: false,
      error: `Cannot verify payment in '${existing.status}' status. Item must be Pending Verification.`,
    };
  }

  const nowIso = new Date().toISOString();

  const { data: updated, error: updateError } = await supabase
    .from('payment_items')
    .update({
      status: 'PENDING_APPROVAL',
      verified_by: user.id,
      verified_at: nowIso,
      updated_at: nowIso,
    })
    .eq('id', paymentId)
    .select(
      '*, vendor:vendors(id, name, party_name, beneficiary_name, account_number, ifsc_code, whatsapp_number, remarks), source_bank:company_banks(id, short_name, full_name, short_code, bank_name, account_number_masked, account_mask), payer:profiles!paid_by(id, full_name, role)'
    )
    .single();

  if (updateError || !updated) {
    return {
      success: false,
      error: updateError?.message || 'Failed to verify payment.',
    };
  }

  if (updated.company_id) {
    const partyName =
      updated.vendor?.party_name || updated.vendor?.name || 'Vendor';
    await dispatchWorkflowNotification({
      companyId: updated.company_id,
      paymentItemId: updated.id,
      eventType: 'VERIFIED_FOR_APPROVAL',
      actorId: user.id,
      partyName,
      netPayable: Number(updated.net_payable || 0),
    });
  }

  if (existing.recurring_reminder_id) {
    revalidatePath('/reminders');
  }

  revalidatePath('/verify');
  revalidatePath('/approvals');
  revalidatePath('/payments');
  revalidatePath('/history');
  revalidatePath('/tracker');
  return { success: true, data: updated as PaymentItem };
}


/**
 * Delete a payment entry (allowed ONLY for DRAFT status).
 */
export async function deleteDraftPayment(
  paymentId: string
): Promise<ActionResult<undefined>> {
  const parsedId = uuidSchema.safeParse(paymentId);
  if (!parsedId.success) {
    return { success: false, error: 'Invalid payment ID.' };
  }

  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { success: false, error: 'Unauthorized. Please sign in.' };
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, is_admin, is_active')
    .eq('id', user.id)
    .single();

  if (
    !profile ||
    !profile.is_active ||
    (profile.role !== 'PREPARER' && profile.role !== 'APPROVER' && !profile.is_admin)
  ) {
    return {
      success: false,
      error: 'Access denied: Only Accountants or Approvers can delete drafts.',
    };
  }

  const { activeCompany } = await getCurrentUserContext();
  if (!activeCompany) {
    return { success: false, error: 'Active company workspace could not be determined.' };
  }

  const { data: existing, error: fetchError } = await supabase
    .from('payment_items')
    .select('id, company_id, status, recurring_reminder_id')
    .eq('id', paymentId)
    .eq('company_id', activeCompany.id)
    .single();

  if (fetchError || !existing) {
    return { success: false, error: 'Payment item not found.' };
  }

  if (existing.status !== 'DRAFT') {
    return {
      success: false,
      error: `Cannot edit or delete record in '${existing.status}' status. Only DRAFT items can be deleted.`,
    };
  }

  const { error: deleteError } = await supabase
    .from('payment_items')
    .delete()
    .eq('id', paymentId);

  if (deleteError) {
    return {
      success: false,
      error: deleteError.message || 'Failed to delete draft payment.',
    };
  }

  if (existing.recurring_reminder_id) {
    revalidatePath('/reminders');
  }

  revalidatePath('/payments');
  revalidatePath('/approvals');
  revalidatePath('/tracker');
  return { success: true, data: undefined };
}

/**
 * Cancel a payment entry (for submitted or approved payments that should not be processed).
 * Never hard-deletes; sets status to 'CANCELLED'.
 */
export async function cancelPayment(
  paymentId: string
): Promise<ActionResult<PaymentItem>> {
  const parsedId = uuidSchema.safeParse(paymentId);
  if (!parsedId.success) {
    return { success: false, error: 'Invalid payment ID.' };
  }

  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { success: false, error: 'Unauthorized. Please sign in.' };
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, is_admin, is_active')
    .eq('id', user.id)
    .single();

  if (
    !profile ||
    !profile.is_active ||
    (profile.role !== 'PREPARER' && profile.role !== 'APPROVER' && !profile.is_admin)
  ) {
    return {
      success: false,
      error: 'Access denied: Only Accountants or Approvers can cancel payments.',
    };
  }

  const { activeCompany } = await getCurrentUserContext();
  if (!activeCompany) {
    return { success: false, error: 'Active company workspace could not be determined.' };
  }

  const { data: existing, error: fetchError } = await supabase
    .from('payment_items')
    .select('id, company_id, status, recurring_reminder_id')
    .eq('id', paymentId)
    .eq('company_id', activeCompany.id)
    .single();

  if (fetchError || !existing) {
    return { success: false, error: 'Payment record not found.' };
  }

  if (['PAID', 'REJECTED', 'CANCELLED'].includes(existing.status)) {
    return {
      success: false,
      error: `Payment is already finalized (${existing.status}) and cannot be cancelled.`,
    };
  }

  const nowIso = new Date().toISOString();

  const { data: updated, error: updateError } = await supabase
    .from('payment_items')
    .update({
      status: 'CANCELLED',
      updated_at: nowIso,
    })
    .eq('id', paymentId)
    .select(
      '*, vendor:vendors(id, name, party_name, beneficiary_name, account_number, ifsc_code, whatsapp_number, remarks), source_bank:company_banks(id, short_name, full_name, short_code, bank_name, account_number_masked, account_mask), payer:profiles!paid_by(id, full_name, role)'
    )
    .single();

  if (updateError || !updated) {
    return {
      success: false,
      error: updateError?.message || 'Failed to cancel payment record.',
    };
  }

  if (existing.recurring_reminder_id) {
    await syncReminderCompletionOnTransition({
      companyId: existing.company_id || activeCompany.id,
      reminderId: existing.recurring_reminder_id,
      action: 'REOPEN_IF_NO_ACTIVE',
    });
  }

  revalidatePath('/payments');
  revalidatePath('/approvals');
  revalidatePath('/tracker');
  return { success: true, data: updated };
}

// =========================================================================
// PART 2: APPROVAL AUTHORIZATION & VERIFICATION ACTIONS
// =========================================================================

/**
 * Approve a payment request (APPROVER role or Admin strictly verified on server).
 * Transitions status from PENDING_APPROVAL / ON_HOLD / PENDING_VERIFICATION (Owner Override) -> APPROVED.
 */
export async function ownerApprovePayment(
  paymentId: string
): Promise<ActionResult<PaymentItem>> {
  const parsedId = uuidSchema.safeParse(paymentId);
  if (!parsedId.success) {
    return { success: false, error: 'Invalid payment ID.' };
  }

  const supabase = await createClient();
  const { user, profile } = await getCurrentUserContext();

  if (!user || !profile || !profile.is_active) {
    return { success: false, error: 'Unauthorized. Please sign in.' };
  }

  if (profile.role !== 'APPROVER' && !profile.is_admin) {
    return { success: false, error: 'Access denied: Only Approvers can authorize payments.' };
  }

  const { activeCompany } = await getCurrentUserContext();
  if (!activeCompany) {
    return { success: false, error: 'Active company workspace could not be determined.' };
  }

  const { data: existing, error: fetchError } = await supabase
    .from('payment_items')
    .select('id, company_id, status, recurring_reminder_id')
    .eq('id', paymentId)
    .eq('company_id', activeCompany.id)
    .single();

  if (fetchError || !existing) {
    return { success: false, error: 'Payment item not found.' };
  }

  if (
    existing.status !== 'PENDING_APPROVAL' &&
    existing.status !== 'ON_HOLD' &&
    existing.status !== 'PENDING_VERIFICATION'
  ) {
    return {
      success: false,
      error: `Cannot approve payment in '${existing.status}' status. Item must be Pending, On Hold, or Awaiting Verification.`,
    };
  }

  const nowIso = new Date().toISOString();

  const { data: updated, error: updateError } = await supabase
    .from('payment_items')
    .update({
      status: 'APPROVED',
      approved_by: user.id,
      approved_at: nowIso,
      updated_at: nowIso,
    })
    .eq('id', paymentId)
    .select(
      '*, vendor:vendors(id, name, party_name, beneficiary_name, account_number, ifsc_code, whatsapp_number, remarks), source_bank:company_banks(id, short_name, full_name, short_code, bank_name, account_number_masked, account_mask), payer:profiles!paid_by(id, full_name, role)'
    )
    .single();

  if (updateError || !updated) {
    return {
      success: false,
      error: updateError?.message || 'Failed to approve payment.',
    };
  }

  if (updated.company_id) {
    const partyName =
      updated.vendor?.party_name || updated.vendor?.name || 'Vendor';
    await dispatchWorkflowNotification({
      companyId: updated.company_id,
      paymentItemId: updated.id,
      eventType: 'APPROVED',
      actorId: user.id,
      partyName,
      netPayable: Number(updated.net_payable || 0),
      createdById: updated.created_by,
    });
  }

  if (existing.recurring_reminder_id) {
    revalidatePath('/reminders');
  }

  revalidatePath('/approvals');
  revalidatePath('/verify');
  revalidatePath('/payments');
  revalidatePath('/history');
  revalidatePath('/tracker');
  return { success: true, data: updated as PaymentItem };
}

export const approvePayment = ownerApprovePayment;

/**
 * Bulk approve multiple payments at once (APPROVER role or Admin strictly verified).
 */
export async function bulkApprovePayments(
  paymentIds: string[]
): Promise<ActionResult<{ count: number; approvedIds: string[] }>> {
  if (!paymentIds || paymentIds.length === 0) {
    return { success: false, error: 'No payments selected for approval.' };
  }

  const supabase = await createClient();
  const { user, profile, activeCompany } = await getCurrentUserContext();

  if (!user || !profile || !profile.is_active) {
    return { success: false, error: 'Unauthorized. Please sign in.' };
  }

  if (profile.role !== 'APPROVER' && !profile.is_admin) {
    return { success: false, error: 'Access denied: Only Approvers can authorize bulk payments.' };
  }

  if (!activeCompany) {
    return { success: false, error: 'Active company workspace could not be determined.' };
  }

  const { data: eligibleItems, error: fetchError } = await supabase
    .from('payment_items')
    .select('id, status, net_payable, created_by')
    .eq('company_id', activeCompany.id)
    .in('id', paymentIds)
    .in('status', ['PENDING_APPROVAL', 'ON_HOLD', 'PENDING_VERIFICATION']);

  if (fetchError || !eligibleItems || eligibleItems.length === 0) {
    return { success: false, error: 'No eligible items found for approval.' };
  }

  const nowIso = new Date().toISOString();
  const eligibleIds = eligibleItems.map((item) => item.id);
  const totalApprovedNet = eligibleItems.reduce(
    (sum, item) => sum + Number(item.net_payable || 0),
    0
  );

  const { error: updateError } = await supabase
    .from('payment_items')
    .update({
      status: 'APPROVED',
      approved_by: user.id,
      approved_at: nowIso,
      updated_at: nowIso,
    })
    .eq('company_id', activeCompany.id)
    .in('id', eligibleIds);

  if (updateError) {
    return { success: false, error: updateError.message || 'Failed to bulk approve payments.' };
  }

  const creatorIds = Array.from(
    new Set(
      eligibleItems
        .map((item) => item.created_by)
        .filter((id): id is string => Boolean(id))
    )
  );
  const countLabel = `${eligibleIds.length} payment${eligibleIds.length === 1 ? '' : 's'}`;

  await dispatchWorkflowNotification({
    companyId: activeCompany.id,
    paymentItemId: eligibleIds[0] || null,
    eventType: 'APPROVED',
    actorId: user.id,
    partyName: countLabel,
    netPayable: totalApprovedNet,
    createdByIds: creatorIds,
    customTitle: `[${activeCompany.code}] ${countLabel} approved — Ready to Pay`,
    customBody: `${countLabel} (${formatINR(totalApprovedNet)}) approved — Ready to Pay.`,
  });

  revalidatePath('/approvals');
  revalidatePath('/verify');
  revalidatePath('/payments');
  revalidatePath('/history');
  revalidatePath('/tracker');
  return { success: true, data: { count: eligibleIds.length, approvedIds: eligibleIds } };
}

/**
 * Toggle hold status on a payment item (APPROVER role strictly verified).
 * PENDING_APPROVAL -> ON_HOLD, or ON_HOLD -> PENDING_APPROVAL (Resume).
 */
export async function ownerHoldPayment(
  paymentId: string
): Promise<ActionResult<PaymentItem>> {
  const parsedId = uuidSchema.safeParse(paymentId);
  if (!parsedId.success) {
    return { success: false, error: 'Invalid payment ID.' };
  }

  const supabase = await createClient();
  const { user, profile } = await getCurrentUserContext();

  if (!user || !profile || !profile.is_active) {
    return { success: false, error: 'Unauthorized. Please sign in.' };
  }

  if (profile.role !== 'APPROVER' && !profile.is_admin) {
    return { success: false, error: 'Access denied: Only the Approver can place payments on hold.' };
  }

  const { activeCompany } = await getCurrentUserContext();
  if (!activeCompany) {
    return { success: false, error: 'Active company workspace could not be determined.' };
  }

  const { data: existing, error: fetchError } = await supabase
    .from('payment_items')
    .select('id, company_id, status, recurring_reminder_id')
    .eq('id', paymentId)
    .eq('company_id', activeCompany.id)
    .single();

  if (fetchError || !existing) {
    return { success: false, error: 'Payment item not found.' };
  }

  if (existing.status !== 'PENDING_APPROVAL' && existing.status !== 'ON_HOLD') {
    return {
      success: false,
      error: `Cannot hold payment in '${existing.status}' status. Item must be Pending or On Hold.`,
    };
  }

  const newStatus = existing.status === 'ON_HOLD' ? 'PENDING_APPROVAL' : 'ON_HOLD';
  const nowIso = new Date().toISOString();

  const { data: updated, error: updateError } = await supabase
    .from('payment_items')
    .update({
      status: newStatus,
      updated_at: nowIso,
    })
    .eq('id', paymentId)
    .select(
      '*, vendor:vendors(id, name, party_name, beneficiary_name, account_number, ifsc_code, whatsapp_number, remarks), source_bank:company_banks(id, short_name, full_name, short_code, bank_name, account_number_masked, account_mask), payer:profiles!paid_by(id, full_name, role)'
    )
    .single();

  if (updateError || !updated) {
    return {
      success: false,
      error: updateError?.message || 'Failed to update hold status.',
    };
  }

  if (newStatus === 'ON_HOLD' && updated.company_id) {
    const partyName =
      updated.vendor?.party_name || updated.vendor?.name || 'Vendor';
    await dispatchWorkflowNotification({
      companyId: updated.company_id,
      paymentItemId: updated.id,
      eventType: 'HELD',
      actorId: user.id,
      partyName,
      netPayable: Number(updated.net_payable || 0),
      createdById: updated.created_by,
    });
  }

  if (existing.recurring_reminder_id) {
    revalidatePath('/reminders');
  }

  revalidatePath('/approvals');
  revalidatePath('/payments');
  revalidatePath('/history');
  revalidatePath('/tracker');
  return { success: true, data: updated as PaymentItem };
}

export const holdPayment = ownerHoldPayment;

/**
 * Reject a payment request with a mandatory rejection reason.
 * Allowed for Verifier (for PENDING_VERIFICATION) or Approver/Admin (for PENDING_VERIFICATION, PENDING_APPROVAL, ON_HOLD).
 */
export async function ownerRejectPayment(
  paymentId: string,
  rejectionReason: string
): Promise<ActionResult<PaymentItem>> {
  const parsed = rejectPaymentSchema.safeParse({
    payment_id: paymentId,
    rejection_reason: rejectionReason,
  });

  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues[0]?.message || 'Valid rejection reason is required.',
    };
  }

  const supabase = await createClient();
  const { user, profile } = await getCurrentUserContext();

  if (!user || !profile || !profile.is_active) {
    return { success: false, error: 'Unauthorized. Please sign in.' };
  }

  if (
    profile.role !== 'VERIFIER' &&
    profile.role !== 'APPROVER' &&
    !profile.is_admin
  ) {
    return { success: false, error: 'Access denied: Unauthorized to reject payments.' };
  }

  const { activeCompany } = await getCurrentUserContext();
  if (!activeCompany) {
    return { success: false, error: 'Active company workspace could not be determined.' };
  }

  const { data: existing, error: fetchError } = await supabase
    .from('payment_items')
    .select('id, company_id, status, recurring_reminder_id')
    .eq('id', paymentId)
    .eq('company_id', activeCompany.id)
    .single();

  if (fetchError || !existing) {
    return { success: false, error: 'Payment item not found.' };
  }

  const canReject =
    existing.status === 'PENDING_VERIFICATION' ||
    ((profile.role === 'APPROVER' || profile.is_admin) &&
      (existing.status === 'PENDING_APPROVAL' || existing.status === 'ON_HOLD'));

  if (!canReject) {
    return {
      success: false,
      error: `Cannot reject payment in '${existing.status}' status.`,
    };
  }

  const nowIso = new Date().toISOString();

  const { data: updated, error: updateError } = await supabase
    .from('payment_items')
    .update({
      status: 'REJECTED',
      rejection_reason: parsed.data.rejection_reason,
      updated_at: nowIso,
    })
    .eq('id', paymentId)
    .select(
      '*, vendor:vendors(id, name, party_name, beneficiary_name, account_number, ifsc_code, whatsapp_number, remarks), source_bank:company_banks(id, short_name, full_name, short_code, bank_name, account_number_masked, account_mask), payer:profiles!paid_by(id, full_name, role)'
    )
    .single();

  if (updateError || !updated) {
    return {
      success: false,
      error: updateError?.message || 'Failed to reject payment.',
    };
  }

  if (updated.company_id) {
    const partyName =
      updated.vendor?.party_name || updated.vendor?.name || 'Vendor';
    await dispatchWorkflowNotification({
      companyId: updated.company_id,
      paymentItemId: updated.id,
      eventType: 'REJECTED',
      actorId: user.id,
      partyName,
      netPayable: Number(updated.net_payable || 0),
      reason: parsed.data.rejection_reason,
      createdById: updated.created_by,
    });
  }

  if (existing.recurring_reminder_id) {
    await syncReminderCompletionOnTransition({
      companyId: existing.company_id || activeCompany.id,
      reminderId: existing.recurring_reminder_id,
      action: 'REOPEN_IF_NO_ACTIVE',
    });
  }

  revalidatePath('/approvals');
  revalidatePath('/verify');
  revalidatePath('/payments');
  revalidatePath('/history');
  revalidatePath('/tracker');
  return { success: true, data: updated as PaymentItem };
}

export const rejectPayment = ownerRejectPayment;

/**
 * Switch source bank for a payment item before approval.
 * Allowed for Approver, Verifier, Preparer, Admin on unapproved items.
 * Core financial lock ensures this cannot be called once status is APPROVED or PAID.
 */
export async function ownerSwitchBank(
  paymentId: string,
  newBankId: string
): Promise<ActionResult<PaymentItem>> {
  const parsed = switchBankSchema.safeParse({
    payment_id: paymentId,
    new_bank_id: newBankId,
  });

  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues[0]?.message || 'Invalid bank selection.',
    };
  }

  const supabase = await createClient();
  const { user, profile } = await getCurrentUserContext();

  if (!user || !profile || !profile.is_active) {
    return { success: false, error: 'Unauthorized. Please sign in.' };
  }

  const { activeCompany } = await getCurrentUserContext();
  if (!activeCompany) {
    return { success: false, error: 'Active company workspace could not be determined.' };
  }

  const { data: existing, error: fetchError } = await supabase
    .from('payment_items')
    .select('id, company_id, status, recurring_reminder_id')
    .eq('id', paymentId)
    .eq('company_id', activeCompany.id)
    .single();

  if (fetchError || !existing) {
    return { success: false, error: 'Payment item not found.' };
  }

  if (existing.status === 'APPROVED' || existing.status === 'PAID') {
    return {
      success: false,
      error: 'Cannot change bank: Payment details are locked after approval.',
    };
  }

  // Verify the target bank belongs to the active company
  const { data: targetBank } = await supabase
    .from('company_banks')
    .select('id')
    .eq('id', parsed.data.new_bank_id)
    .eq('company_id', activeCompany.id)
    .maybeSingle();

  if (!targetBank) {
    return {
      success: false,
      error: 'Selected bank does not belong to the active company workspace.',
    };
  }

  const nowIso = new Date().toISOString();

  const { data: updated, error: updateError } = await supabase
    .from('payment_items')
    .update({
      source_bank_id: parsed.data.new_bank_id,
      updated_at: nowIso,
    })
    .eq('id', paymentId)
    .select(
      '*, vendor:vendors(id, name, party_name, beneficiary_name, account_number, ifsc_code, whatsapp_number, remarks), source_bank:company_banks(id, short_name, full_name, short_code, bank_name, account_number_masked, account_mask), payer:profiles!paid_by(id, full_name, role)'
    )
    .single();

  if (updateError || !updated) {
    return {
      success: false,
      error: updateError?.message || 'Failed to update payment source bank.',
    };
  }

  if (existing.recurring_reminder_id) {
    revalidatePath('/reminders');
  }

  revalidatePath('/approvals');
  revalidatePath('/verify');
  revalidatePath('/payments');
  revalidatePath('/history');
  revalidatePath('/tracker');
  return { success: true, data: updated as PaymentItem };
}

export const switchPaymentBank = ownerSwitchBank;

/**
 * Fetch audit logs for a payment record joined with performer profile info.
 */
export async function getPaymentAuditLogs(
  paymentId: string
): Promise<ActionResult<AuditLog[]>> {
  const parsedId = uuidSchema.safeParse(paymentId);
  if (!parsedId.success) {
    return { success: false, error: 'Invalid payment ID.' };
  }

  const { user, profile, activeCompany } = await getCurrentUserContext();
  if (!user || !profile || !profile.is_active) {
    return { success: false, error: 'Unauthorized. Please sign in.' };
  }

  if (!activeCompany) {
    return { success: false, error: 'No active company selected.' };
  }

  const supabase = await createClient();

  const { data: paymentRow } = await supabase
    .from('payment_items')
    .select('id')
    .eq('id', paymentId)
    .eq('company_id', activeCompany.id)
    .maybeSingle();

  if (!paymentRow) {
    return { success: false, error: 'Payment record not found in active company.' };
  }

  const { data: logs, error } = await supabase
    .from('audit_logs')
    .select('*, performer:profiles(id, full_name, role)')
    .eq('company_id', activeCompany.id)
    .eq('record_id', paymentId)
    .order('created_at', { ascending: false });

  if (error) {
    return { success: false, error: error.message };
  }

  return { success: true, data: (logs || []) as AuditLog[] };
}

// =========================================================================
// PART 3: UTR RECONCILIATION & DISBURSEMENT (POST-APPROVAL CYCLE)
// =========================================================================

/**
 * Upload a bank transaction receipt file to the private 'bank-receipts' bucket.
 * Path convention: <company_id>/<payment_id>/<timestamp>_<sanitized_filename>
 */
export async function uploadReceiptFile(
  formData: FormData
): Promise<ActionResult<{ filePath: string; fileName: string }>> {
  const supabase = await createClient();
  const { user, profile, activeCompany } = await getCurrentUserContext();

  if (!user || !profile || !profile.is_active) {
    return { success: false, error: 'Unauthorized. Please sign in.' };
  }

  if (profile.role !== 'PREPARER' && !profile.is_admin) {
    return {
      success: false,
      error: 'Access denied: Only Preparers or Administrators can upload bank receipts.',
    };
  }

  if (!activeCompany) {
    return { success: false, error: 'Active company workspace could not be determined.' };
  }

  const file = formData.get('file') as File | null;
  if (!file || file.size === 0) {
    return { success: false, error: 'Please select a bank receipt file.' };
  }

  if (file.size > MAX_FILE_SIZE) {
    return { success: false, error: 'Receipt file exceeds 4 MB limit.' };
  }

  if (!ALLOWED_MIME_TYPES.includes(file.type)) {
    return { success: false, error: 'Invalid file format. Allowed: PDF, JPG, PNG, WEBP.' };
  }

  const rawPaymentId = String(formData.get('paymentId') || '').trim();
  const folderPaymentId = uuidSchema.safeParse(rawPaymentId).success
    ? rawPaymentId
    : 'unlinked';

  const sanitizedName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80);
  const filePath = `${activeCompany.id}/${folderPaymentId}/${Date.now()}_${sanitizedName}`;

  const arrayBuffer = await file.arrayBuffer();
  const buffer = new Uint8Array(arrayBuffer);

  const magicCheck = validateDocumentMagicBytes(buffer, file.type);
  if (!magicCheck.valid) {
    return { success: false, error: magicCheck.error || 'Invalid file contents.' };
  }

  const { error: uploadError } = await supabase.storage
    .from('bank-receipts')
    .upload(filePath, buffer, {
      contentType: magicCheck.detectedMime || file.type,
      upsert: false,
    });

  if (uploadError) {
    return { success: false, error: `Upload failed: ${uploadError.message}` };
  }

  return { success: true, data: { filePath, fileName: file.name } };
}

/**
 * Mark an APPROVED payment as PAID (supports NEFT_RTGS with UTR + Bank PDF,
 * or CHEQUE with Cheque No + Cheque Date + optional receipt).
 * Enforces duplicate UTR check and maps Postgres 23505 unique error.
 * Does NOT dispatch workflow notifications on PAID.
 */
export async function markPaymentPaid(
  input: MarkPaidInput
): Promise<ActionResult<PaymentItem>> {
  const parsed = markPaidSchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues[0]?.message || 'Invalid payment settlement data.',
    };
  }

  const {
    payment_id,
    utr_number,
    cheque_number,
    cheque_date,
    receipt_file_path,
    remarks,
  } = parsed.data;

  const supabase = await createClient();
  const { user, profile, activeCompany } = await getCurrentUserContext();

  if (!user || !profile || !profile.is_active) {
    return { success: false, error: 'Unauthorized. Please sign in.' };
  }

  if (profile.role !== 'PREPARER' && !profile.is_admin) {
    return {
      success: false,
      error: 'Access denied: Only Preparers or Administrators can mark payments as Paid.',
    };
  }

  if (!activeCompany) {
    return { success: false, error: 'Active company workspace could not be determined.' };
  }

  const { data: existing, error: fetchError } = await supabase
    .from('payment_items')
    .select('id, company_id, status, payment_mode, remarks, recurring_reminder_id')
    .eq('id', payment_id)
    .eq('company_id', activeCompany.id)
    .single();

  if (fetchError || !existing) {
    return { success: false, error: 'Payment item not found in the active company.' };
  }

  if (existing.status !== 'APPROVED') {
    return {
      success: false,
      error: `Cannot mark payment as Paid. Current status is '${existing.status}', but must be 'APPROVED'.`,
    };
  }

  const mode = (existing.payment_mode || parsed.data.payment_mode || 'NEFT_RTGS') as
    | 'NEFT_RTGS'
    | 'IMPS'
    | 'CHEQUE';

  const nowIso = new Date().toISOString();
  let updateFields: PaymentItemUpdate = {
    status: 'PAID',
    remarks: remarks?.trim() || existing.remarks,
    paid_by: user.id,
    paid_at: nowIso,
    updated_at: nowIso,
  };

  if (mode === 'NEFT_RTGS' || mode === 'IMPS') {
    const modeText = mode === 'IMPS' ? 'IMPS' : 'NEFT/RTGS';
    const cleanUtr = (utr_number || '').trim().toUpperCase();
    if (!cleanUtr) {
      return {
        success: false,
        error: `UTR / Payment Reference Number is required for ${modeText} payments.`,
      };
    }

    if (!receipt_file_path || !receipt_file_path.trim()) {
      return {
        success: false,
        error: `Bank Acknowledgement PDF / Receipt upload is required for ${modeText} payments.`,
      };
    }

    // Proactive duplicate UTR check across all payments
    const { data: duplicateUtr } = await supabase
      .from('payment_items')
      .select('id, invoice_ref')
      .ilike('utr_number', cleanUtr)
      .neq('id', payment_id)
      .maybeSingle();

    if (duplicateUtr) {
      return {
        success: false,
        error: `This UTR number is already recorded on invoice "${duplicateUtr.invoice_ref}". Please verify and enter a unique UTR.`,
      };
    }

    updateFields = {
      ...updateFields,
      utr_number: cleanUtr,
      cheque_number: null,
      cheque_date: null,
      receipt_file_path: receipt_file_path.trim(),
    };
  } else {
    const cleanChequeNo = (cheque_number || '').trim();
    const cleanChequeDate = (cheque_date || '').trim();

    if (!cleanChequeNo) {
      return {
        success: false,
        error: 'Cheque Number is required for Cheque settlements.',
      };
    }
    if (!cleanChequeDate || !/^\d{4}-\d{2}-\d{2}$/.test(cleanChequeDate)) {
      return {
        success: false,
        error: 'A valid Cheque Date (YYYY-MM-DD) is required for Cheque settlements.',
      };
    }

    updateFields = {
      ...updateFields,
      utr_number: null,
      cheque_number: cleanChequeNo,
      cheque_date: cleanChequeDate,
      receipt_file_path: receipt_file_path?.trim() || null,
    };
  }

  const { data: updated, error: updateError } = await supabase
    .from('payment_items')
    .update(updateFields)
    .eq('id', payment_id)
    .eq('company_id', activeCompany.id)
    .select(
      '*, vendor:vendors(id, name, party_name, beneficiary_name, account_number, ifsc_code, whatsapp_number, remarks), source_bank:company_banks(id, short_name, full_name, short_code, bank_name, account_number_masked, account_mask), payer:profiles!paid_by(id, full_name, role)'
    )
    .single();

  if (updateError) {
    if (
      updateError.code === '23505' ||
      updateError.message.toLowerCase().includes('unique') ||
      updateError.message.toLowerCase().includes('utr')
    ) {
      return {
        success: false,
        error:
          'This UTR number is already recorded on another payment. Please verify and enter a unique UTR.',
      };
    }

    return {
      success: false,
      error: updateError.message || 'Failed to mark payment as Paid.',
    };
  }

  if (!updated) {
    return { success: false, error: 'Failed to mark payment as Paid.' };
  }

  if (existing.recurring_reminder_id) {
    await syncReminderCompletionOnTransition({
      companyId: existing.company_id || activeCompany.id,
      reminderId: existing.recurring_reminder_id,
      action: 'MARK_DONE',
    });
  }

  revalidatePath('/payments');
  revalidatePath('/approvals');
  revalidatePath('/tracker');
  revalidatePath('/audit');
  revalidatePath('/history');
  revalidatePath('/print');
  return { success: true, data: updated as PaymentItem };
}

export const markPaidWithUtr = markPaymentPaid;

/**
 * Batch-settle multiple APPROVED payments with a single combined Bank Receipt PDF/Image.
 * Creates a public.payment_batches record (e.g., BATCH-20261127-01), validates all UTRs/Cheques
 * in pre-flight before mutating, transitions all items to PAID linked via batch_id,
 * records audit logs, and dispatches grouped notifications + Web Push to Approver/Verifier/Auditor.
 */
export async function settlePaymentBatch(
  input: SettlePaymentBatchInput
): Promise<ActionResult<{ batch: PaymentBatch; payments: PaymentItem[] }>> {
  const parsed = settlePaymentBatchSchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues[0]?.message || 'Invalid batch settlement data.',
    };
  }

  const supabase = await createClient();
  const { user, profile, activeCompany } = await getCurrentUserContext();

  if (!user || !profile || !profile.is_active) {
    return { success: false, error: 'Unauthorized. Please sign in.' };
  }

  if (profile.role !== 'PREPARER' && !profile.is_admin) {
    return {
      success: false,
      error: 'Access denied: Only Preparers or Administrators can settle payment batches.',
    };
  }

  if (!activeCompany) {
    return { success: false, error: 'Active company workspace could not be determined.' };
  }

  const batchDate = parsed.data.batch_date || getTodayISTDateString();
  const receiptFilePath = parsed.data.receipt_file_path.trim();
  const labelNote = parsed.data.batch_label?.trim() || '';
  const bodyNote = parsed.data.notes?.trim() || '';
  const combinedNotes =
    labelNote && bodyNote
      ? `${labelNote} — ${bodyNote}`
      : labelNote || bodyNote || null;

  const requestedItems = parsed.data.items;
  const requestedIds = requestedItems.map((i) => i.payment_id);

  if (new Set(requestedIds).size !== requestedIds.length) {
    return { success: false, error: 'Duplicate payment items found in batch selection.' };
  }

  // 1. Pre-flight: Fetch & verify every requested payment belongs to activeCompany and is APPROVED
  const { data: fetchedItems, error: fetchError } = await supabase
    .from('payment_items')
    .select(
      'id, company_id, status, payment_mode, source_bank_id, net_payable, invoice_ref, remarks, recurring_reminder_id'
    )
    .eq('company_id', activeCompany.id)
    .in('id', requestedIds);

  if (fetchError) {
    return { success: false, error: fetchError.message || 'Failed to validate batch items.' };
  }

  if (!fetchedItems || fetchedItems.length !== requestedItems.length) {
    return {
      success: false,
      error: 'One or more selected payments could not be found in the active company.',
    };
  }

  const itemById = new Map(fetchedItems.map((p) => [p.id, p]));
  const seenBatchUtrs = new Map<string, string>();
  const resolvedItemUpdates: Array<{
    payment_id: string;
    payment_mode: 'NEFT_RTGS' | 'IMPS' | 'CHEQUE';
    utr_number: string | null;
    cheque_number: string | null;
    cheque_date: string | null;
    existing_remarks: string | null;
    recurring_reminder_id: string | null;
  }> = [];

  for (const itemInput of requestedItems) {
    const dbItem = itemById.get(itemInput.payment_id);
    if (!dbItem) {
      return { success: false, error: 'Invalid payment item in batch.' };
    }
    if (dbItem.status !== 'APPROVED') {
      return {
        success: false,
        error: `Payment "${dbItem.invoice_ref}" is in '${dbItem.status}' status. Only APPROVED payments can be batch-settled.`,
      };
    }

    const mode = (dbItem.payment_mode || 'NEFT_RTGS') as 'NEFT_RTGS' | 'IMPS' | 'CHEQUE';

    if (mode === 'NEFT_RTGS' || mode === 'IMPS') {
      const cleanUtr = (itemInput.utr_number || '').trim().toUpperCase();
      if (!cleanUtr) {
        return {
          success: false,
          error: `UTR / Reference Number is required for invoice "${dbItem.invoice_ref}".`,
        };
      }
      if (seenBatchUtrs.has(cleanUtr)) {
        return {
          success: false,
          error: `Duplicate UTR "${cleanUtr}" entered within this batch (invoices "${seenBatchUtrs.get(cleanUtr)}" and "${dbItem.invoice_ref}").`,
        };
      }
      seenBatchUtrs.set(cleanUtr, dbItem.invoice_ref || dbItem.id);

      resolvedItemUpdates.push({
        payment_id: dbItem.id,
        payment_mode: mode,
        utr_number: cleanUtr,
        cheque_number: null,
        cheque_date: null,
        existing_remarks: dbItem.remarks ?? null,
        recurring_reminder_id: dbItem.recurring_reminder_id ?? null,
      });
    } else {
      const cleanChequeNo = (itemInput.cheque_number || '').trim();
      const cleanChequeDate = (itemInput.cheque_date || '').trim() || batchDate;
      if (!cleanChequeNo) {
        return {
          success: false,
          error: `Cheque Number is required for invoice "${dbItem.invoice_ref}".`,
        };
      }
      resolvedItemUpdates.push({
        payment_id: dbItem.id,
        payment_mode: mode,
        utr_number: null,
        cheque_number: cleanChequeNo,
        cheque_date: cleanChequeDate,
        existing_remarks: dbItem.remarks ?? null,
        recurring_reminder_id: dbItem.recurring_reminder_id ?? null,
      });
    }
  }

  // 2. Pre-flight: Check database for any existing duplicate UTRs across all payments
  const batchUtrList = Array.from(seenBatchUtrs.keys());
  if (batchUtrList.length > 0) {
    const { data: existingUtrRows, error: utrCheckError } = await supabase
      .from('payment_items')
      .select('id, utr_number, invoice_ref')
      .in('utr_number', batchUtrList);

    if (utrCheckError) {
      return { success: false, error: utrCheckError.message || 'Failed to validate UTR uniqueness.' };
    }

    const conflicting = (existingUtrRows || []).find(
      (row) => !requestedIds.includes(row.id)
    );
    if (conflicting) {
      return {
        success: false,
        error: `UTR "${conflicting.utr_number}" is already recorded on invoice "${conflicting.invoice_ref}". Please enter unique UTRs.`,
      };
    }
  }

  // 3. Execute single atomic PostgreSQL transaction via RPC (advisory lock + FOR UPDATE + batch insert + items update + audit log)
  const rpcItemsPayload = resolvedItemUpdates.map((upd) => ({
    payment_id: upd.payment_id,
    utr_number: upd.utr_number,
    cheque_number: upd.cheque_number,
    cheque_date: upd.cheque_date,
  }));

  const { data: atomicResult, error: rpcError } = await supabase.rpc(
    'settle_payment_batch_atomic',
    {
      p_company_id: activeCompany.id,
      p_batch_date: batchDate,
      p_receipt_file_path: receiptFilePath,
      p_notes: combinedNotes,
      p_items: rpcItemsPayload,
    }
  );

  if (rpcError || !atomicResult?.batch_id) {
    const errMsg = rpcError?.message || 'Failed to execute atomic batch settlement.';
    const isUniqueErr =
      rpcError?.code === '23505' ||
      errMsg.toLowerCase().includes('duplicate') ||
      errMsg.toLowerCase().includes('unique');
    return {
      success: false,
      error: isUniqueErr
        ? errMsg.includes('UTR')
          ? errMsg
          : 'A duplicate UTR or batch code collision occurred. Please verify UTRs and try again.'
        : errMsg,
    };
  }

  // 4. Fetch created batch + settled items for response payload and notifications
  const [batchFetchRes, itemsFetchRes] = await Promise.all([
    supabase
      .from('payment_batches')
      .select('*, source_bank:company_banks(*), creator:profiles!created_by(id, full_name, role)')
      .eq('id', atomicResult.batch_id)
      .eq('company_id', activeCompany.id)
      .single(),
    supabase
      .from('payment_items')
      .select(
        '*, vendor:vendors(id, name, party_name, beneficiary_name, account_number, ifsc_code, whatsapp_number, remarks), source_bank:company_banks(id, short_name, full_name, short_code, bank_name, account_number_masked, account_mask), payer:profiles!paid_by(id, full_name, role), batch:payment_batches(*)'
      )
      .eq('company_id', activeCompany.id)
      .eq('batch_id', atomicResult.batch_id)
      .in('id', requestedIds),
  ]);

  if (batchFetchRes.error || !batchFetchRes.data) {
    return {
      success: false,
      error: batchFetchRes.error?.message || 'Batch settled, but failed to load batch summary.',
    };
  }

  const createdBatch = batchFetchRes.data;
  const updatedPayments = (itemsFetchRes.data || []) as PaymentItem[];

  // 5. Sync any linked recurring reminders
  const reminderIds = Array.from(
    new Set(
      resolvedItemUpdates
        .map((r) => r.recurring_reminder_id)
        .filter((id): id is string => Boolean(id))
    )
  );
  await Promise.all(
    reminderIds.map((reminderId) =>
      syncReminderCompletionOnTransition({
        companyId: activeCompany.id,
        reminderId,
        action: 'MARK_DONE',
      })
    )
  );

  // 6. Dispatch role-aware grouped notifications & Web Push (Auditors/Admins -> /audit, Approvers/Verifiers -> /history)
  try {
    if (process.env.SUPABASE_SERVICE_ROLE_KEY) {
      const admin = createAdminClient();
      const [profilesRes, accessRes] = await Promise.all([
        admin
          .from('profiles')
          .select('id, role, is_admin, is_active')
          .eq('is_active', true),
        admin
          .from('user_company_access')
          .select('user_id')
          .eq('company_id', activeCompany.id),
      ]);

      const companyUserIds = new Set((accessRes.data || []).map((r) => r.user_id));
      const recipients = (profilesRes.data || []).filter((p) => {
        if (p.id === user.id) return false;
        if (!['APPROVER', 'VERIFIER', 'AUDITOR'].includes(p.role)) return false;
        return p.is_admin || companyUserIds.has(p.id);
      });

      if (recipients.length > 0) {
        const companyCode = activeCompany.code || 'DESK';
        const title = `[${companyCode}] Batch ${createdBatch.batch_code} Settled`;
        const body = `Batch ${createdBatch.batch_code} Settled: ${createdBatch.item_count} payment${createdBatch.item_count === 1 ? '' : 's'} (${formatINR(createdBatch.total_amount)})`;
        const auditUrl = `/audit?batch=${encodeURIComponent(createdBatch.id)}`;
        const historyUrl = updatedPayments[0]?.id
          ? `/history?highlight=${encodeURIComponent(updatedPayments[0].id)}`
          : '/history';

        const auditorAdminIds: string[] = [];
        const approverVerifierIds: string[] = [];

        const notificationRows = recipients.map((p) => {
          const isAuditTarget = p.role === 'AUDITOR' || Boolean(p.is_admin);
          const actionUrl = isAuditTarget ? auditUrl : historyUrl;
          if (isAuditTarget) {
            auditorAdminIds.push(p.id);
          } else {
            approverVerifierIds.push(p.id);
          }
          return {
            company_id: activeCompany.id,
            recipient_user_id: p.id,
            payment_item_id: updatedPayments[0]?.id || null,
            action_url: actionUrl,
            event_type: 'BATCH_SETTLED' as const,
            title,
            body,
            is_read: false,
          };
        });

        await admin.from('notifications').insert(notificationRows);

        const pushTasks: Promise<void>[] = [];
        if (auditorAdminIds.length > 0) {
          pushTasks.push(
            sendPushToUsers(auditorAdminIds, {
              title,
              body,
              url: auditUrl,
              priority: 'normal',
              actionLabel: 'View Batch',
            })
          );
        }
        if (approverVerifierIds.length > 0) {
          pushTasks.push(
            sendPushToUsers(approverVerifierIds, {
              title,
              body,
              url: historyUrl,
              priority: 'normal',
              actionLabel: 'View History',
            })
          );
        }

        if (pushTasks.length > 0) {
          await Promise.race([
            Promise.all(pushTasks).then(() => undefined),
            new Promise<void>((resolve) => setTimeout(resolve, 2500)),
          ]);
        }
      }
    }
  } catch (err) {
    console.warn('[BatchSettlement] Non-blocking notification error:', err);
  }

  revalidatePath('/payments');
  revalidatePath('/tracker');
  revalidatePath('/history');
  revalidatePath('/audit');
  revalidatePath('/print');

  return {
    success: true,
    data: {
      batch: createdBatch as PaymentBatch,
      payments: updatedPayments,
    },
  };
}

/**
 * Mark a PAID payment as Audited (AUDITOR or Admin strictly verified).
 * Sole allowed post-PAID mutation: stamps ONLY audited_by and audited_at once.
 */
export async function markPaymentAudited(
  paymentId: string
): Promise<ActionResult<PaymentItem>> {
  const parsedId = uuidSchema.safeParse(paymentId);
  if (!parsedId.success) {
    return { success: false, error: 'Invalid payment ID.' };
  }

  const supabase = await createClient();
  const { user, profile, activeCompany } = await getCurrentUserContext();

  if (!user || !profile || !profile.is_active) {
    return { success: false, error: 'Unauthorized. Please sign in.' };
  }

  if (profile.role !== 'AUDITOR' && !profile.is_admin) {
    return {
      success: false,
      error: 'Access denied: Only an active Auditor or Administrator can mark payments as audited.',
    };
  }

  if (!activeCompany) {
    return { success: false, error: 'Active company workspace could not be determined.' };
  }

  const { data: existing, error: fetchError } = await supabase
    .from('payment_items')
    .select('id, company_id, status, audited_at')
    .eq('id', paymentId)
    .eq('company_id', activeCompany.id)
    .single();

  if (fetchError || !existing) {
    return { success: false, error: 'Payment item not found in the active company.' };
  }

  if (existing.status !== 'PAID') {
    return {
      success: false,
      error: `Cannot audit payment in '${existing.status}' status. Only PAID payments can be audited.`,
    };
  }

  if (existing.audited_at) {
    return {
      success: false,
      error: 'This payment has already been audited and is permanently locked.',
    };
  }

  const nowIso = new Date().toISOString();

  const { data: updated, error: updateError } = await supabase
    .from('payment_items')
    .update({
      audited_by: user.id,
      audited_at: nowIso,
    })
    .eq('id', paymentId)
    .eq('company_id', activeCompany.id)
    .eq('status', 'PAID')
    .is('audited_at', null)
    .select(
      '*, vendor:vendors(*), source_bank:company_banks(*), creator:profiles!created_by(id, full_name, role), verifier:profiles!verified_by(id, full_name, role), approver:profiles!approved_by(id, full_name, role), payer:profiles!paid_by(id, full_name, role), auditor:profiles!audited_by(id, full_name, role)'
    )
    .single();

  if (updateError || !updated) {
    return {
      success: false,
      error: updateError?.message || 'Failed to stamp payment as audited.',
    };
  }

  revalidatePath('/audit');
  revalidatePath('/history');
  revalidatePath('/print');
  return { success: true, data: updated as PaymentItem };
}

const markReceiptSentSchema = z.object({
  paymentId: z.string().uuid('Valid payment ID is required.'),
  sent: z.boolean().optional().default(true),
});

/**
 * Stamp or clear receipt_sent_at / receipt_sent_by on a PAID payment that has a recorded UTR or Cheque reference.
 * Marking sent is allowed for PREPARER, VERIFIER, APPROVER, or Admin; clearing (undo) is restricted to PREPARER or Admin.
 */
export async function markReceiptSent(input: {
  paymentId: string;
  sent?: boolean;
}): Promise<ActionResult<{ paymentId: string; receipt_sent_at: string | null }>> {
  const parsed = markReceiptSentSchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues[0]?.message || 'Invalid receipt tracking parameters.',
    };
  }

  const { paymentId, sent } = parsed.data;
  const supabase = await createClient();
  const { user, profile, activeCompany } = await getCurrentUserContext();

  if (!user || !profile || !profile.is_active) {
    return { success: false, error: 'Unauthorized. Please sign in.' };
  }

  if (!activeCompany) {
    return { success: false, error: 'Active company workspace could not be determined.' };
  }

  if (sent) {
    const allowedRoles = ['PREPARER', 'VERIFIER', 'APPROVER'];
    if (!profile.is_admin && !allowedRoles.includes(profile.role)) {
      return {
        success: false,
        error: 'Access denied: Only Preparers, Verifiers, Approvers, or Admins can mark receipt sent.',
      };
    }
  } else if (profile.role !== 'PREPARER' && !profile.is_admin) {
    return {
      success: false,
      error: 'Access denied: Only Preparers or Administrators can undo receipt sent confirmation.',
    };
  }

  // Verify payment belongs to activeCompany, is PAID, and has a settlement reference
  const { data: existing, error: fetchError } = await supabase
    .from('payment_items')
    .select('id, company_id, status, utr_number, cheque_number, receipt_sent_at')
    .eq('id', paymentId)
    .eq('company_id', activeCompany.id)
    .single();

  if (fetchError || !existing) {
    return { success: false, error: 'Payment item not found in the active company.' };
  }

  if (existing.status !== 'PAID') {
    return {
      success: false,
      error: `Cannot track receipt on '${existing.status}' payment. Only PAID payments are eligible.`,
    };
  }

  const hasSettlementRef = Boolean(
    (existing.utr_number || existing.cheque_number || '').trim()
  );
  if (!hasSettlementRef) {
    return {
      success: false,
      error: 'Cannot mark receipt sent without a recorded UTR or Cheque reference.',
    };
  }

  const nextSentAt = sent ? existing.receipt_sent_at || new Date().toISOString() : null;
  const nextSentBy = sent ? user.id : null;

  const writer =
    process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY
      ? createAdminClient()
      : supabase;

  const { error: updateError } = await writer
    .from('payment_items')
    .update({
      receipt_sent_at: nextSentAt,
      receipt_sent_by: nextSentBy,
    })
    .eq('id', paymentId)
    .eq('company_id', activeCompany.id)
    .eq('status', 'PAID');

  if (updateError) {
    return {
      success: false,
      error: updateError.message || 'Failed to update receipt sent status.',
    };
  }

  revalidatePath('/history');
  revalidatePath('/print');
  return {
    success: true,
    data: {
      paymentId,
      receipt_sent_at: nextSentAt,
    },
  };
}

const notifyApproverBankBatchReadySchema = z.object({
  paymentIds: z
    .array(z.string().uuid('Valid payment ID is required.'))
    .min(1, 'Select at least one approved payment before alerting Approver.')
    .max(200, 'Too many payments selected in a single alert.'),
  bankName: z.string().trim().max(120).optional(),
});

const notifyPreparerBankReleasedSchema = z.object({
  paymentIds: z
    .array(z.string().uuid('Valid payment ID is required.'))
    .max(200)
    .optional(),
  note: z.string().trim().max(300).optional(),
});

async function dispatchRoleAlertNotification(params: {
  companyId: string;
  actorId: string;
  eventType: 'BANK_OTP_READY' | 'BANK_OTP_RELEASED';
  targetRole: 'APPROVER' | 'PREPARER';
  actionUrl: string;
  title: string;
  body: string;
  emptyRecipientsError: string;
  priority?: 'urgent' | 'normal';
  actionLabel?: string;
}): Promise<ActionResult<{ notifiedCount: number }>> {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return {
      success: false,
      error: 'Notification service is not configured on the server.',
    };
  }

  const admin = createAdminClient();
  const [profilesRes, accessRes] = await Promise.all([
    admin
      .from('profiles')
      .select('id, role, is_admin, is_active')
      .eq('is_active', true),
    admin
      .from('user_company_access')
      .select('user_id')
      .eq('company_id', params.companyId),
  ]);

  if (profilesRes.error) {
    return { success: false, error: profilesRes.error.message };
  }
  if (accessRes.error) {
    return { success: false, error: accessRes.error.message };
  }

  const companyUserIds = new Set((accessRes.data || []).map((r) => r.user_id));
  const recipientIds = (profilesRes.data || [])
    .filter((p) => {
      if (p.id === params.actorId) return false;
      const hasAccess = p.is_admin || companyUserIds.has(p.id);
      if (!hasAccess) return false;
      if (params.targetRole === 'APPROVER') {
        return p.role === 'APPROVER' || Boolean(p.is_admin);
      }
      return p.role === 'PREPARER';
    })
    .map((p) => p.id);

  if (recipientIds.length === 0) {
    return { success: false, error: params.emptyRecipientsError };
  }

  const notificationRows = recipientIds.map((recipientId) => ({
    company_id: params.companyId,
    recipient_user_id: recipientId,
    payment_item_id: null,
    action_url: params.actionUrl,
    event_type: params.eventType,
    title: params.title,
    body: params.body,
    is_read: false,
  }));

  const { error: insertError } = await admin
    .from('notifications')
    .insert(notificationRows);

  if (insertError) {
    return {
      success: false,
      error: insertError.message || 'Failed to save workflow alert notification.',
    };
  }

  try {
    await Promise.race([
      sendPushToUsers(recipientIds, {
        title: params.title,
        body: params.body,
        url: params.actionUrl,
        priority: params.priority,
        actionLabel: params.actionLabel,
      }),
      new Promise<void>((resolve) => setTimeout(resolve, 2500)),
    ]);
  } catch (err) {
    console.warn('[Notifications] Non-blocking push delivery failed:', err);
  }

  return { success: true, data: { notifiedCount: recipientIds.length } };
}

/**
 * Manual, non-blocking 1-tap notification from Preparer to active Approvers/Admins
 * indicating the uploaded Bank Excel batch is ready for OTP authorization.
 */
export async function notifyApproverBankBatchReady(input: {
  paymentIds: string[];
  bankName?: string;
}): Promise<ActionResult<{ notifiedCount: number }>> {
  const parsed = notifyApproverBankBatchReadySchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues[0]?.message || 'Invalid alert request.',
    };
  }

  const supabase = await createClient();
  const { user, profile, activeCompany, allowedCompanies } =
    await getCurrentUserContext();

  if (!user || !profile || !profile.is_active) {
    return { success: false, error: 'Unauthorized. Please sign in.' };
  }

  if (profile.role !== 'PREPARER' && !profile.is_admin) {
    return {
      success: false,
      error: 'Only Accounts Preparers or Administrators can send Bank OTP alerts.',
    };
  }

  if (!activeCompany || !allowedCompanies.some((c) => c.id === activeCompany.id)) {
    return { success: false, error: 'Active company workspace could not be determined.' };
  }

  const uniqueIds = Array.from(new Set(parsed.data.paymentIds));

  // Strictly verify approved items in activeCompany and compute totals server-side
  const { data: verifiedItems, error: fetchError } = await supabase
    .from('payment_items')
    .select(
      'id, net_payable, source_bank:company_banks(bank_name, full_name, short_code, short_name)'
    )
    .eq('company_id', activeCompany.id)
    .eq('status', 'APPROVED')
    .in('id', uniqueIds);

  if (fetchError) {
    return {
      success: false,
      error: fetchError.message || 'Failed to verify approved payments.',
    };
  }

  if (!verifiedItems || verifiedItems.length === 0) {
    return {
      success: false,
      error: 'No approved Ready-to-Pay payments found in this selection.',
    };
  }

  const count = verifiedItems.length;
  const totalAmount = round2(
    verifiedItems.reduce((sum, item) => sum + (Number(item.net_payable) || 0), 0)
  );

  const bankLabels = Array.from(
    new Set(
      verifiedItems
        .map((item: any) => {
          const bank = Array.isArray(item.source_bank)
            ? item.source_bank[0]
            : item.source_bank;
          return (
            bank?.bank_name ||
            bank?.full_name ||
            bank?.short_code ||
            bank?.short_name ||
            ''
          ).trim();
        })
        .filter(Boolean)
    )
  );
  const bankLabel =
    (parsed.data.bankName || '').trim() ||
    (bankLabels.length === 1
      ? bankLabels[0]
      : bankLabels.length > 1
        ? bankLabels.join(' / ')
        : 'Bank portal');

  const companyCode = (activeCompany.code || 'DESK').trim().toUpperCase();
  const title = `[${companyCode}] Ready for Bank OTP (${count} payment${count === 1 ? '' : 's'})`;
  const body = `${count} payment${count === 1 ? '' : 's'} (${formatINR(totalAmount)}) uploaded to ${bankLabel}. Please release payment via OTP in Bank portal.`;

  return dispatchRoleAlertNotification({
    companyId: activeCompany.id,
    actorId: user.id,
    eventType: 'BANK_OTP_READY',
    targetRole: 'APPROVER',
    actionUrl: '/approvals?tab=APPROVED',
    title,
    body,
    emptyRecipientsError: 'No active Approver found for this company.',
    priority: 'urgent',
    actionLabel: 'Open Approvals',
  });
}

/**
 * Optional 1-tap confirmation from Approver to active Accounts Preparers
 * indicating Bank OTP release is done so Accounts can download UTRs and settle.
 */
export async function notifyPreparerBankReleased(input?: {
  paymentIds?: string[];
  note?: string;
}): Promise<ActionResult<{ notifiedCount: number }>> {
  const parsed = notifyPreparerBankReleasedSchema.safeParse(input ?? {});
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues[0]?.message || 'Invalid notification payload.',
    };
  }

  const { user, profile, activeCompany, allowedCompanies } =
    await getCurrentUserContext();

  if (!user || !profile || !profile.is_active) {
    return { success: false, error: 'Unauthorized. Please sign in.' };
  }

  if (profile.role !== 'APPROVER' && !profile.is_admin) {
    return {
      success: false,
      error: 'Only Approvers or Administrators can notify Accounts of Bank OTP release.',
    };
  }

  if (!activeCompany || !allowedCompanies.some((c) => c.id === activeCompany.id)) {
    return { success: false, error: 'Active company workspace could not be determined.' };
  }

  const companyCode = (activeCompany.code || 'DESK').trim().toUpperCase();
  const note = (parsed.data.note || '').trim();
  const title = `[${companyCode}] Bank Payment Released — Enter UTRs`;
  const body = `${profile.full_name} completed Bank OTP release. You can now download UTRs and settle the batch.${note ? ` (${note})` : ''}`;

  return dispatchRoleAlertNotification({
    companyId: activeCompany.id,
    actorId: user.id,
    eventType: 'BANK_OTP_RELEASED',
    targetRole: 'PREPARER',
    actionUrl: '/payments?tab=APPROVED',
    title,
    body,
    emptyRecipientsError: 'No active Accounts Preparer found for this company.',
    priority: 'urgent',
    actionLabel: 'Enter UTRs',
  });
}
