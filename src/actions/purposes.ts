'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { getCurrentUserContext } from '@/lib/auth';
import type { ActionResult, PaymentPurpose } from '@/types/database';

const uuidSchema = z.string().uuid('Valid ID is required.');

/**
 * Add a payment purpose label for the active company workspace.
 * Strictly requires an active PREPARER or Admin user.
 * Deduplicates case-insensitively inside the active company.
 */
export async function addPaymentPurpose(
  label: string
): Promise<ActionResult<PaymentPurpose>> {
  const cleanLabel = (label || '').trim();
  if (!cleanLabel) {
    return { success: false, error: 'Purpose label cannot be empty.' };
  }
  if (cleanLabel.length > 80) {
    return { success: false, error: 'Purpose label must be 80 characters or less.' };
  }

  const supabase = await createClient();
  const { user, profile, activeCompany } = await getCurrentUserContext();

  if (!user || !profile || !profile.is_active) {
    return { success: false, error: 'Unauthorized. Please sign in.' };
  }

  if (profile.role !== 'PREPARER' && !profile.is_admin) {
    return {
      success: false,
      error: 'Access denied: Only Accounts Preparers or Administrators can manage purposes.',
    };
  }

  if (!activeCompany) {
    return { success: false, error: 'Active company workspace could not be determined.' };
  }

  // Check case-insensitive existence in the active company
  const { data: existingList } = await supabase
    .from('payment_purposes')
    .select('*')
    .eq('company_id', activeCompany.id)
    .ilike('label', cleanLabel)
    .limit(1);

  if (existingList && existingList.length > 0) {
    return { success: true, data: existingList[0] as PaymentPurpose };
  }

  const { data: inserted, error: insertError } = await supabase
    .from('payment_purposes')
    .insert({
      company_id: activeCompany.id,
      label: cleanLabel,
      created_by: user.id,
    })
    .select('*')
    .single();

  if (insertError) {
    // Handle concurrent insert race via unique index cleanly
    const { data: retryExisting } = await supabase
      .from('payment_purposes')
      .select('*')
      .eq('company_id', activeCompany.id)
      .ilike('label', cleanLabel)
      .limit(1);

    if (retryExisting && retryExisting.length > 0) {
      return { success: true, data: retryExisting[0] as PaymentPurpose };
    }

    return {
      success: false,
      error: insertError.message || 'Failed to save purpose.',
    };
  }

  revalidatePath('/payments');
  return { success: true, data: inserted as PaymentPurpose };
}

/**
 * Remove a saved payment purpose from the active company's quick-pick list.
 * Historical payment_items keep their stored purpose text unaffected.
 */
export async function deletePaymentPurpose(
  id: string
): Promise<ActionResult<undefined>> {
  const parsed = uuidSchema.safeParse(id);
  if (!parsed.success) {
    return { success: false, error: 'Invalid purpose ID.' };
  }

  const supabase = await createClient();
  const { user, profile, activeCompany } = await getCurrentUserContext();

  if (!user || !profile || !profile.is_active) {
    return { success: false, error: 'Unauthorized. Please sign in.' };
  }

  if (profile.role !== 'PREPARER' && !profile.is_admin) {
    return {
      success: false,
      error: 'Access denied: Only Accounts Preparers or Administrators can delete purposes.',
    };
  }

  if (!activeCompany) {
    return { success: false, error: 'Active company workspace could not be determined.' };
  }

  const { error: deleteError } = await supabase
    .from('payment_purposes')
    .delete()
    .eq('id', parsed.data)
    .eq('company_id', activeCompany.id);

  if (deleteError) {
    return {
      success: false,
      error: deleteError.message || 'Failed to delete saved purpose.',
    };
  }

  revalidatePath('/payments');
  return { success: true, data: undefined };
}
