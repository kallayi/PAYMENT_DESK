'use server';

import { createClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import {
  createPaymentSchema,
  updateDraftPaymentSchema,
  rejectPaymentSchema,
  switchBankSchema,
  markPaidSchema,
  type CreatePaymentInput,
  type UpdateDraftPaymentInput,
  type MarkPaidInput,
} from '@/lib/validators';
import type { ActionResult, AuditLog, Database, PaymentItem } from '@/types/database';

type PaymentItemUpdate = Database['public']['Tables']['payment_items']['Update'];

const uuidSchema = z.string().uuid('Valid ID is required');

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB
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

  let query = supabase
    .from('payment_items')
    .select('id, invoice_ref, sheet_date, status')
    .eq('vendor_id', vendorId)
    .ilike('invoice_ref', invoiceRef.trim())
    .not('status', 'in', '("REJECTED","CANCELLED")');

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
    .select('role, is_active')
    .eq('id', user.id)
    .single();

  if (
    !profile ||
    !profile.is_active ||
    (profile.role !== 'ACCOUNTANT' && profile.role !== 'OWNER')
  ) {
    return { success: false, error: 'Unauthorized to upload payment invoices.' };
  }

  const file = formData.get('file') as File | null;
  if (!file || file.size === 0) {
    return { success: false, error: 'Please select an invoice file.' };
  }

  if (file.size > MAX_FILE_SIZE) {
    return { success: false, error: 'Invoice file exceeds 5 MB limit.' };
  }

  if (!ALLOWED_MIME_TYPES.includes(file.type)) {
    return { success: false, error: 'Invalid file format. Allowed: PDF, JPG, PNG, WEBP.' };
  }

  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const fileExt = file.name.split('.').pop()?.toLowerCase() || 'pdf';
  const filePath = `${year}/${month}/${crypto.randomUUID()}.${fileExt}`;

  const arrayBuffer = await file.arrayBuffer();
  const buffer = new Uint8Array(arrayBuffer);

  const { error: uploadError } = await supabase.storage
    .from('supplier-invoices')
    .upload(filePath, buffer, {
      contentType: file.type,
      upsert: false,
    });

  if (uploadError) {
    return { success: false, error: `Upload failed: ${uploadError.message}` };
  }

  return { success: true, data: { filePath, fileName: file.name } };
}

/**
 * Create a new payment entry as DRAFT or directly submit as PENDING_APPROVAL.
 */
export async function createPayment(
  input: CreatePaymentInput,
  initialStatus: 'DRAFT' | 'PENDING_APPROVAL' = 'DRAFT'
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
    .select('role, is_active')
    .eq('id', user.id)
    .single();

  if (
    !profile ||
    !profile.is_active ||
    (profile.role !== 'ACCOUNTANT' && profile.role !== 'OWNER')
  ) {
    return {
      success: false,
      error: 'Access denied: Only Accountants or Owners can create payments.',
    };
  }

  const parsed = createPaymentSchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues[0]?.message || 'Invalid payment entry data.',
    };
  }

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
  } = parsed.data;

  // Safe rounding to 2 decimal places
  const cleanAmount = Math.round(amount * 100) / 100;
  const cleanTds = Math.round((tds || 0) * 100) / 100;

  const nowIso = new Date().toISOString();

  const { data: payment, error: insertError } = await supabase
    .from('payment_items')
    .insert({
      sheet_date,
      due_date,
      vendor_id,
      invoice_ref: invoice_ref.trim(),
      purpose: purpose.trim(),
      amount: cleanAmount,
      tds: cleanTds,
      source_bank_id,
      invoice_file_path: invoice_file_path || null,
      remarks: remarks?.trim() || null,
      status: initialStatus,
      created_by: user.id,
      submitted_at: initialStatus === 'PENDING_APPROVAL' ? nowIso : null,
    })
    .select(
      '*, vendor:vendors(id, name, gstin, bank_account_no, ifsc_code), source_bank:company_banks(id, short_name, full_name)'
    )
    .single();

  if (insertError || !payment) {
    return {
      success: false,
      error: insertError?.message || 'Failed to create payment entry.',
    };
  }

  revalidatePath('/payments');
  revalidatePath('/approvals');
  return { success: true, data: payment };
}

/**
 * Update an existing DRAFT payment entry.
 */
export async function updateDraftPayment(
  input: UpdateDraftPaymentInput,
  targetStatus?: 'DRAFT' | 'PENDING_APPROVAL'
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
    .select('role, is_active')
    .eq('id', user.id)
    .single();

  if (
    !profile ||
    !profile.is_active ||
    (profile.role !== 'ACCOUNTANT' && profile.role !== 'OWNER')
  ) {
    return {
      success: false,
      error: 'Access denied: Only Accountants or Owners can edit payments.',
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
    amount,
    tds = 0,
    source_bank_id,
    remarks,
    invoice_file_path,
  } = parsed.data;

  // Verify payment exists and is in DRAFT status
  const { data: existing, error: fetchError } = await supabase
    .from('payment_items')
    .select('id, status')
    .eq('id', id)
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

  const cleanAmount = Math.round(amount * 100) / 100;
  const cleanTds = Math.round((tds || 0) * 100) / 100;

  const updatePayload: PaymentItemUpdate = {
    sheet_date,
    due_date,
    vendor_id,
    invoice_ref: invoice_ref.trim(),
    purpose: purpose.trim(),
    amount: cleanAmount,
    tds: cleanTds,
    source_bank_id,
    invoice_file_path: invoice_file_path || null,
    remarks: remarks?.trim() || null,
    updated_at: new Date().toISOString(),
  };

  if (targetStatus === 'PENDING_APPROVAL') {
    updatePayload.status = 'PENDING_APPROVAL';
    updatePayload.submitted_at = new Date().toISOString();
  }

  const { data: updated, error: updateError } = await supabase
    .from('payment_items')
    .update(updatePayload)
    .eq('id', id)
    .select(
      '*, vendor:vendors(id, name, gstin, bank_account_no, ifsc_code), source_bank:company_banks(id, short_name, full_name)'
    )
    .single();

  if (updateError || !updated) {
    return {
      success: false,
      error: updateError?.message || 'Failed to update payment record.',
    };
  }

  revalidatePath('/payments');
  revalidatePath('/approvals');
  return { success: true, data: updated };
}

/**
 * Submit an existing DRAFT payment to Owner approval queue.
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
    .select('role, is_active')
    .eq('id', user.id)
    .single();

  if (
    !profile ||
    !profile.is_active ||
    (profile.role !== 'ACCOUNTANT' && profile.role !== 'OWNER')
  ) {
    return {
      success: false,
      error: 'Access denied: Only Accountants or Owners can submit payments.',
    };
  }

  const { data: existing, error: fetchError } = await supabase
    .from('payment_items')
    .select('id, status')
    .eq('id', paymentId)
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
      status: 'PENDING_APPROVAL',
      submitted_at: nowIso,
      updated_at: nowIso,
    })
    .eq('id', paymentId)
    .select(
      '*, vendor:vendors(id, name, gstin, bank_account_no, ifsc_code), source_bank:company_banks(id, short_name, full_name)'
    )
    .single();

  if (updateError || !updated) {
    return {
      success: false,
      error: updateError?.message || 'Failed to submit payment for approval.',
    };
  }

  revalidatePath('/payments');
  revalidatePath('/approvals');
  return { success: true, data: updated };
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
    .select('role, is_active')
    .eq('id', user.id)
    .single();

  if (
    !profile ||
    !profile.is_active ||
    (profile.role !== 'ACCOUNTANT' && profile.role !== 'OWNER')
  ) {
    return {
      success: false,
      error: 'Access denied: Only Accountants or Owners can delete drafts.',
    };
  }

  const { data: existing, error: fetchError } = await supabase
    .from('payment_items')
    .select('id, status')
    .eq('id', paymentId)
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

  revalidatePath('/payments');
  revalidatePath('/approvals');
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
    .select('role, is_active')
    .eq('id', user.id)
    .single();

  if (
    !profile ||
    !profile.is_active ||
    (profile.role !== 'ACCOUNTANT' && profile.role !== 'OWNER')
  ) {
    return {
      success: false,
      error: 'Access denied: Only Accountants or Owners can cancel payments.',
    };
  }

  const { data: existing, error: fetchError } = await supabase
    .from('payment_items')
    .select('id, status')
    .eq('id', paymentId)
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
      '*, vendor:vendors(id, name, gstin, bank_account_no, ifsc_code), source_bank:company_banks(id, short_name, full_name)'
    )
    .single();

  if (updateError || !updated) {
    return {
      success: false,
      error: updateError?.message || 'Failed to cancel payment record.',
    };
  }

  revalidatePath('/payments');
  revalidatePath('/approvals');
  return { success: true, data: updated };
}

// =========================================================================
// PART 2: OWNER AUTHORIZATION & AUDIT ACTIONS (STRICT ROLE: OWNER)
// =========================================================================

/**
 * Approve a payment request (OWNER role strictly verified on server).
 * Transitions status from PENDING_APPROVAL / ON_HOLD -> APPROVED.
 */
export async function ownerApprovePayment(
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
    .select('role, is_active')
    .eq('id', user.id)
    .single();

  if (!profile || !profile.is_active || profile.role !== 'OWNER') {
    return { success: false, error: 'Access denied: Only the Owner can approve payments.' };
  }

  const { data: existing, error: fetchError } = await supabase
    .from('payment_items')
    .select('id, status')
    .eq('id', paymentId)
    .single();

  if (fetchError || !existing) {
    return { success: false, error: 'Payment item not found.' };
  }

  if (existing.status !== 'PENDING_APPROVAL' && existing.status !== 'ON_HOLD') {
    return {
      success: false,
      error: `Cannot approve payment in '${existing.status}' status. Item must be Pending or On Hold.`,
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
      '*, vendor:vendors(id, name, gstin, bank_account_no, ifsc_code), source_bank:company_banks(id, short_name, full_name)'
    )
    .single();

  if (updateError || !updated) {
    return {
      success: false,
      error: updateError?.message || 'Failed to approve payment.',
    };
  }

  revalidatePath('/approvals');
  revalidatePath('/payments');
  revalidatePath('/history');
  return { success: true, data: updated };
}

/**
 * Toggle hold status on a payment item (OWNER role strictly verified).
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

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { success: false, error: 'Unauthorized. Please sign in.' };
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, is_active')
    .eq('id', user.id)
    .single();

  if (!profile || !profile.is_active || profile.role !== 'OWNER') {
    return { success: false, error: 'Access denied: Only the Owner can place payments on hold.' };
  }

  const { data: existing, error: fetchError } = await supabase
    .from('payment_items')
    .select('id, status')
    .eq('id', paymentId)
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
      '*, vendor:vendors(id, name, gstin, bank_account_no, ifsc_code), source_bank:company_banks(id, short_name, full_name)'
    )
    .single();

  if (updateError || !updated) {
    return {
      success: false,
      error: updateError?.message || 'Failed to update hold status.',
    };
  }

  revalidatePath('/approvals');
  revalidatePath('/payments');
  revalidatePath('/history');
  return { success: true, data: updated };
}

/**
 * Reject a payment request with a mandatory rejection reason (OWNER role strictly verified).
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

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { success: false, error: 'Unauthorized. Please sign in.' };
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, is_active')
    .eq('id', user.id)
    .single();

  if (!profile || !profile.is_active || profile.role !== 'OWNER') {
    return { success: false, error: 'Access denied: Only the Owner can reject payments.' };
  }

  const { data: existing, error: fetchError } = await supabase
    .from('payment_items')
    .select('id, status')
    .eq('id', paymentId)
    .single();

  if (fetchError || !existing) {
    return { success: false, error: 'Payment item not found.' };
  }

  if (existing.status !== 'PENDING_APPROVAL' && existing.status !== 'ON_HOLD') {
    return {
      success: false,
      error: `Cannot reject payment in '${existing.status}' status. Item must be Pending or On Hold.`,
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
      '*, vendor:vendors(id, name, gstin, bank_account_no, ifsc_code), source_bank:company_banks(id, short_name, full_name)'
    )
    .single();

  if (updateError || !updated) {
    return {
      success: false,
      error: updateError?.message || 'Failed to reject payment.',
    };
  }

  revalidatePath('/approvals');
  revalidatePath('/payments');
  revalidatePath('/history');
  return { success: true, data: updated };
}

/**
 * Switch source bank for a payment item before approval (OWNER role strictly verified).
 * Core financial lock in trigger ensures this cannot be called once status is APPROVED or PAID.
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

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { success: false, error: 'Unauthorized. Please sign in.' };
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, is_active')
    .eq('id', user.id)
    .single();

  if (!profile || !profile.is_active || profile.role !== 'OWNER') {
    return {
      success: false,
      error: 'Access denied: Only the Owner can switch banks on payment requests.',
    };
  }

  const { data: existing, error: fetchError } = await supabase
    .from('payment_items')
    .select('id, status')
    .eq('id', paymentId)
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

  const nowIso = new Date().toISOString();

  const { data: updated, error: updateError } = await supabase
    .from('payment_items')
    .update({
      source_bank_id: parsed.data.new_bank_id,
      updated_at: nowIso,
    })
    .eq('id', paymentId)
    .select(
      '*, vendor:vendors(id, name, gstin, bank_account_no, ifsc_code), source_bank:company_banks(id, short_name, full_name)'
    )
    .single();

  if (updateError || !updated) {
    return {
      success: false,
      error: updateError?.message || 'Failed to update payment source bank.',
    };
  }

  revalidatePath('/approvals');
  revalidatePath('/payments');
  revalidatePath('/history');
  return { success: true, data: updated };
}

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

  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { success: false, error: 'Unauthorized. Please sign in.' };
  }

  const { data: logs, error } = await supabase
    .from('audit_logs')
    .select('*, performer:profiles(id, full_name, role)')
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
 */
export async function uploadReceiptFile(
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
    .select('role, is_active')
    .eq('id', user.id)
    .single();

  if (
    !profile ||
    !profile.is_active ||
    (profile.role !== 'ACCOUNTANT' && profile.role !== 'OWNER')
  ) {
    return {
      success: false,
      error: 'Access denied: Only Accountants or Owners can upload bank receipts.',
    };
  }

  const file = formData.get('file') as File | null;
  if (!file || file.size === 0) {
    return { success: false, error: 'Please select a bank receipt file.' };
  }

  if (file.size > MAX_FILE_SIZE) {
    return { success: false, error: 'Receipt file exceeds 5 MB limit.' };
  }

  if (!ALLOWED_MIME_TYPES.includes(file.type)) {
    return { success: false, error: 'Invalid file format. Allowed: PDF, JPG, PNG, WEBP.' };
  }

  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const fileExt = file.name.split('.').pop()?.toLowerCase() || 'pdf';
  const filePath = `${year}/${month}/${crypto.randomUUID()}.${fileExt}`;

  const arrayBuffer = await file.arrayBuffer();
  const buffer = new Uint8Array(arrayBuffer);

  const { error: uploadError } = await supabase.storage
    .from('bank-receipts')
    .upload(filePath, buffer, {
      contentType: file.type,
      upsert: false,
    });

  if (uploadError) {
    return { success: false, error: `Upload failed: ${uploadError.message}` };
  }

  return { success: true, data: { filePath, fileName: file.name } };
}

/**
 * Mark an APPROVED payment as PAID with UTR number and Bank Receipt upload.
 * Enforces duplicate UTR check and maps Postgres 23505 unique error.
 */
export async function markPaidWithUtr(
  input: MarkPaidInput
): Promise<ActionResult<PaymentItem>> {
  const parsed = markPaidSchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues[0]?.message || 'Invalid UTR submission data.',
    };
  }

  const { payment_id, utr_number, receipt_file_path, remarks } = parsed.data;

  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { success: false, error: 'Unauthorized. Please sign in.' };
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, is_active')
    .eq('id', user.id)
    .single();

  if (
    !profile ||
    !profile.is_active ||
    (profile.role !== 'ACCOUNTANT' && profile.role !== 'OWNER')
  ) {
    return {
      success: false,
      error: 'Access denied: Only Accountants or Owners can record UTR settlements.',
    };
  }

  const { data: existing, error: fetchError } = await supabase
    .from('payment_items')
    .select('id, status, remarks')
    .eq('id', payment_id)
    .single();

  if (fetchError || !existing) {
    return { success: false, error: 'Payment item not found.' };
  }

  if (existing.status !== 'APPROVED') {
    return {
      success: false,
      error: `Cannot mark payment as Paid. Current status is '${existing.status}', but must be 'APPROVED'.`,
    };
  }

  const nowIso = new Date().toISOString();
  const cleanUtr = utr_number.trim().toUpperCase();

  const { data: updated, error: updateError } = await supabase
    .from('payment_items')
    .update({
      status: 'PAID',
      utr_number: cleanUtr,
      receipt_file_path,
      remarks: remarks?.trim() || existing.remarks,
      paid_by: user.id,
      paid_at: nowIso,
      updated_at: nowIso,
    })
    .eq('id', payment_id)
    .select(
      '*, vendor:vendors(id, name, gstin, bank_account_no, ifsc_code), source_bank:company_banks(id, short_name, full_name)'
    )
    .single();

  if (updateError) {
    // Map Postgres unique violation code 23505 (idx_payment_items_unique_utr)
    if (
      updateError.code === '23505' ||
      updateError.message.toLowerCase().includes('unique') ||
      updateError.message.toLowerCase().includes('utr')
    ) {
      return {
        success: false,
        error:
          'This UTR number has already been registered on another payment. Please check for duplicate disbursement.',
      };
    }

    return {
      success: false,
      error: updateError.message || 'Failed to record UTR payment.',
    };
  }

  if (!updated) {
    return { success: false, error: 'Failed to record UTR payment.' };
  }

  revalidatePath('/payments');
  revalidatePath('/approvals');
  revalidatePath('/history');
  return { success: true, data: updated };
}
