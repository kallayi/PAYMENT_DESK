'use server';

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { getCurrentUserContext } from '@/lib/auth';
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
