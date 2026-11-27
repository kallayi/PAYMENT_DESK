'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getCurrentUserContext } from '@/lib/auth';
import { sendPushToUsers } from '@/lib/push';
import { formatINR } from '@/lib/format';
import type { ActionResult, NotificationEvent, PaymentItem, PaymentRequest } from '@/types/database';

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB
const ALLOWED_MIME_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
];

const uuidSchema = z.string().uuid('Valid ID is required.');

const createPaymentRequestSchema = z
  .object({
    vendor_id: z.string().uuid('Please select a valid vendor').optional().nullable(),
    unlisted_vendor_name: z.string().trim().max(150).optional().nullable(),
    gross_amount: z.coerce.number().positive('Amount must be greater than 0'),
    invoice_ref: z.string().trim().max(120).optional().nullable(),
    purpose: z.string().trim().min(1, 'Purpose is required').max(150),
    due_date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'Valid due date (YYYY-MM-DD) is required')
      .or(z.literal(''))
      .optional()
      .nullable(),
    remarks: z.string().trim().max(1000).optional().nullable(),
    bill_file_path: z.string().trim().optional().nullable(),
  })
  .refine(
    (data) => Boolean(data.vendor_id) || Boolean(data.unlisted_vendor_name?.trim()),
    {
      message: 'Please select a vendor or enter an unlisted vendor name.',
      path: ['vendor_id'],
    }
  );

export type CreatePaymentRequestInput = z.infer<typeof createPaymentRequestSchema>;

const submitRequestToWorkflowSchema = z
  .object({
    request_id: z.string().uuid('Valid request ID is required.'),
    vendor_id: z.string().uuid('Please select a valid vendor from the company master.'),
    source_bank_id: z.string().uuid('Please select an active source bank.'),
    disbursement_mode: z.enum(['NEFT_RTGS', 'IMPS', 'CHEQUE']).default('NEFT_RTGS'),
    gross_amount: z.coerce.number().positive('Gross amount must be greater than 0'),
    tds_amount: z.coerce.number().min(0, 'TDS cannot be negative').default(0),
    invoice_ref: z.string().trim().max(120).optional().nullable(),
    purpose: z.string().trim().min(1, 'Purpose is required').max(150),
    due_date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'Valid due date (YYYY-MM-DD) is required')
      .or(z.literal(''))
      .optional()
      .nullable(),
    remarks: z.string().trim().max(1000).optional().nullable(),
    bill_file_path: z.string().trim().optional().nullable(),
  })
  .refine((data) => data.tds_amount <= data.gross_amount, {
    message: 'TDS cannot exceed Gross Amount.',
    path: ['tds_amount'],
  });

export type SubmitRequestToWorkflowInput = z.infer<typeof submitRequestToWorkflowSchema>;

const declinePaymentRequestSchema = z.object({
  request_id: z.string().uuid('Valid request ID is required.'),
  reason: z.string().trim().min(2, 'Please provide a short reason for declining.').max(500),
});

function getTodayISTDateString(): string {
  const istMs = Date.now() + (5 * 60 + 30) * 60 * 1000;
  const d = new Date(istMs);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

async function sendDirectRequestNotifications(params: {
  companyId: string;
  recipientIds: string[];
  eventType: NotificationEvent;
  title: string;
  body: string;
  pushUrl: string;
  paymentItemId?: string | null;
  paymentRequestId?: string | null;
  actionUrl?: string | null;
}): Promise<void> {
  if (params.recipientIds.length === 0 || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return;
  }

  try {
    const admin = createAdminClient();
    const uniqueRecipients = Array.from(new Set(params.recipientIds));

    const rows = uniqueRecipients.map((recipientId) => ({
      company_id: params.companyId,
      recipient_user_id: recipientId,
      payment_item_id: params.paymentItemId || null,
      payment_request_id: params.paymentRequestId || null,
      action_url: params.actionUrl || params.pushUrl,
      event_type: params.eventType,
      title: params.title,
      body: params.body,
      is_read: false,
    }));

    const { error: insertError } = await admin.from('notifications').insert(rows);
    if (insertError) {
      console.warn('[RequestNotifications] Insert error:', insertError.message);
    }

    await Promise.race([
      sendPushToUsers(uniqueRecipients, {
        title: params.title,
        body: params.body,
        url: params.pushUrl,
      }),
      new Promise<void>((resolve) => setTimeout(resolve, 2500)),
    ]);
  } catch (err) {
    console.warn('[RequestNotifications] Non-blocking notification error:', err);
  }
}

async function getActiveRoleRecipientsForCompany(params: {
  companyId: string;
  targetRole: 'PREPARER' | 'VERIFIER';
  excludeUserId?: string;
}): Promise<string[]> {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return [];

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

  const companyUserIds = new Set((accessRes.data || []).map((r) => r.user_id));

  return (profilesRes.data || [])
    .filter((p) => {
      if (params.excludeUserId && p.id === params.excludeUserId) return false;
      if (p.role !== params.targetRole) return false;
      return p.is_admin || companyUserIds.has(p.id);
    })
    .map((p) => p.id);
}

/**
 * Upload optional bill attachment for a Payment Request into private 'supplier-invoices' bucket.
 */
export async function uploadRequestBillFile(
  formData: FormData
): Promise<ActionResult<{ filePath: string; fileName: string }>> {
  const { user, profile, activeCompany } = await getCurrentUserContext();

  if (!user || !profile || !profile.is_active) {
    return { success: false, error: 'Unauthorized. Please sign in.' };
  }

  if (
    profile.role !== 'APPROVER' &&
    profile.role !== 'VERIFIER' &&
    profile.role !== 'PREPARER' &&
    !profile.is_admin
  ) {
    return { success: false, error: 'Unauthorized to upload request bill attachments.' };
  }

  if (!activeCompany) {
    return { success: false, error: 'Active company workspace could not be determined.' };
  }

  const file = formData.get('file') as File | null;
  if (!file || file.size === 0) {
    return { success: false, error: 'Please select a bill file.' };
  }

  if (file.size > MAX_FILE_SIZE) {
    return { success: false, error: 'Bill file exceeds 5 MB limit.' };
  }

  if (!ALLOWED_MIME_TYPES.includes(file.type)) {
    return { success: false, error: 'Invalid file format. Allowed: PDF, JPG, PNG, WEBP.' };
  }

  const sanitizedName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80);
  const filePath = `${activeCompany.id}/requests/${Date.now()}_${sanitizedName}`;

  const arrayBuffer = await file.arrayBuffer();
  const buffer = new Uint8Array(arrayBuffer);

  const storageClient = process.env.SUPABASE_SERVICE_ROLE_KEY
    ? createAdminClient()
    : await createClient();

  const { error: uploadError } = await storageClient.storage
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
 * Create a Direct Payment Request (Allowed ONLY for APPROVER, VERIFIER, or is_admin).
 * Notifies all active PREPARER users in the active company.
 */
export async function createPaymentRequest(
  input: CreatePaymentRequestInput
): Promise<ActionResult<PaymentRequest>> {
  const { user, profile, activeCompany } = await getCurrentUserContext();

  if (!user || !profile || !profile.is_active) {
    return { success: false, error: 'Unauthorized. Please sign in.' };
  }

  if (profile.role !== 'APPROVER' && profile.role !== 'VERIFIER' && !profile.is_admin) {
    return {
      success: false,
      error: 'Only Approver, Verifier, or Admin can send payment requests.',
    };
  }

  if (!activeCompany) {
    return { success: false, error: 'Active company workspace could not be determined.' };
  }

  const parsed = createPaymentRequestSchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues[0]?.message || 'Invalid payment request details.',
    };
  }

  const supabase = await createClient();
  const cleanGross = Math.round(parsed.data.gross_amount * 100) / 100;
  const cleanVendorId = parsed.data.vendor_id || null;
  const cleanUnlistedName = cleanVendorId ? null : parsed.data.unlisted_vendor_name?.trim() || null;

  // Verifiers (without admin override) MUST select or create a complete vendor record with bank details
  if (profile.role === 'VERIFIER' && !profile.is_admin && !cleanVendorId) {
    return {
      success: false,
      error: 'Verifiers must select an existing vendor or create a complete vendor with bank details.',
    };
  }

  let resolvedVendorName = cleanUnlistedName || 'Vendor';
  if (cleanVendorId) {
    const { data: vendorRow } = await supabase
      .from('vendors')
      .select('id, party_name, name')
      .eq('id', cleanVendorId)
      .eq('company_id', activeCompany.id)
      .maybeSingle();

    if (!vendorRow) {
      return {
        success: false,
        error: 'Selected vendor does not belong to the active company workspace.',
      };
    }
    resolvedVendorName = vendorRow.party_name || vendorRow.name || 'Vendor';
  }

  const requestedRole = profile.is_admin ? 'ADMIN' : profile.role;
  const cleanInvoiceRef = parsed.data.invoice_ref?.trim() || null;
  const cleanDueDate = parsed.data.due_date?.trim() || null;
  const cleanRemarks = parsed.data.remarks?.trim() || null;
  const cleanBillPath = parsed.data.bill_file_path?.trim() || null;

  const { data: created, error: insertError } = await supabase
    .from('payment_requests')
    .insert({
      company_id: activeCompany.id,
      vendor_id: cleanVendorId,
      unlisted_vendor_name: cleanUnlistedName,
      gross_amount: cleanGross,
      invoice_ref: cleanInvoiceRef,
      purpose: parsed.data.purpose.trim(),
      due_date: cleanDueDate,
      remarks: cleanRemarks,
      bill_file_path: cleanBillPath,
      status: 'PENDING',
      requested_by: user.id,
      requested_role: requestedRole,
    })
    .select(
      '*, vendor:vendors(*), requester:profiles!requested_by(id, full_name, role), processor:profiles!processed_by(id, full_name, role)'
    )
    .single();

  if (insertError || !created) {
    return {
      success: false,
      error: insertError?.message || 'Failed to create payment request.',
    };
  }

  const preparerIds = await getActiveRoleRecipientsForCompany({
    companyId: activeCompany.id,
    targetRole: 'PREPARER',
    excludeUserId: user.id,
  });

  const actionUrl = `/requests?highlight=${encodeURIComponent(created.id)}`;
  const refSuffix = cleanInvoiceRef ? ` · ${cleanInvoiceRef}` : '';

  await sendDirectRequestNotifications({
    companyId: activeCompany.id,
    recipientIds: preparerIds,
    eventType: 'PAYMENT_REQUEST_CREATED',
    title: `New Payment Request from ${profile.full_name}`,
    body: `${resolvedVendorName} · ${formatINR(cleanGross)}${refSuffix}`,
    pushUrl: actionUrl,
    paymentRequestId: created.id,
    actionUrl,
  });

  revalidatePath('/requests');
  revalidatePath('/', 'layout');
  return { success: true, data: created as PaymentRequest };
}

/**
 * Convert a PENDING payment request into a live payment_items record (PENDING_VERIFICATION).
 * Allowed STRICTLY for PREPARER only.
 */
export async function submitRequestToWorkflow(
  input: SubmitRequestToWorkflowInput
): Promise<ActionResult<{ request: PaymentRequest; payment: PaymentItem }>> {
  const { user, profile, activeCompany } = await getCurrentUserContext();

  if (!user || !profile || !profile.is_active) {
    return { success: false, error: 'Unauthorized. Please sign in.' };
  }

  if (profile.role !== 'PREPARER') {
    return {
      success: false,
      error: 'Only a Preparer can review and submit payment requests into the workflow.',
    };
  }

  if (!activeCompany) {
    return { success: false, error: 'Active company workspace could not be determined.' };
  }

  const parsed = submitRequestToWorkflowSchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues[0]?.message || 'Invalid submission fields.',
    };
  }

  const d = parsed.data;
  const supabase = await createClient();

  // 1. Fetch & validate target request
  const { data: existingReq, error: reqFetchError } = await supabase
    .from('payment_requests')
    .select(
      '*, vendor:vendors(id, party_name, name), requester:profiles!requested_by(id, full_name, role)'
    )
    .eq('id', d.request_id)
    .eq('company_id', activeCompany.id)
    .single();

  if (reqFetchError || !existingReq) {
    return { success: false, error: 'Payment request not found in the active company.' };
  }

  if (existingReq.status !== 'PENDING') {
    return {
      success: false,
      error: `This request has already been processed (${existingReq.status}).`,
    };
  }

  if (existingReq.vendor_id && d.vendor_id !== existingReq.vendor_id) {
    return {
      success: false,
      error: 'Vendor is locked by the requester and cannot be changed.',
    };
  }

  // 2. Validate Vendor & Active Source Bank belong to activeCompany
  const [vendorRes, bankRes] = await Promise.all([
    supabase
      .from('vendors')
      .select('id, party_name, name')
      .eq('id', d.vendor_id)
      .eq('company_id', activeCompany.id)
      .maybeSingle(),
    supabase
      .from('company_banks')
      .select('id, is_active')
      .eq('id', d.source_bank_id)
      .eq('company_id', activeCompany.id)
      .maybeSingle(),
  ]);

  if (!vendorRes.data) {
    return { success: false, error: 'Selected vendor does not belong to the active company.' };
  }

  if (!bankRes.data || !bankRes.data.is_active) {
    return { success: false, error: 'Please select an active bank belonging to this company.' };
  }

  const vendorName = vendorRes.data.party_name || vendorRes.data.name || 'Vendor';
  const requesterName =
    (existingReq as { requester?: { full_name?: string } | null }).requester?.full_name ||
    existingReq.requested_role;

  const cleanGross = Math.round(d.gross_amount * 100) / 100;
  const cleanTds = Math.round((d.tds_amount || 0) * 100) / 100;
  const computedNetPayable = Math.round(Math.max(0, cleanGross - cleanTds) * 100) / 100;
  const nowIso = new Date().toISOString();

  const rawRemarks = (d.remarks || '').trim();
  const requestTag = `Requested by ${requesterName}`;
  const finalRemarks = rawRemarks
    ? rawRemarks.toLowerCase().includes('requested by')
      ? rawRemarks
      : `${rawRemarks} (${requestTag})`
    : requestTag;

  // 3. Insert into payment_items as PENDING_VERIFICATION (net_payable is generated by Postgres)
  const { data: newPayment, error: payInsertError } = await supabase
    .from('payment_items')
    .insert({
      company_id: existingReq.company_id,
      sheet_date: getTodayISTDateString(),
      due_date: d.due_date?.trim() || getTodayISTDateString(),
      vendor_id: d.vendor_id,
      source_bank_id: d.source_bank_id,
      invoice_ref: d.invoice_ref?.trim() || 'NA',
      purpose: d.purpose.trim(),
      payment_type: 'AGAINST_BILL',
      payment_mode: d.disbursement_mode,
      amount: cleanGross,
      tds: cleanTds,
      remarks: finalRemarks,
      invoice_file_path: d.bill_file_path?.trim() || existingReq.bill_file_path || null,
      status: 'PENDING_VERIFICATION',
      created_by: user.id,
      submitted_at: nowIso,
    })
    .select(
      '*, vendor:vendors(*), source_bank:company_banks(*), creator:profiles!created_by(id, full_name, role)'
    )
    .single();

  if (payInsertError || !newPayment) {
    return {
      success: false,
      error: payInsertError?.message || 'Failed to submit request into payment workflow.',
    };
  }

  // 4. Update payment_requests as SUBMITTED
  const { data: updatedRequest, error: reqUpdateError } = await supabase
    .from('payment_requests')
    .update({
      status: 'SUBMITTED',
      vendor_id: d.vendor_id,
      processed_by: user.id,
      processed_at: nowIso,
      converted_payment_id: newPayment.id,
    })
    .eq('id', d.request_id)
    .eq('company_id', activeCompany.id)
    .eq('status', 'PENDING')
    .select(
      '*, vendor:vendors(*), requester:profiles!requested_by(id, full_name, role), processor:profiles!processed_by(id, full_name, role)'
    )
    .single();

  if (reqUpdateError || !updatedRequest) {
    return {
      success: false,
      error: reqUpdateError?.message || 'Failed to update payment request status.',
    };
  }

  // 5. Explicit audit log entry tying request -> payment item conversion
  try {
    const db = process.env.SUPABASE_SERVICE_ROLE_KEY ? createAdminClient() : supabase;
    await db.from('audit_logs').insert({
      table_name: 'payment_requests',
      record_id: existingReq.id,
      company_id: existingReq.company_id,
      payment_item_id: newPayment.id,
      action: 'SUBMITTED_TO_WORKFLOW',
      old_data: { status: existingReq.status },
      new_data: {
        status: 'SUBMITTED',
        converted_payment_id: newPayment.id,
        source_bank_id: d.source_bank_id,
        net_payable: computedNetPayable,
      },
      changed_by: user.id,
    });
  } catch (auditErr) {
    console.warn('[Requests] Non-blocking audit log insert error:', auditErr);
  }

  // 6. Dispatch Verifier + Original Requester notifications concurrently
  const verifierIds = await getActiveRoleRecipientsForCompany({
    companyId: activeCompany.id,
    targetRole: 'VERIFIER',
    excludeUserId: user.id,
  });

  const companyCode = activeCompany.code || 'DESK';
  const netFormatted = formatINR(Number(newPayment.net_payable || computedNetPayable));
  const verifyUrl = `/verify?highlight=${encodeURIComponent(newPayment.id)}`;
  const trackerUrl = `/tracker?highlight=${encodeURIComponent(newPayment.id)}`;

  await Promise.all([
    sendDirectRequestNotifications({
      companyId: activeCompany.id,
      recipientIds: verifierIds,
      eventType: 'SUBMITTED_FOR_VERIFICATION',
      title: `[${companyCode}] New Payment Pending Verification`,
      body: `${vendorName} · ${netFormatted} submitted for verification.`,
      pushUrl: verifyUrl,
      paymentItemId: newPayment.id,
      actionUrl: verifyUrl,
    }),
    existingReq.requested_by !== user.id
      ? sendDirectRequestNotifications({
          companyId: activeCompany.id,
          recipientIds: [existingReq.requested_by],
          eventType: 'PAYMENT_REQUEST_SUBMITTED',
          title: `[${companyCode}] Request Submitted to Workflow`,
          body: `${vendorName} (${netFormatted}) is now with Verifier.`,
          pushUrl: trackerUrl,
          paymentItemId: newPayment.id,
          paymentRequestId: existingReq.id,
          actionUrl: trackerUrl,
        })
      : Promise.resolve(),
  ]);

  revalidatePath('/requests');
  revalidatePath('/payments');
  revalidatePath('/verify');
  revalidatePath('/tracker');
  revalidatePath('/', 'layout');

  return {
    success: true,
    data: {
      request: updatedRequest as PaymentRequest,
      payment: newPayment as PaymentItem,
    },
  };
}

/**
 * Decline a PENDING payment request with a required reason (PREPARER only).
 */
export async function declinePaymentRequest(input: {
  request_id: string;
  reason: string;
}): Promise<ActionResult<PaymentRequest>> {
  const { user, profile, activeCompany } = await getCurrentUserContext();

  if (!user || !profile || !profile.is_active) {
    return { success: false, error: 'Unauthorized. Please sign in.' };
  }

  if (profile.role !== 'PREPARER') {
    return {
      success: false,
      error: 'Only a Preparer can review and submit payment requests into the workflow.',
    };
  }

  if (!activeCompany) {
    return { success: false, error: 'Active company workspace could not be determined.' };
  }

  const parsed = declinePaymentRequestSchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues[0]?.message || 'Valid decline reason is required.',
    };
  }

  const supabase = await createClient();
  const { data: existingReq, error: fetchError } = await supabase
    .from('payment_requests')
    .select('*, vendor:vendors(id, party_name, name)')
    .eq('id', parsed.data.request_id)
    .eq('company_id', activeCompany.id)
    .single();

  if (fetchError || !existingReq) {
    return { success: false, error: 'Payment request not found.' };
  }

  if (existingReq.status !== 'PENDING') {
    return {
      success: false,
      error: `Cannot decline request in '${existingReq.status}' status.`,
    };
  }

  const nowIso = new Date().toISOString();
  const { data: updated, error: updateError } = await supabase
    .from('payment_requests')
    .update({
      status: 'DECLINED',
      decline_reason: parsed.data.reason,
      processed_by: user.id,
      processed_at: nowIso,
    })
    .eq('id', parsed.data.request_id)
    .eq('company_id', activeCompany.id)
    .eq('status', 'PENDING')
    .select(
      '*, vendor:vendors(*), requester:profiles!requested_by(id, full_name, role), processor:profiles!processed_by(id, full_name, role)'
    )
    .single();

  if (updateError || !updated) {
    return {
      success: false,
      error: updateError?.message || 'Failed to decline payment request.',
    };
  }

  const vendorObj = (existingReq as { vendor?: { party_name?: string; name?: string } | null }).vendor;
  const vendorName =
    vendorObj?.party_name || vendorObj?.name || existingReq.unlisted_vendor_name || 'Vendor';
  const companyCode = activeCompany.code || 'DESK';
  const actionUrl = `/requests?highlight=${encodeURIComponent(updated.id)}`;

  if (existingReq.requested_by !== user.id) {
    await sendDirectRequestNotifications({
      companyId: activeCompany.id,
      recipientIds: [existingReq.requested_by],
      eventType: 'PAYMENT_REQUEST_DECLINED',
      title: `[${companyCode}] Payment Request Declined`,
      body: `${vendorName} (${formatINR(existingReq.gross_amount)}) declined: "${parsed.data.reason}"`,
      pushUrl: actionUrl,
      paymentRequestId: updated.id,
      actionUrl,
    });
  }

  revalidatePath('/requests');
  revalidatePath('/', 'layout');
  return { success: true, data: updated as PaymentRequest };
}

/**
 * Cancel a PENDING payment request (Allowed for original requested_by or is_admin).
 */
export async function cancelPaymentRequest(input: {
  request_id: string;
}): Promise<ActionResult<PaymentRequest>> {
  const { user, profile, activeCompany } = await getCurrentUserContext();

  if (!user || !profile || !profile.is_active) {
    return { success: false, error: 'Unauthorized. Please sign in.' };
  }

  if (!activeCompany) {
    return { success: false, error: 'Active company workspace could not be determined.' };
  }

  const parsedId = uuidSchema.safeParse(input.request_id);
  if (!parsedId.success) {
    return { success: false, error: 'Invalid request ID.' };
  }

  const supabase = await createClient();
  const { data: existingReq, error: fetchError } = await supabase
    .from('payment_requests')
    .select('id, status, requested_by')
    .eq('id', parsedId.data)
    .eq('company_id', activeCompany.id)
    .single();

  if (fetchError || !existingReq) {
    return { success: false, error: 'Payment request not found.' };
  }

  if (existingReq.requested_by !== user.id && !profile.is_admin) {
    return {
      success: false,
      error: 'Only the requester or an Administrator can cancel this request.',
    };
  }

  if (existingReq.status !== 'PENDING') {
    return {
      success: false,
      error: `Cannot cancel request in '${existingReq.status}' status.`,
    };
  }

  const nowIso = new Date().toISOString();
  const { data: updated, error: updateError } = await supabase
    .from('payment_requests')
    .update({
      status: 'CANCELLED',
      processed_by: user.id,
      processed_at: nowIso,
    })
    .eq('id', parsedId.data)
    .eq('company_id', activeCompany.id)
    .eq('status', 'PENDING')
    .select(
      '*, vendor:vendors(*), requester:profiles!requested_by(id, full_name, role), processor:profiles!processed_by(id, full_name, role)'
    )
    .single();

  if (updateError || !updated) {
    return {
      success: false,
      error: updateError?.message || 'Failed to cancel payment request.',
    };
  }

  revalidatePath('/requests');
  revalidatePath('/', 'layout');
  return { success: true, data: updated as PaymentRequest };
}
