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
import { getCurrentUserContext } from '@/lib/auth';
import { dispatchWorkflowNotification } from '@/actions/notifications';
import { formatINR } from '@/lib/format';

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
    return { success: false, error: 'Invoice file exceeds 5 MB limit.' };
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
  } = parsed.data;

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

  if (initialStatus === 'PENDING_VERIFICATION' && company_id) {
    const partyName =
      payment.vendor?.party_name || payment.vendor?.name || 'Vendor';
    void dispatchWorkflowNotification({
      companyId: company_id,
      paymentItemId: payment.id,
      eventType: 'SUBMITTED_FOR_VERIFICATION',
      actorId: user.id,
      partyName,
      netPayable: Number(payment.net_payable || cleanAmount - cleanTds),
    });
  }

  revalidatePath('/payments');
  revalidatePath('/verify');
  revalidatePath('/approvals');
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
    amount,
    tds = 0,
    source_bank_id,
    remarks,
    invoice_file_path,
  } = parsed.data;

  // Verify payment exists and belongs to activeCompany in DRAFT status
  const { activeCompany } = await getCurrentUserContext();
  if (!activeCompany) {
    return { success: false, error: 'Active company workspace could not be determined.' };
  }

  const { data: existing, error: fetchError } = await supabase
    .from('payment_items')
    .select('id, company_id, status')
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
    void dispatchWorkflowNotification({
      companyId: updated.company_id,
      paymentItemId: updated.id,
      eventType: 'SUBMITTED_FOR_VERIFICATION',
      actorId: user.id,
      partyName,
      netPayable: Number(updated.net_payable || cleanAmount - cleanTds),
    });
  }

  revalidatePath('/payments');
  revalidatePath('/verify');
  revalidatePath('/approvals');
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
    .select('id, company_id, status')
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
    void dispatchWorkflowNotification({
      companyId: updated.company_id,
      paymentItemId: updated.id,
      eventType: 'SUBMITTED_FOR_VERIFICATION',
      actorId: user.id,
      partyName,
      netPayable: Number(updated.net_payable || 0),
    });
  }

  revalidatePath('/payments');
  revalidatePath('/verify');
  revalidatePath('/approvals');
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
    .select('id, company_id, status')
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
    void dispatchWorkflowNotification({
      companyId: updated.company_id,
      paymentItemId: updated.id,
      eventType: 'VERIFIED_FOR_APPROVAL',
      actorId: user.id,
      partyName,
      netPayable: Number(updated.net_payable || 0),
    });
  }

  revalidatePath('/verify');
  revalidatePath('/approvals');
  revalidatePath('/payments');
  revalidatePath('/history');
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
      error: 'Access denied: Only Accountants or Owners can delete drafts.',
    };
  }

  const { activeCompany } = await getCurrentUserContext();
  if (!activeCompany) {
    return { success: false, error: 'Active company workspace could not be determined.' };
  }

  const { data: existing, error: fetchError } = await supabase
    .from('payment_items')
    .select('id, company_id, status')
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
      error: 'Access denied: Only Accountants or Owners can cancel payments.',
    };
  }

  const { activeCompany } = await getCurrentUserContext();
  if (!activeCompany) {
    return { success: false, error: 'Active company workspace could not be determined.' };
  }

  const { data: existing, error: fetchError } = await supabase
    .from('payment_items')
    .select('id, company_id, status')
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

  revalidatePath('/payments');
  revalidatePath('/approvals');
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
    .select('id, company_id, status')
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
    void dispatchWorkflowNotification({
      companyId: updated.company_id,
      paymentItemId: updated.id,
      eventType: 'APPROVED',
      actorId: user.id,
      partyName,
      netPayable: Number(updated.net_payable || 0),
      createdById: updated.created_by,
    });
  }

  revalidatePath('/approvals');
  revalidatePath('/verify');
  revalidatePath('/payments');
  revalidatePath('/history');
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

  void dispatchWorkflowNotification({
    companyId: activeCompany.id,
    paymentItemId: eligibleIds[0] || null,
    eventType: 'APPROVED',
    actorId: user.id,
    partyName: `${eligibleIds.length} payments`,
    netPayable: totalApprovedNet,
    customTitle: `[${activeCompany.code}] Batch Approved (${eligibleIds.length} payments)`,
    customBody: `${eligibleIds.length} payment${eligibleIds.length === 1 ? '' : 's'
      } totaling ${formatINR(totalApprovedNet)} approved and ready to pay.`,
  });

  revalidatePath('/approvals');
  revalidatePath('/verify');
  revalidatePath('/payments');
  revalidatePath('/history');
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
    .select('id, company_id, status')
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
    void dispatchWorkflowNotification({
      companyId: updated.company_id,
      paymentItemId: updated.id,
      eventType: 'HELD',
      actorId: user.id,
      partyName,
      netPayable: Number(updated.net_payable || 0),
      createdById: updated.created_by,
    });
  }

  revalidatePath('/approvals');
  revalidatePath('/payments');
  revalidatePath('/history');
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
    .select('id, company_id, status')
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
    void dispatchWorkflowNotification({
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

  revalidatePath('/approvals');
  revalidatePath('/verify');
  revalidatePath('/payments');
  revalidatePath('/history');
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
    .select('id, company_id, status')
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

  revalidatePath('/approvals');
  revalidatePath('/verify');
  revalidatePath('/payments');
  revalidatePath('/history');
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
    return { success: false, error: 'Receipt file exceeds 5 MB limit.' };
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
    .select('id, company_id, status, payment_mode, remarks')
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
    | 'CHEQUE';

  const nowIso = new Date().toISOString();
  let updateFields: PaymentItemUpdate = {
    status: 'PAID',
    remarks: remarks?.trim() || existing.remarks,
    paid_by: user.id,
    paid_at: nowIso,
    updated_at: nowIso,
  };

  if (mode === 'NEFT_RTGS') {
    const cleanUtr = (utr_number || '').trim().toUpperCase();
    if (!cleanUtr) {
      return {
        success: false,
        error: 'UTR / Payment Reference Number is required for NEFT/RTGS payments.',
      };
    }

    if (!receipt_file_path || !receipt_file_path.trim()) {
      return {
        success: false,
        error: 'Bank Acknowledgement PDF / Receipt upload is required for NEFT/RTGS payments.',
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

  revalidatePath('/payments');
  revalidatePath('/approvals');
  revalidatePath('/audit');
  revalidatePath('/history');
  revalidatePath('/print');
  return { success: true, data: updated as PaymentItem };
}

export const markPaidWithUtr = markPaymentPaid;

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
