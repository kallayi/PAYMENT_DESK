'use server';

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { getCurrentUserContext } from '@/lib/auth';
import { companyProfileSchema, type CompanyProfileInput } from '@/lib/validators';
import type { ActionResult, Company } from '@/types/database';

/**
 * Switch active company workspace between INDFURN and VINMORE.
 * Validates that the active user actually has access to the requested company,
 * sets the HTTP-only pd_active_company cookie, and revalidates layout data.
 */
export async function switchActiveCompany(
  companyIdOrCode: string
): Promise<ActionResult<Company>> {
  if (!companyIdOrCode || !companyIdOrCode.trim()) {
    return { success: false, error: 'Target company ID or code is required.' };
  }

  const { user, profile, allowedCompanies } = await getCurrentUserContext();

  if (!user || !profile || !profile.is_active) {
    return { success: false, error: 'Unauthorized or account disabled.' };
  }

  const normalizedTarget = companyIdOrCode.trim();
  const targetCompany = allowedCompanies.find(
    (c) =>
      c.id === normalizedTarget ||
      c.code.toUpperCase() === normalizedTarget.toUpperCase()
  );

  if (!targetCompany) {
    return { success: false, error: 'You do not have access to this company workspace.' };
  }

  const cookieStore = await cookies();
  cookieStore.set('pd_active_company', targetCompany.code, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 365, // 1 year persistence
  });

  revalidatePath('/', 'layout');
  return { success: true, data: targetCompany };
}

/**
 * Admin-only update of company display/signature name and slip contact details.
 * Never modifies `companies.code` (`INDFURN` / `VINMORE`) to preserve logo/workspace isolation.
 */
export async function updateCompanyProfile(
  input: CompanyProfileInput
): Promise<ActionResult<Company>> {
  const { user, profile } = await getCurrentUserContext();

  if (!user || !profile || !profile.is_active) {
    return { success: false, error: 'Unauthorized. Please sign in.' };
  }

  if (!profile.is_admin) {
    return { success: false, error: 'Only an Administrator can update company profile details.' };
  }

  const parsed = companyProfileSchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues[0]?.message || 'Invalid company profile details.',
    };
  }

  const { companyId, name, contact_email, contact_phone } = parsed.data;
  const supabase = await createClient();

  const { data: updated, error } = await supabase
    .from('companies')
    .update({
      name: name.trim(),
      contact_email: contact_email.trim() || null,
      contact_phone: contact_phone.trim() || null,
    })
    .eq('id', companyId)
    .select('id, code, name, contact_email, contact_phone, is_active, created_at')
    .single();

  if (error || !updated) {
    return {
      success: false,
      error: error?.message || 'Failed to update company profile details.',
    };
  }

  revalidatePath('/', 'layout');
  revalidatePath('/settings');
  revalidatePath('/history');
  revalidatePath('/payments');
  revalidatePath('/print');

  return { success: true, data: updated as Company };
}
