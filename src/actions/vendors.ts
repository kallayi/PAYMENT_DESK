'use server';

import { createClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';
import { vendorSchema, type VendorInput } from '@/lib/validators';
import type { ActionResult, Vendor } from '@/types/database';

export async function createVendor(
  input: VendorInput
): Promise<ActionResult<Vendor>> {
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
    return { success: false, error: 'Account is disabled or profile not found.' };
  }

  // Validate with Zod
  const parsed = vendorSchema.safeParse(input);
  if (!parsed.success) {
    const errorMsg = parsed.error.issues[0]?.message || 'Invalid vendor details';
    return { success: false, error: errorMsg };
  }

  const vendorData = parsed.data;

  // Check for duplicate vendor name
  const { data: existing } = await supabase
    .from('vendors')
    .select('id, name')
    .ilike('name', vendorData.name.trim())
    .maybeSingle();

  if (existing) {
    return { success: false, error: `A vendor with the name "${vendorData.name}" already exists.` };
  }

  const { data: created, error } = await supabase
    .from('vendors')
    .insert({
      name: vendorData.name.trim(),
      gstin: vendorData.gstin?.trim() || null,
      bank_account_no: vendorData.bank_account_no?.trim() || null,
      ifsc_code: vendorData.ifsc_code?.trim() || null,
      notes: vendorData.notes?.trim() || null,
      is_active: true,
      created_by: user.id,
    })
    .select()
    .single();

  if (error || !created) {
    return { success: false, error: error?.message || 'Failed to create vendor.' };
  }

  revalidatePath('/vendors');
  revalidatePath('/payments');
  return { success: true, data: created };
}

export async function updateVendor(
  vendorId: string,
  input: VendorInput
): Promise<ActionResult<Vendor>> {
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

  if (!profile || !profile.is_active || (profile.role !== 'OWNER' && profile.role !== 'ACCOUNTANT')) {
    return { success: false, error: 'Unauthorized to edit vendor.' };
  }

  const parsed = vendorSchema.safeParse(input);
  if (!parsed.success) {
    const errorMsg = parsed.error.issues[0]?.message || 'Invalid vendor details';
    return { success: false, error: errorMsg };
  }

  const vendorData = parsed.data;

  // Check for duplicate vendor name with other IDs
  const { data: duplicate } = await supabase
    .from('vendors')
    .select('id, name')
    .ilike('name', vendorData.name.trim())
    .neq('id', vendorId)
    .maybeSingle();

  if (duplicate) {
    return { success: false, error: `Another vendor named "${vendorData.name}" already exists.` };
  }

  const { data: updated, error } = await supabase
    .from('vendors')
    .update({
      name: vendorData.name.trim(),
      gstin: vendorData.gstin?.trim() || null,
      bank_account_no: vendorData.bank_account_no?.trim() || null,
      ifsc_code: vendorData.ifsc_code?.trim() || null,
      notes: vendorData.notes?.trim() || null,
    })
    .eq('id', vendorId)
    .select()
    .single();

  if (error || !updated) {
    return { success: false, error: error?.message || 'Failed to update vendor.' };
  }

  revalidatePath('/vendors');
  revalidatePath('/payments');
  return { success: true, data: updated };
}
