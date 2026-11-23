'use server';

import { createClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';
import { incomingBillSchema, dismissIncomingBillSchema } from '@/lib/validators';
import type { ActionResult, IncomingBill } from '@/types/database';

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB
const ALLOWED_MIME_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
];

/**
 * Server Action for Stock Staff (or Accountant) to upload a supplier bill/invoice.
 * Stores the file in the private 'supplier-invoices' bucket and saves metadata in 'incoming_bills'.
 */
export async function uploadIncomingBill(
  formData: FormData
): Promise<ActionResult<IncomingBill>> {
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

  if (!profile || !profile.is_active) {
    return { success: false, error: 'User profile not found or disabled.' };
  }

  const file = formData.get('file') as File | null;
  const vendorIdRaw = (formData.get('vendor_id') as string | null) || null;
  const vendorNameFallback = (formData.get('vendor_name_fallback') as string | null) || null;
  const invoiceRef = (formData.get('invoice_ref') as string | null) || '';
  const estimatedAmountRaw = formData.get('estimated_amount') as string | null;
  const notes = (formData.get('notes') as string | null) || null;

  // 1. File Validation
  if (!file || file.size === 0) {
    return { success: false, error: 'Please choose an invoice photo or PDF file.' };
  }

  if (file.size > MAX_FILE_SIZE) {
    return { success: false, error: 'File size exceeds the 5 MB limit.' };
  }

  if (!ALLOWED_MIME_TYPES.includes(file.type)) {
    return {
      success: false,
      error: 'Invalid file format. Allowed formats: PDF, JPEG, PNG, WEBP.',
    };
  }

  // Parse estimated amount
  const estimatedAmount =
    estimatedAmountRaw && estimatedAmountRaw.trim() !== ''
      ? parseFloat(estimatedAmountRaw)
      : null;

  let vendorId: string | null = vendorIdRaw && vendorIdRaw !== '__new__' ? vendorIdRaw : null;
  let finalFallbackName: string | null = vendorNameFallback ? vendorNameFallback.trim() : null;

  // If new vendor name provided, check if it already exists in vendors table
  if (!vendorId && finalFallbackName) {
    const { data: existingVendor } = await supabase
      .from('vendors')
      .select('id')
      .ilike('name', finalFallbackName)
      .maybeSingle();

    if (existingVendor) {
      vendorId = existingVendor.id;
      finalFallbackName = null;
    } else {
      // Auto-create new vendor entry so Accountant and Owner have it in directory
      const { data: newVendor } = await supabase
        .from('vendors')
        .insert({
          name: finalFallbackName,
          is_active: true,
          created_by: user.id,
        })
        .select('id')
        .single();

      if (newVendor) {
        vendorId = newVendor.id;
      }
    }
  }

  // 2. Validate input schema
  const parsed = incomingBillSchema.safeParse({
    vendor_id: vendorId,
    vendor_name_fallback: finalFallbackName,
    invoice_ref: invoiceRef.trim(),
    estimated_amount: estimatedAmount,
    file_path: 'pending_upload', // placeholder to satisfy schema check
    notes: notes?.trim() || null,
  });

  if (!parsed.success) {
    const firstError = parsed.error.issues[0]?.message || 'Invalid bill input.';
    return { success: false, error: firstError };
  }

  // 3. Upload file to private Supabase Storage bucket
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
    return {
      success: false,
      error: `Storage upload failed: ${uploadError.message}`,
    };
  }

  // 4. Save metadata in incoming_bills
  const { data: bill, error: insertError } = await supabase
    .from('incoming_bills')
    .insert({
      vendor_id: vendorId,
      vendor_name_fallback: finalFallbackName,
      invoice_ref: invoiceRef.trim(),
      estimated_amount: estimatedAmount && estimatedAmount > 0 ? estimatedAmount : null,
      file_path: filePath,
      notes: notes?.trim() || null,
      status: 'NEW',
      uploaded_by: user.id,
    })
    .select('*, vendor:vendors(id, name, gstin)')
    .single();

  if (insertError || !bill) {
    return {
      success: false,
      error: insertError?.message || 'Failed to save bill record in database.',
    };
  }

  revalidatePath('/bills');
  revalidatePath('/payments');
  return { success: true, data: bill };
}

/**
 * Accountant or Owner can dismiss an incoming bill if duplicate or invalid.
 */
export async function dismissIncomingBill(
  billId: string
): Promise<ActionResult<IncomingBill>> {
  const parsed = dismissIncomingBillSchema.safeParse({ bill_id: billId });
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues[0]?.message || 'Invalid bill ID.',
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

  if (
    !profile ||
    !profile.is_active ||
    (profile.role !== 'ACCOUNTANT' && profile.role !== 'OWNER')
  ) {
    return {
      success: false,
      error: 'Only Accountant or Owner can dismiss incoming bills.',
    };
  }

  const { data: updated, error } = await supabase
    .from('incoming_bills')
    .update({ status: 'DISMISSED' })
    .eq('id', billId)
    .select()
    .single();

  if (error || !updated) {
    return { success: false, error: error?.message || 'Failed to dismiss bill.' };
  }

  revalidatePath('/payments');
  revalidatePath('/bills');
  return { success: true, data: updated };
}
