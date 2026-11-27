'use server';

import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { getCurrentUserContext } from '@/lib/auth';
import type { ActionResult } from '@/types/database';

const storageBucketSchema = z.enum(['supplier-invoices', 'bank-receipts']);
const uuidSchema = z.string().uuid();

export type StorageBucket = z.infer<typeof storageBucketSchema>;

/**
 * Generate a short-lived (15-minute) signed URL for private bucket file access.
 * Enforces runtime bucket validation, path traversal sanitization, active user context,
 * and strict multi-company workspace prefix ownership. NEVER calls getPublicUrl().
 */
export async function getSignedFileUrl(
  bucket: StorageBucket,
  filePath: string
): Promise<ActionResult<{ signedUrl: string }>> {
  const parsedBucket = storageBucketSchema.safeParse(bucket);
  if (!parsedBucket.success) {
    return { success: false, error: 'Invalid storage bucket.' };
  }

  const cleanPath = typeof filePath === 'string' ? filePath.trim() : '';
  if (
    !cleanPath ||
    cleanPath.includes('..') ||
    cleanPath.includes('\\') ||
    cleanPath.includes('\0') ||
    cleanPath.startsWith('/')
  ) {
    return { success: false, error: 'Invalid document file path.' };
  }

  const firstSegment = cleanPath.split('/')[0] || '';
  if (!uuidSchema.safeParse(firstSegment).success) {
    return {
      success: false,
      error: 'Access denied: Invalid company prefix on document path.',
    };
  }

  const { user, profile, allowedCompanies } = await getCurrentUserContext();

  if (!user || !profile || !profile.is_active) {
    return { success: false, error: 'Unauthorized. Please sign in.' };
  }

  const hasCompanyPathAccess = allowedCompanies.some((c) =>
    cleanPath.startsWith(`${c.id}/`)
  );

  if (!hasCompanyPathAccess) {
    return {
      success: false,
      error: 'Access denied: Document does not belong to an authorized company workspace.',
    };
  }

  const supabase = await createClient();

  const { data, error } = await supabase.storage
    .from(parsedBucket.data)
    .createSignedUrl(cleanPath, 900);

  if (error || !data?.signedUrl) {
    return {
      success: false,
      error: error?.message || 'Failed to generate signed document URL.',
    };
  }

  return { success: true, data: { signedUrl: data.signedUrl } };
}
