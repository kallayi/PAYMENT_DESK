'use server';

import { createClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';
import { companyBankSchema, type CompanyBankInput } from '@/lib/validators';
import type { ActionResult, CompanyBank } from '@/types/database';

export async function createCompanyBank(
  input: CompanyBankInput
): Promise<ActionResult<CompanyBank>> {
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
    return { success: false, error: 'Only the OWNER can manage company banks.' };
  }

  const parsed = companyBankSchema.safeParse(input);
  if (!parsed.success) {
    const errorMsg = parsed.error.issues[0]?.message || 'Invalid bank details';
    return { success: false, error: errorMsg };
  }

  const bankData = parsed.data;

  // Check duplicate short_name
  const { data: existing } = await supabase
    .from('company_banks')
    .select('id, short_name')
    .ilike('short_name', bankData.short_name.trim())
    .maybeSingle();

  if (existing) {
    return {
      success: false,
      error: `A bank with label "${bankData.short_name}" already exists.`,
    };
  }

  const { data: created, error } = await supabase
    .from('company_banks')
    .insert({
      short_name: bankData.short_name.trim(),
      full_name: bankData.full_name.trim(),
      account_mask: bankData.account_mask?.trim() || null,
      is_active: true,
    })
    .select()
    .single();

  if (error || !created) {
    return { success: false, error: error?.message || 'Failed to add bank.' };
  }

  revalidatePath('/settings');
  revalidatePath('/approvals');
  return { success: true, data: created };
}

export async function toggleCompanyBankActive(
  bankId: string
): Promise<ActionResult<CompanyBank>> {
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
    return { success: false, error: 'Only the OWNER can manage company banks.' };
  }

  const { data: currentBank } = await supabase
    .from('company_banks')
    .select('*')
    .eq('id', bankId)
    .single();

  if (!currentBank) {
    return { success: false, error: 'Bank record not found.' };
  }

  // Prevent disabling if it's the last active bank
  if (currentBank.is_active) {
    const { count } = await supabase
      .from('company_banks')
      .select('*', { count: 'exact', head: true })
      .eq('is_active', true);

    if (count !== null && count <= 1) {
      return { success: false, error: 'At least one company bank must remain active.' };
    }
  }

  const { data: updated, error } = await supabase
    .from('company_banks')
    .update({
      is_active: !currentBank.is_active,
    })
    .eq('id', bankId)
    .select()
    .single();

  if (error || !updated) {
    return { success: false, error: error?.message || 'Failed to update bank status.' };
  }

  revalidatePath('/settings');
  revalidatePath('/approvals');
  return { success: true, data: updated };
}
