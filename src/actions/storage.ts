'use server';

import { createClient } from '@/lib/supabase/server';
import type { ActionResult } from '@/types/database';

export type StorageBucket = 'supplier-invoices' | 'bank-receipts';

/**
 * Generate a short-lived (5-minute) signed URL for private bucket file access.
 * Strictly enforces role separation: STAFF is completely blocked from bank-receipts.
 * NEVER calls getPublicUrl().
 */
export async function getSignedFileUrl(
  bucket: StorageBucket,
  filePath: string
): Promise<ActionResult<{ signedUrl: string }>> {
  if (!filePath || !filePath.trim()) {
    return { success: false, error: 'File path is required.' };
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

  if (!profile || !profile.is_active) {
    return { success: false, error: 'Account disabled or profile not found.' };
  }

  // Strict: STAFF cannot access bank-receipts under any circumstance
  if (bucket === 'bank-receipts' && profile.role === 'STAFF') {
    return {
      success: false,
      error: 'Access denied: Staff members cannot view bank disbursement receipts.',
    };
  }

  // If STAFF requests a supplier invoice, ensure they either uploaded it or it's allowed
  if (bucket === 'supplier-invoices' && profile.role === 'STAFF') {
    const { data: bill } = await supabase
      .from('incoming_bills')
      .select('id, uploaded_by')
      .eq('file_path', filePath)
      .maybeSingle();

    if (bill && bill.uploaded_by !== user.id) {
      return {
        success: false,
        error: 'Access denied: You can only view invoices you uploaded.',
      };
    }
  }

  // Create temporary signed URL with 300 seconds (5 minutes) expiry
  const { data, error } = await supabase.storage
    .from(bucket)
    .createSignedUrl(filePath, 300);

  if (error || !data?.signedUrl) {
    return {
      success: false,
      error: error?.message || 'Failed to generate signed document URL.',
    };
  }

  return { success: true, data: { signedUrl: data.signedUrl } };
}
