'use server';

import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { companyBankSchema, type CompanyBankInput } from '@/lib/validators';
import { getCurrentUserContext } from '@/lib/auth';
import { round2 } from '@/lib/format';
import type { ActionResult, CompanyBank } from '@/types/database';

const updateBankBalancesSchema = z
  .array(
    z.object({
      bank_id: z.string().uuid('Valid bank ID is required.'),
      available_balance: z
        .number({ invalid_type_error: 'Bank balance must be a valid number.' })
        .finite('Bank balance must be a finite number.')
        .min(0, 'Bank balance cannot be negative.')
        .max(999999999999, 'Bank balance exceeds maximum allowed value.'),
    })
  )
  .min(1, 'At least one bank balance update is required.')
  .max(50, 'Too many bank balance updates in a single request.');

function revalidateBankDependentPaths(): void {
  revalidatePath('/payments');
  revalidatePath('/approvals');
  revalidatePath('/verify');
  revalidatePath('/settings');
  revalidatePath('/history');
  revalidatePath('/print');
}

function resolveValidatedIfscPrefix(
  explicitPrefix: string | undefined,
  fallbackSource: string
): { valid: true; prefix: string } | { valid: false; error: string } {
  const cleanedExplicit = (explicitPrefix || '').trim().toUpperCase();
  if (cleanedExplicit) {
    if (!/^[A-Z0-9]{4}$/.test(cleanedExplicit)) {
      return {
        valid: false,
        error: 'IFSC prefix must be 4 uppercase alphanumeric characters (e.g. UTIB).',
      };
    }
    return { valid: true, prefix: cleanedExplicit };
  }

  const derived = fallbackSource.replace(/[^A-Z0-9]/g, '').slice(0, 4).toUpperCase();
  if (!/^[A-Z0-9]{4}$/.test(derived)) {
    return {
      valid: false,
      error: 'IFSC prefix must be 4 uppercase alphanumeric characters (e.g. UTIB).',
    };
  }
  return { valid: true, prefix: derived };
}

function normalizeFullDebitAccount(
  raw: string | null | undefined
): { valid: true; value: string | null } | { valid: false; error: string } {
  const cleaned = (raw || '').replace(/\s+/g, '').trim().toUpperCase();
  if (!cleaned) {
    return { valid: true, value: null };
  }
  if (!/^[A-Z0-9]{6,34}$/.test(cleaned)) {
    return {
      valid: false,
      error:
        'Full Corporate Debit Account Number must be at least 6 alphanumeric characters (no spaces).',
    };
  }
  return { valid: true, value: cleaned };
}

async function logBankAuditEvent(params: {
  supabase: Awaited<ReturnType<typeof createClient>>;
  companyId: string;
  bankId: string;
  userId: string;
  action: 'BANK_CREATED' | 'BANK_UPDATED' | 'BANK_STATUS_TOGGLED';
  oldData?: Record<string, unknown> | null;
  newData?: Record<string, unknown> | null;
}): Promise<void> {
  try {
    const db =
      process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY
        ? createAdminClient()
        : params.supabase;

    await db.from('audit_logs').insert({
      table_name: 'company_banks',
      record_id: params.bankId,
      company_id: params.companyId,
      action: params.action,
      old_data: params.oldData ?? null,
      new_data: params.newData ?? null,
      changed_by: params.userId,
    });
  } catch (err) {
    console.warn('[CompanyBanks] Non-blocking audit log insert failed:', err);
  }
}

export async function createCompanyBank(
  input: CompanyBankInput
): Promise<ActionResult<CompanyBank>> {
  const supabase = await createClient();
  const { user, profile, activeCompany } = await getCurrentUserContext();

  if (!user) {
    return { success: false, error: 'Unauthorized. Please sign in.' };
  }

  if (!profile || !profile.is_active || (profile.role !== 'PREPARER' && !profile.is_admin)) {
    return {
      success: false,
      error: 'Only Accounts Preparers or Administrators can add company banks.',
    };
  }

  const parsed = companyBankSchema.safeParse(input);
  if (!parsed.success) {
    const errorMsg = parsed.error.issues[0]?.message || 'Invalid bank details';
    return { success: false, error: errorMsg };
  }

  const bankData = parsed.data;

  // Strict multi-company isolation: non-admin Preparers are locked to activeCompany.id
  const companyId = profile.is_admin
    ? bankData.company_id || activeCompany?.id
    : activeCompany?.id;

  if (!companyId) {
    return { success: false, error: 'A company workspace must be active or specified.' };
  }

  const shortCode = (bankData.short_code || bankData.short_name || '').trim().toUpperCase();
  const bankName = (bankData.bank_name || bankData.full_name || '').trim();

  if (!bankName) {
    return { success: false, error: 'Bank name is required.' };
  }
  if (!shortCode) {
    return { success: false, error: 'Bank short code is required (e.g. AXIS).' };
  }

  const prefixCheck = resolveValidatedIfscPrefix(bankData.ifsc_prefix, shortCode);
  if (!prefixCheck.valid) {
    return { success: false, error: prefixCheck.error };
  }

  const debitCheck = normalizeFullDebitAccount(bankData.full_debit_account_number);
  if (!debitCheck.valid) {
    return { success: false, error: debitCheck.error };
  }

  const openingBalance = round2(Number(bankData.available_balance) || 0);
  if (!Number.isFinite(openingBalance) || openingBalance < 0) {
    return { success: false, error: 'Available balance must be a non-negative finite amount.' };
  }

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

  const maskedAccount =
    bankData.account_number_masked?.trim() || bankData.account_mask?.trim() || null;

  const { data: created, error } = await supabase
    .from('company_banks')
    .insert({
      company_id: companyId,
      bank_name: bankName,
      short_code: shortCode,
      ifsc_prefix: prefixCheck.prefix,
      account_number_masked: maskedAccount,
      full_debit_account_number: debitCheck.value,
      available_balance: openingBalance,
      is_primary: Boolean(bankData.is_primary),
      is_active: Boolean(bankData.is_active ?? true),
      // Legacy columns fallback
      short_name: shortCode,
      full_name: bankName,
      account_mask: maskedAccount,
    })
    .select('*, balance_updater:profiles!balance_updated_by(full_name)')
    .single();

  if (error || !created) {
    return { success: false, error: error?.message || 'Failed to add company bank.' };
  }

  await logBankAuditEvent({
    supabase,
    companyId,
    bankId: created.id,
    userId: user.id,
    action: 'BANK_CREATED',
    newData: {
      short_code: shortCode,
      bank_name: bankName,
      ifsc_prefix: prefixCheck.prefix,
      account_number_masked: maskedAccount,
      is_primary: Boolean(bankData.is_primary),
      is_active: Boolean(bankData.is_active ?? true),
      has_full_debit_account: Boolean(debitCheck.value),
    },
  });

  revalidateBankDependentPaths();
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

  if (!profile || !profile.is_active || (profile.role !== 'PREPARER' && !profile.is_admin)) {
    return {
      success: false,
      error: 'Only Accounts Preparers or Administrators can update company banks.',
    };
  }

  const parsed = companyBankSchema.safeParse(input);
  if (!parsed.success) {
    const errorMsg = parsed.error.issues[0]?.message || 'Invalid bank details';
    return { success: false, error: errorMsg };
  }

  const bankData = parsed.data;

  // Retrieve existing bank to verify company ownership
  const { data: currentBank } = await supabase
    .from('company_banks')
    .select('*')
    .eq('id', bankId)
    .maybeSingle();

  if (!currentBank) {
    return { success: false, error: 'Company bank record not found.' };
  }

  if (!activeCompany) {
    return { success: false, error: 'A company workspace must be active.' };
  }

  if (!profile.is_admin && currentBank.company_id !== activeCompany.id) {
    return {
      success: false,
      error: 'Access denied: This bank does not belong to the active company workspace.',
    };
  }

  const companyId = currentBank.company_id || activeCompany.id;

  const shortCode = (
    bankData.short_code ||
    bankData.short_name ||
    currentBank.short_code ||
    ''
  )
    .trim()
    .toUpperCase();
  const bankName = (
    bankData.bank_name ||
    bankData.full_name ||
    currentBank.bank_name ||
    ''
  ).trim();

  if (!bankName) {
    return { success: false, error: 'Bank name is required.' };
  }
  if (!shortCode) {
    return { success: false, error: 'Bank short code is required (e.g. AXIS).' };
  }

  const prefixCheck = resolveValidatedIfscPrefix(
    bankData.ifsc_prefix || currentBank.ifsc_prefix,
    shortCode
  );
  if (!prefixCheck.valid) {
    return { success: false, error: prefixCheck.error };
  }

  const debitCheck = normalizeFullDebitAccount(bankData.full_debit_account_number);
  if (!debitCheck.valid) {
    return { success: false, error: debitCheck.error };
  }

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

  const maskedAccount =
    bankData.account_number_masked?.trim() || bankData.account_mask?.trim() || null;
  const resolvedIsActive =
    input.is_active !== undefined ? Boolean(bankData.is_active) : Boolean(currentBank.is_active);

  // Preserve available_balance untouched during details edit (defense-in-depth scoped by company_id)
  const { data: updated, error } = await supabase
    .from('company_banks')
    .update({
      bank_name: bankName,
      short_code: shortCode,
      ifsc_prefix: prefixCheck.prefix,
      account_number_masked: maskedAccount,
      full_debit_account_number: debitCheck.value,
      is_primary: Boolean(bankData.is_primary),
      is_active: resolvedIsActive,
      // Legacy columns fallback
      short_name: shortCode,
      full_name: bankName,
      account_mask: maskedAccount,
      updated_at: new Date().toISOString(),
    })
    .eq('id', bankId)
    .eq('company_id', companyId)
    .select('*, balance_updater:profiles!balance_updated_by(full_name)')
    .single();

  if (error || !updated) {
    return { success: false, error: error?.message || 'Failed to update company bank.' };
  }

  await logBankAuditEvent({
    supabase,
    companyId,
    bankId,
    userId: user.id,
    action: 'BANK_UPDATED',
    oldData: {
      short_code: currentBank.short_code,
      bank_name: currentBank.bank_name,
      ifsc_prefix: currentBank.ifsc_prefix,
      account_number_masked: currentBank.account_number_masked,
      is_primary: currentBank.is_primary,
      is_active: currentBank.is_active,
      has_full_debit_account: Boolean(currentBank.full_debit_account_number),
    },
    newData: {
      short_code: shortCode,
      bank_name: bankName,
      ifsc_prefix: prefixCheck.prefix,
      account_number_masked: maskedAccount,
      is_primary: Boolean(bankData.is_primary),
      is_active: resolvedIsActive,
      has_full_debit_account: Boolean(debitCheck.value),
    },
  });

  revalidateBankDependentPaths();
  return { success: true, data: updated as CompanyBank };
}

export async function toggleCompanyBankActive(
  bankId: string
): Promise<ActionResult<CompanyBank>> {
  const supabase = await createClient();
  const { user, profile, activeCompany } = await getCurrentUserContext();

  if (!user) {
    return { success: false, error: 'Unauthorized. Please sign in.' };
  }

  if (!profile || !profile.is_active || (profile.role !== 'PREPARER' && !profile.is_admin)) {
    return {
      success: false,
      error: 'Only Accounts Preparers or Administrators can manage company banks.',
    };
  }

  const { data: currentBank } = await supabase
    .from('company_banks')
    .select('*')
    .eq('id', bankId)
    .maybeSingle();

  if (!currentBank) {
    return { success: false, error: 'Bank record not found.' };
  }

  if (!activeCompany) {
    return { success: false, error: 'A company workspace must be active.' };
  }

  if (!profile.is_admin && currentBank.company_id !== activeCompany.id) {
    return {
      success: false,
      error: 'Access denied: This bank does not belong to the active company workspace.',
    };
  }

  const companyId = currentBank.company_id || activeCompany.id;

  // Prevent disabling if it's the last active bank for this company
  if (currentBank.is_active) {
    const { count } = await supabase
      .from('company_banks')
      .select('*', { count: 'exact', head: true })
      .eq('company_id', companyId)
      .eq('is_active', true);

    if (count !== null && count <= 1) {
      return { success: false, error: 'At least one company bank must remain active.' };
    }
  }

  const nextActive = !currentBank.is_active;

  const { data: updated, error } = await supabase
    .from('company_banks')
    .update({
      is_active: nextActive,
      updated_at: new Date().toISOString(),
    })
    .eq('id', bankId)
    .eq('company_id', companyId)
    .select('*, balance_updater:profiles!balance_updated_by(full_name)')
    .single();

  if (error || !updated) {
    return { success: false, error: error?.message || 'Failed to update bank status.' };
  }

  await logBankAuditEvent({
    supabase,
    companyId,
    bankId,
    userId: user.id,
    action: 'BANK_STATUS_TOGGLED',
    oldData: {
      short_code: currentBank.short_code,
      bank_name: currentBank.bank_name,
      is_active: currentBank.is_active,
    },
    newData: {
      short_code: currentBank.short_code,
      bank_name: currentBank.bank_name,
      is_active: nextActive,
    },
  });

  revalidateBankDependentPaths();
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
    return {
      success: false,
      error: 'Only Preparers or Administrators can update live bank balances.',
    };
  }

  if (!activeCompany) {
    return { success: false, error: 'A company workspace must be active.' };
  }

  const parsed = updateBankBalancesSchema.safeParse(updates);
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues[0]?.message || 'Invalid bank balance update payload.',
    };
  }

  const validatedUpdates = parsed.data;
  const bankIds = validatedUpdates.map((u) => u.bank_id);

  if (new Set(bankIds).size !== bankIds.length) {
    return { success: false, error: 'Duplicate bank IDs provided in balance update.' };
  }

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

  for (const update of validatedUpdates) {
    const balance = Math.round(update.available_balance * 100) / 100;
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
      return {
        success: false,
        error: updateError?.message || `Failed to update balance for bank ${update.bank_id}.`,
      };
    }
    updatedBanks.push(updated as CompanyBank);
  }

  revalidatePath('/payments');
  revalidatePath('/approvals');
  return { success: true, data: updatedBanks };
}
