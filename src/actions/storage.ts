'use server';

import { createClient } from '@/lib/supabase/server';
import type { ActionResult } from '@/types/database';

export type StorageBucket = 'supplier-invoices' | 'bank-receipts';

/**
 * Generate a short-lived (5-minute) signed URL for private bucket file access.
 * Strictly verifies role: Only ACCOUNTANT and OWNER can access.
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

  // Only ACCOUNTANT and OWNER can access files
  if (profile.role !== 'ACCOUNTANT' && profile.role !== 'OWNER') {
    return {
      success: false,
      error: 'Access denied: You do not have permission to view documents.',
    };
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
