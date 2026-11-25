'use server';

import { createClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';
import { vendorSchema, type VendorInput } from '@/lib/validators';
import { getCurrentUserContext } from '@/lib/auth';
import type { ActionResult, Vendor } from '@/types/database';

export async function createVendor(
  input: VendorInput
): Promise<ActionResult<Vendor>> {
  const supabase = await createClient();
  const { user, profile, activeCompany } = await getCurrentUserContext();

  if (!user) {
    return { success: false, error: 'Unauthorized. Please sign in.' };
  }

  if (!profile || !profile.is_active) {
    return { success: false, error: 'Account is disabled or profile not found.' };
  }

  // Mutations restricted to PREPARER or is_admin
  if (profile.role !== 'PREPARER' && !profile.is_admin) {
    return { success: false, error: 'Only an Accounts Preparer or Admin can add vendors.' };
  }

  // Validate with Zod
  const parsed = vendorSchema.safeParse(input);
  if (!parsed.success) {
    const errorMsg = parsed.error.issues[0]?.message || 'Invalid vendor details';
    return { success: false, error: errorMsg };
  }

  const vendorData = parsed.data;
  if (!activeCompany) {
    return { success: false, error: 'A company workspace must be selected to register a vendor.' };
  }
  const companyId = activeCompany.id;

  const partyName = (vendorData.party_name || vendorData.name || '').trim();
  if (!partyName) {
    return { success: false, error: 'Vendor party name is required.' };
  }

  const beneficiaryName = (vendorData.beneficiary_name || partyName).trim();
  const accountNumber = (vendorData.account_number || vendorData.bank_account_no || '000000000000').trim();
  const ifscCode = (vendorData.ifsc_code || 'UTIB0000000').trim().toUpperCase();
  const remarks = vendorData.remarks?.trim() || vendorData.notes?.trim() || null;

  // Check for duplicate party_name within the active company
  const { data: existing } = await supabase
    .from('vendors')
    .select('id, party_name, name')
    .eq('company_id', companyId)
    .ilike('party_name', partyName)
    .maybeSingle();

  if (existing) {
    return {
      success: false,
      error: `A vendor with the trade name "${partyName}" already exists in ${activeCompany?.name || 'this company'}.`,
    };
  }

  const { data: created, error } = await supabase
    .from('vendors')
    .insert({
      company_id: companyId,
      party_name: partyName,
      beneficiary_name: beneficiaryName,
      account_number: accountNumber,
      ifsc_code: ifscCode,
      remarks: remarks,
      // Backward compatibility columns
      name: partyName,
      bank_account_no: accountNumber,
      notes: remarks,
      is_active: true,
      created_by: user.id,
    })
    .select()
    .single();

  if (error || !created) {
    return { success: false, error: error?.message || 'Failed to create vendor record.' };
  }

  revalidatePath('/vendors');
  revalidatePath('/payments');
  return { success: true, data: created as Vendor };
}

export async function updateVendor(
  vendorId: string,
  input: VendorInput
): Promise<ActionResult<Vendor>> {
  const supabase = await createClient();
  const { user, profile, activeCompany } = await getCurrentUserContext();

  if (!user) {
    return { success: false, error: 'Unauthorized. Please sign in.' };
  }

  if (!profile || !profile.is_active) {
    return { success: false, error: 'Account is disabled or profile not found.' };
  }

  // Mutations restricted to PREPARER or is_admin
  if (profile.role !== 'PREPARER' && !profile.is_admin) {
    return { success: false, error: 'Only an Accounts Preparer or Admin can edit vendors.' };
  }

  const parsed = vendorSchema.safeParse(input);
  if (!parsed.success) {
    const errorMsg = parsed.error.issues[0]?.message || 'Invalid vendor details';
    return { success: false, error: errorMsg };
  }

  const vendorData = parsed.data;

  if (!activeCompany) {
    return { success: false, error: 'A company workspace must be active.' };
  }

  // Fetch current vendor to verify ownership within activeCompany
  const { data: currentVendor } = await supabase
    .from('vendors')
    .select('id, company_id')
    .eq('id', vendorId)
    .eq('company_id', activeCompany.id)
    .single();

  if (!currentVendor) {
    return { success: false, error: 'Vendor record not found.' };
  }

  const partyName = (vendorData.party_name || vendorData.name || '').trim();
  if (!partyName) {
    return { success: false, error: 'Vendor party name is required.' };
  }

  const beneficiaryName = (vendorData.beneficiary_name || partyName).trim();
  const accountNumber = (vendorData.account_number || vendorData.bank_account_no || '000000000000').trim();
  const ifscCode = (vendorData.ifsc_code || 'UTIB0000000').trim().toUpperCase();
  const remarks = vendorData.remarks?.trim() || vendorData.notes?.trim() || null;

  const companyId = currentVendor.company_id || activeCompany?.id;

  // Check for duplicate party_name in the same company excluding current vendor
  let dupQuery = supabase
    .from('vendors')
    .select('id, party_name')
    .ilike('party_name', partyName)
    .neq('id', vendorId);

  if (companyId) {
    dupQuery = dupQuery.eq('company_id', companyId);
  }

  const { data: duplicate } = await dupQuery.maybeSingle();

  if (duplicate) {
    return {
      success: false,
      error: `Another vendor named "${partyName}" already exists in this company.`,
    };
  }

  const { data: updated, error } = await supabase
    .from('vendors')
    .update({
      party_name: partyName,
      beneficiary_name: beneficiaryName,
      account_number: accountNumber,
      ifsc_code: ifscCode,
      remarks: remarks,
      // Backward compatibility columns
      name: partyName,
      bank_account_no: accountNumber,
      notes: remarks,
      updated_at: new Date().toISOString(),
    })
    .eq('id', vendorId)
    .select()
    .single();

  if (error || !updated) {
    return { success: false, error: error?.message || 'Failed to update vendor record.' };
  }

  revalidatePath('/vendors');
  revalidatePath('/payments');
  return { success: true, data: updated as Vendor };
}

export async function toggleVendorActive(
  vendorId: string
): Promise<ActionResult<Vendor>> {
  const supabase = await createClient();
  const { user, profile, activeCompany } = await getCurrentUserContext();

  if (!user) {
    return { success: false, error: 'Unauthorized. Please sign in.' };
  }

  if (!profile || !profile.is_active) {
    return { success: false, error: 'Account is disabled or profile not found.' };
  }

  if (profile.role !== 'PREPARER' && !profile.is_admin) {
    return { success: false, error: 'Only an Accounts Preparer or Admin can change vendor status.' };
  }

  if (!activeCompany) {
    return { success: false, error: 'A company workspace must be active.' };
  }

  const { data: currentVendor } = await supabase
    .from('vendors')
    .select('id, name, party_name, is_active')
    .eq('id', vendorId)
    .eq('company_id', activeCompany.id)
    .single();

  if (!currentVendor) {
    return { success: false, error: 'Vendor record not found.' };
  }

  const newStatus = !currentVendor.is_active;

  const { data: updated, error } = await supabase
    .from('vendors')
    .update({
      is_active: newStatus,
      updated_at: new Date().toISOString(),
    })
    .eq('id', vendorId)
    .select()
    .single();

  if (error || !updated) {
    return { success: false, error: error?.message || 'Failed to update vendor status.' };
  }

  revalidatePath('/vendors');
  revalidatePath('/payments');
  return { success: true, data: updated as Vendor };
}
