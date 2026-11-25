'use server';

import { createClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';
import { companyBankSchema, type CompanyBankInput } from '@/lib/validators';
import { getCurrentUserContext } from '@/lib/auth';
import type { ActionResult, CompanyBank } from '@/types/database';

export async function createCompanyBank(
  input: CompanyBankInput
): Promise<ActionResult<CompanyBank>> {
  const supabase = await createClient();
  const { user, profile, activeCompany } = await getCurrentUserContext();

  if (!user) {
    return { success: false, error: 'Unauthorized. Please sign in.' };
  }

  if (!profile || !profile.is_active || !profile.is_admin) {
    return { success: false, error: 'Only an Administrator can add company banks.' };
  }

  const parsed = companyBankSchema.safeParse(input);
  if (!parsed.success) {
    const errorMsg = parsed.error.issues[0]?.message || 'Invalid bank details';
    return { success: false, error: errorMsg };
  }

  const bankData = parsed.data;
  const companyId = bankData.company_id || activeCompany?.id;

  if (!companyId) {
    return { success: false, error: 'A company workspace must be active or specified.' };
  }

  const shortCode = (bankData.short_code || bankData.short_name || '').trim().toUpperCase();
  const bankName = (bankData.bank_name || bankData.full_name || '').trim();
  const ifscPrefix = (bankData.ifsc_prefix || shortCode.slice(0, 4)).trim().toUpperCase();

  // Check duplicate short_code within the target company
  const { data: existing } = await supabase
    .from('company_banks')
    .select('id, short_code')
    .eq('company_id', companyId)
    .ilike('short_code', shortCode)
    .maybeSingle();

  if (existing) {
    return {
      success: false,
      error: `A bank with short code "${shortCode}" already exists for this company.`,
    };
  }

  // If set as primary, unset other primary banks for this company first
  if (bankData.is_primary) {
    await supabase
      .from('company_banks')
      .update({ is_primary: false })
      .eq('company_id', companyId);
  }

  const { data: created, error } = await supabase
    .from('company_banks')
    .insert({
      company_id: companyId,
      bank_name: bankName,
      short_code: shortCode,
      ifsc_prefix: ifscPrefix,
      account_number_masked: bankData.account_number_masked?.trim() || bankData.account_mask?.trim() || null,
      full_debit_account_number: bankData.full_debit_account_number?.replace(/\s+/g, '').trim() || null,
      available_balance: bankData.available_balance || 0,
      is_primary: Boolean(bankData.is_primary),
      is_active: Boolean(bankData.is_active ?? true),
      // Legacy columns fallback
      short_name: shortCode,
      full_name: bankName,
      account_mask: bankData.account_number_masked?.trim() || bankData.account_mask?.trim() || null,
    })
    .select()
    .single();

  if (error || !created) {
    return { success: false, error: error?.message || 'Failed to add company bank.' };
  }

  revalidatePath('/settings');
  revalidatePath('/approvals');
  revalidatePath('/payments');
  return { success: true, data: created as CompanyBank };
}

export async function updateCompanyBank(
  bankId: string,
  input: CompanyBankInput
): Promise<ActionResult<CompanyBank>> {
  const supabase = await createClient();
  const { user, profile, activeCompany } = await getCurrentUserContext();

  if (!user) {
    return { success: false, error: 'Unauthorized. Please sign in.' };
  }

  if (!profile || !profile.is_active || !profile.is_admin) {
    return { success: false, error: 'Only an Administrator can update company banks.' };
  }

  const parsed = companyBankSchema.safeParse(input);
  if (!parsed.success) {
    const errorMsg = parsed.error.issues[0]?.message || 'Invalid bank details';
    return { success: false, error: errorMsg };
  }

  const bankData = parsed.data;

  // Retrieve existing bank to get company_id
  const { data: currentBank } = await supabase
    .from('company_banks')
    .select('*')
    .eq('id', bankId)
    .single();

  if (!currentBank) {
    return { success: false, error: 'Company bank record not found.' };
  }

  const companyId = currentBank.company_id || activeCompany?.id;
  if (!companyId) {
    return { success: false, error: 'Target company ID could not be resolved.' };
  }

  const shortCode = (bankData.short_code || bankData.short_name || currentBank.short_code || '').trim().toUpperCase();
  const bankName = (bankData.bank_name || bankData.full_name || currentBank.bank_name || '').trim();
  const ifscPrefix = (bankData.ifsc_prefix || currentBank.ifsc_prefix || shortCode.slice(0, 4)).trim().toUpperCase();

  // Check duplicate short_code within the company excluding current bank
  const { data: existing } = await supabase
    .from('company_banks')
    .select('id, short_code')
    .eq('company_id', companyId)
    .ilike('short_code', shortCode)
    .neq('id', bankId)
    .maybeSingle();

  if (existing) {
    return {
      success: false,
      error: `Another bank with short code "${shortCode}" already exists for this company.`,
    };
  }

  // If marked primary, unset other primary banks for this company
  if (bankData.is_primary) {
    await supabase
      .from('company_banks')
      .update({ is_primary: false })
      .eq('company_id', companyId)
      .neq('id', bankId);
  }

  const { data: updated, error } = await supabase
    .from('company_banks')
    .update({
      bank_name: bankName,
      short_code: shortCode,
      ifsc_prefix: ifscPrefix,
      account_number_masked: bankData.account_number_masked?.trim() || bankData.account_mask?.trim() || null,
      full_debit_account_number: bankData.full_debit_account_number?.replace(/\s+/g, '').trim() || null,
      is_primary: Boolean(bankData.is_primary),
      is_active: Boolean(bankData.is_active ?? currentBank.is_active),
      // Legacy columns fallback
      short_name: shortCode,
      full_name: bankName,
      account_mask: bankData.account_number_masked?.trim() || bankData.account_mask?.trim() || null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', bankId)
    .select()
    .single();

  if (error || !updated) {
    return { success: false, error: error?.message || 'Failed to update company bank.' };
  }

  revalidatePath('/settings');
  revalidatePath('/approvals');
  revalidatePath('/payments');
  return { success: true, data: updated as CompanyBank };
}

export async function toggleCompanyBankActive(
  bankId: string
): Promise<ActionResult<CompanyBank>> {
  const supabase = await createClient();
  const { user, profile } = await getCurrentUserContext();

  if (!user) {
    return { success: false, error: 'Unauthorized. Please sign in.' };
  }

  if (!profile || !profile.is_active || !profile.is_admin) {
    return { success: false, error: 'Only an Administrator can manage company banks.' };
  }

  const { data: currentBank } = await supabase
    .from('company_banks')
    .select('*')
    .eq('id', bankId)
    .single();

  if (!currentBank) {
    return { success: false, error: 'Bank record not found.' };
  }

  const companyId = currentBank.company_id;

  // Prevent disabling if it's the last active bank for this company
  if (currentBank.is_active && companyId) {
    const { count } = await supabase
      .from('company_banks')
      .select('*', { count: 'exact', head: true })
      .eq('company_id', companyId)
      .eq('is_active', true);

    if (count !== null && count <= 1) {
      return { success: false, error: 'At least one company bank must remain active.' };
    }
  }

  const { data: updated, error } = await supabase
    .from('company_banks')
    .update({
      is_active: !currentBank.is_active,
      updated_at: new Date().toISOString(),
    })
    .eq('id', bankId)
    .select()
    .single();

  if (error || !updated) {
    return { success: false, error: error?.message || 'Failed to update bank status.' };
  }

  revalidatePath('/settings');
  revalidatePath('/approvals');
  revalidatePath('/payments');
  return { success: true, data: updated as CompanyBank };
}

export async function updateBankBalances(
  updates: { bank_id: string; available_balance: number }[]
): Promise<ActionResult<CompanyBank[]>> {
  const supabase = await createClient();
  const { user, profile, activeCompany } = await getCurrentUserContext();

  if (!user || !profile || !profile.is_active) {
    return { success: false, error: 'Unauthorized. Please sign in.' };
  }

  // Strictly verify active PREPARER or is_admin = true
  if (profile.role !== 'PREPARER' && !profile.is_admin) {
    return { success: false, error: 'Only Preparers or Administrators can update live bank balances.' };
  }

  if (!activeCompany) {
    return { success: false, error: 'A company workspace must be active.' };
  }

  if (!updates || updates.length === 0) {
    return { success: false, error: 'No bank balance updates provided.' };
  }

  const bankIds = updates.map((u) => u.bank_id);
  const { data: validBanks, error: fetchError } = await supabase
    .from('company_banks')
    .select('id, company_id')
    .eq('company_id', activeCompany.id)
    .in('id', bankIds);

  if (fetchError || !validBanks || validBanks.length !== bankIds.length) {
    return { success: false, error: 'One or more banks do not belong to the active company.' };
  }

  const now = new Date().toISOString();
  const updatedBanks: CompanyBank[] = [];

  for (const update of updates) {
    const balance = Math.round((Number(update.available_balance) || 0) * 100) / 100;
    const { data: updated, error: updateError } = await supabase
      .from('company_banks')
      .update({
        available_balance: balance,
        balance_updated_at: now,
        balance_updated_by: profile.id,
        updated_at: now,
      })
      .eq('id', update.bank_id)
      .eq('company_id', activeCompany.id)
      .select('*, balance_updater:profiles!balance_updated_by(full_name)')
      .single();

    if (updateError || !updated) {
      return { success: false, error: updateError?.message || `Failed to update balance for bank ${update.bank_id}.` };
    }
    updatedBanks.push(updated as CompanyBank);
  }

  revalidatePath('/payments');
  revalidatePath('/approvals');
  return { success: true, data: updatedBanks };
}
