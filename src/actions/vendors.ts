'use server';

import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { revalidatePath } from 'next/cache';
import {
  leanVendorSchema,
  vendorSchema,
  type LeanVendorInput,
  type VendorInput,
} from '@/lib/validators';
import { getCurrentUserContext } from '@/lib/auth';
import { getBankNameFromIfsc } from '@/lib/bank-names';
import type { ActionResult, Profile, Vendor } from '@/types/database';

function canManageVendors(profile: Profile | null): boolean {
  if (!profile || !profile.is_active) return false;
  return profile.role === 'PREPARER' || profile.role === 'VERIFIER' || profile.is_admin;
}

function maskAccountForAudit(accountNo: string | null | undefined): string {
  const clean = (accountNo || '').trim();
  if (!clean) return 'NA';
  if (clean.length <= 4) return `••••${clean}`;
  return `••••${clean.slice(-4)}`;
}

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

  // Mutations restricted to PREPARER, VERIFIER, or is_admin
  if (!canManageVendors(profile)) {
    return {
      success: false,
      error: 'Only an Accounts Preparer, Verifier, or Admin can add vendors.',
    };
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

  const beneficiaryName = (vendorData.beneficiary_name || '').trim();
  const accountNumber = (vendorData.account_number || vendorData.bank_account_no || '').trim();
  const ifscCode = (vendorData.ifsc_code || '').trim().toUpperCase();

  const strictParsed = leanVendorSchema.safeParse({
    party_name: partyName,
    beneficiary_name: beneficiaryName,
    account_number: accountNumber,
    ifsc_code: ifscCode,
    whatsapp_number: vendorData.whatsapp_number ?? null,
    remarks: vendorData.remarks ?? vendorData.notes ?? null,
  });

  if (!strictParsed.success) {
    return {
      success: false,
      error: strictParsed.error.issues[0]?.message || 'Complete vendor banking details are required.',
    };
  }

  // Resolve bank name via IFSC prefix to verify formatting before insert
  getBankNameFromIfsc(strictParsed.data.ifsc_code);

  const whatsappNumber = vendorData.whatsapp_number?.replace(/[\s-]/g, '').trim() || null;
  const remarks = vendorData.remarks?.trim() || vendorData.notes?.trim() || null;

  // Check for duplicate party_name within the active company
  const { data: existing } = await supabase
    .from('vendors')
    .select('id, party_name, name')
    .eq('company_id', companyId)
    .ilike('party_name', strictParsed.data.party_name)
    .maybeSingle();

  if (existing) {
    return {
      success: false,
      error: `A vendor with the trade name "${strictParsed.data.party_name}" already exists in ${activeCompany?.name || 'this company'}.`,
    };
  }

  const { data: created, error } = await supabase
    .from('vendors')
    .insert({
      company_id: companyId,
      party_name: strictParsed.data.party_name,
      beneficiary_name: strictParsed.data.beneficiary_name,
      account_number: strictParsed.data.account_number,
      ifsc_code: strictParsed.data.ifsc_code,
      whatsapp_number: whatsappNumber,
      remarks: remarks,
      // Backward compatibility columns
      name: strictParsed.data.party_name,
      bank_account_no: strictParsed.data.account_number,
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
  revalidatePath('/requests');
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

  // Mutations restricted to PREPARER, VERIFIER, or is_admin
  if (!canManageVendors(profile)) {
    return {
      success: false,
      error: 'Only an Accounts Preparer, Verifier, or Admin can edit vendors.',
    };
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

  // Fetch current vendor to verify ownership & inspect current banking details within activeCompany
  const { data: currentVendor } = await supabase
    .from('vendors')
    .select(
      'id, company_id, party_name, beneficiary_name, account_number, bank_account_no, ifsc_code'
    )
    .eq('id', vendorId)
    .eq('company_id', activeCompany.id)
    .single();

  if (!currentVendor) {
    return { success: false, error: 'Vendor record not found.' };
  }

  const partyName = (vendorData.party_name || vendorData.name || '').trim();
  const beneficiaryName = (vendorData.beneficiary_name || '').trim();
  const accountNumber = (vendorData.account_number || vendorData.bank_account_no || '').trim();
  const ifscCode = (vendorData.ifsc_code || '').trim().toUpperCase();

  const strictParsed = leanVendorSchema.safeParse({
    party_name: partyName,
    beneficiary_name: beneficiaryName,
    account_number: accountNumber,
    ifsc_code: ifscCode,
    whatsapp_number: vendorData.whatsapp_number ?? null,
    remarks: vendorData.remarks ?? vendorData.notes ?? null,
  });

  if (!strictParsed.success) {
    return {
      success: false,
      error:
        strictParsed.error.issues[0]?.message ||
        'Complete vendor banking details are required.',
    };
  }

  // Verify IFSC prefix resolves cleanly without fallback corruption
  getBankNameFromIfsc(strictParsed.data.ifsc_code);

  const validPartyName = strictParsed.data.party_name;
  const validBeneficiaryName = strictParsed.data.beneficiary_name;
  const validAccountNumber = strictParsed.data.account_number;
  const validIfscCode = strictParsed.data.ifsc_code;
  const whatsappNumber = vendorData.whatsapp_number?.replace(/[\s-]/g, '').trim() || null;
  const remarks = vendorData.remarks?.trim() || vendorData.notes?.trim() || null;

  const companyId = currentVendor.company_id || activeCompany?.id;

  // Detect changes to critical banking fields
  const prevBeneficiary = (currentVendor.beneficiary_name || '').trim();
  const prevAccount = (
    currentVendor.account_number ||
    currentVendor.bank_account_no ||
    ''
  ).trim();
  const prevIfsc = (currentVendor.ifsc_code || '').trim().toUpperCase();

  const beneficiaryChanged = validBeneficiaryName !== prevBeneficiary;
  const accountChanged = validAccountNumber !== prevAccount;
  const ifscChanged = validIfscCode !== prevIfsc;
  const criticalBankingChanged = beneficiaryChanged || accountChanged || ifscChanged;

  // Financial Fraud Guard: Block non-admin bank detail edits when vendor has APPROVED payments awaiting disbursement
  if (criticalBankingChanged) {
    const { count: approvedCount } = await supabase
      .from('payment_items')
      .select('id', { count: 'exact', head: true })
      .eq('company_id', activeCompany.id)
      .eq('vendor_id', vendorId)
      .eq('status', 'APPROVED');

    if ((approvedCount ?? 0) > 0 && !profile.is_admin) {
      return {
        success: false,
        error:
          'Cannot change vendor bank account or IFSC while this vendor has approved payment(s) awaiting disbursement. Complete or cancel approved payments first, or ask an Administrator.',
      };
    }
  }

  // Check for duplicate party_name in the same company excluding current vendor
  let dupQuery = supabase
    .from('vendors')
    .select('id, party_name')
    .ilike('party_name', validPartyName)
    .neq('id', vendorId);

  if (companyId) {
    dupQuery = dupQuery.eq('company_id', companyId);
  }

  const { data: duplicate } = await dupQuery.maybeSingle();

  if (duplicate) {
    return {
      success: false,
      error: `Another vendor named "${validPartyName}" already exists in this company.`,
    };
  }

  const { data: updated, error } = await supabase
    .from('vendors')
    .update({
      party_name: validPartyName,
      beneficiary_name: validBeneficiaryName,
      account_number: validAccountNumber,
      ifsc_code: validIfscCode,
      whatsapp_number: whatsappNumber,
      remarks: remarks,
      // Backward compatibility columns
      name: validPartyName,
      bank_account_no: validAccountNumber,
      notes: remarks,
      updated_at: new Date().toISOString(),
    })
    .eq('id', vendorId)
    .eq('company_id', activeCompany.id)
    .select()
    .single();

  if (error || !updated) {
    return { success: false, error: error?.message || 'Failed to update vendor record.' };
  }

  // Non-blocking audit log entry whenever critical banking fields are updated
  if (criticalBankingChanged) {
    try {
      const db = process.env.SUPABASE_SERVICE_ROLE_KEY ? createAdminClient() : supabase;
      await db.from('audit_logs').insert({
        table_name: 'vendors',
        record_id: vendorId,
        company_id: activeCompany.id,
        action: 'VENDOR_BANK_DETAILS_UPDATED',
        old_data: {
          party_name: currentVendor.party_name,
          beneficiary_name: prevBeneficiary,
          account_number_masked: maskAccountForAudit(prevAccount),
          ifsc_code: prevIfsc,
        },
        new_data: {
          party_name: validPartyName,
          beneficiary_name: validBeneficiaryName,
          account_number_masked: maskAccountForAudit(validAccountNumber),
          ifsc_code: validIfscCode,
        },
        changed_by: user.id,
      });
    } catch (auditErr) {
      console.warn('[Vendors] Non-blocking bank audit log insert error:', auditErr);
    }
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

  if (!canManageVendors(profile)) {
    return {
      success: false,
      error: 'Only an Accounts Preparer, Verifier, or Admin can change vendor status.',
    };
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

export async function bulkCreateVendors(
  rows: LeanVendorInput[]
): Promise<ActionResult<{ insertedCount: number; skippedDuplicates: number }>> {
  const supabase = await createClient();
  const { user, profile, activeCompany } = await getCurrentUserContext();

  if (!user) {
    return { success: false, error: 'Unauthorized. Please sign in.' };
  }

  if (!profile || !profile.is_active) {
    return { success: false, error: 'Account is disabled or profile not found.' };
  }

  if (!canManageVendors(profile)) {
    return {
      success: false,
      error: 'Only an Accounts Preparer, Verifier, or Admin can bulk import vendors.',
    };
  }

  if (!activeCompany) {
    return {
      success: false,
      error: 'A company workspace must be active to import vendors.',
    };
  }

  if (!Array.isArray(rows) || rows.length === 0) {
    return { success: false, error: 'No vendor rows provided for import.' };
  }

  if (rows.length > 500) {
    return {
      success: false,
      error: 'Maximum 500 vendors can be imported per batch.',
    };
  }

  // Validate every row server-side with leanVendorSchema
  const validatedRows: LeanVendorInput[] = [];
  for (let i = 0; i < rows.length; i += 1) {
    const parsed = leanVendorSchema.safeParse(rows[i]);
    if (!parsed.success) {
      return {
        success: false,
        error: `Row ${i + 1} invalid: ${parsed.error.issues[0]?.message || 'Validation failed'}`,
      };
    }
    validatedRows.push(parsed.data);
  }

  // Fetch existing party_name records within activeCompany for strict deduplication
  const { data: existingVendors, error: existingError } = await supabase
    .from('vendors')
    .select('party_name, name')
    .eq('company_id', activeCompany.id);

  if (existingError) {
    return {
      success: false,
      error: existingError.message || 'Failed to check existing company vendors.',
    };
  }

  const existingPartySet = new Set<string>(
    (existingVendors || [])
      .map((v) => (v.party_name || v.name || '').trim().toLowerCase())
      .filter(Boolean)
  );

  const seenBatch = new Set<string>();
  let skippedDuplicates = 0;

  const rowsToInsert: Array<{
    company_id: string;
    party_name: string;
    beneficiary_name: string;
    account_number: string;
    ifsc_code: string;
    remarks: string | null;
    name: string;
    bank_account_no: string;
    notes: string | null;
    is_active: boolean;
    created_by: string;
  }> = [];

  for (const r of validatedRows) {
    const partyName = r.party_name.trim();
    const key = partyName.toLowerCase();

    if (existingPartySet.has(key) || seenBatch.has(key)) {
      skippedDuplicates += 1;
      continue;
    }

    seenBatch.add(key);

    const beneficiaryName = (r.beneficiary_name || partyName).trim();
    const accountNumber = r.account_number.replace(/[\s-]+/g, '').trim();
    const ifscCode = r.ifsc_code.trim().toUpperCase();
    const remarks = r.remarks?.trim() || null;

    rowsToInsert.push({
      company_id: activeCompany.id,
      party_name: partyName,
      beneficiary_name: beneficiaryName,
      account_number: accountNumber,
      ifsc_code: ifscCode,
      remarks,
      // Backward compatibility columns
      name: partyName,
      bank_account_no: accountNumber,
      notes: remarks,
      is_active: true,
      created_by: user.id,
    });
  }

  if (rowsToInsert.length === 0) {
    return {
      success: true,
      data: { insertedCount: 0, skippedDuplicates },
    };
  }

  const { error: insertError } = await supabase
    .from('vendors')
    .insert(rowsToInsert);

  if (insertError) {
    return {
      success: false,
      error: insertError.message || 'Failed to bulk insert vendors.',
    };
  }

  revalidatePath('/vendors');
  revalidatePath('/payments');
  return {
    success: true,
    data: {
      insertedCount: rowsToInsert.length,
      skippedDuplicates,
    },
  };
}
