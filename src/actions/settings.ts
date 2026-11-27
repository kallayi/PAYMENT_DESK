'use server';

import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { getCurrentUserContext } from '@/lib/auth';
import { createAdminClient } from '@/lib/supabase/admin';
import type { ActionResult } from '@/types/database';

const deleteBankSchema = z.object({
  bankId: z.string().uuid('Valid bank ID is required.'),
  adminPassword: z.string().refine((v) => v.trim().length > 0, 'Admin password is required.'),
});

const deleteUserSchema = z.object({
  targetUserId: z.string().uuid('Valid user ID is required.'),
  adminPassword: z.string().refine((v) => v.trim().length > 0, 'Admin password is required.'),
});

/**
 * Verifies the active Admin's password using a non-persistent Supabase client
 * so the Admin's SSR session cookies are never modified or disrupted.
 */
async function verifyAdminPassword(adminEmail: string, password: string): Promise<boolean> {
  if (!adminEmail || !password || !password.trim()) {
    return false;
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseAnonKey) {
    return false;
  }

  const tempClient = createSupabaseClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  const { data, error } = await tempClient.auth.signInWithPassword({
    email: adminEmail,
    password,
  });

  return Boolean(
    !error &&
      data.user?.email &&
      data.user.email.toLowerCase() === adminEmail.toLowerCase()
  );
}

/**
 * Admin-only, password-verified permanent deletion of a company bank.
 * Blocks deletion if any payment records reference this bank.
 */
export async function deleteCompanyBank(input: {
  bankId: string;
  adminPassword: string;
}): Promise<ActionResult<undefined>> {
  const { user, profile } = await getCurrentUserContext();

  if (!user || !user.email || !profile || !profile.is_active || !profile.is_admin) {
    return { success: false, error: 'Only an active Administrator can delete company banks.' };
  }

  const parsed = deleteBankSchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues[0]?.message || 'Invalid delete request.',
    };
  }

  const { bankId, adminPassword } = parsed.data;

  const isPasswordValid = await verifyAdminPassword(user.email, adminPassword);
  if (!isPasswordValid) {
    return { success: false, error: 'Incorrect admin password. Deletion cancelled.' };
  }

  const admin = createAdminClient();

  const { data: bank, error: bankFetchError } = await admin
    .from('company_banks')
    .select('id, bank_name, full_name')
    .eq('id', bankId)
    .maybeSingle();

  if (bankFetchError || !bank) {
    return { success: false, error: 'Company bank record not found.' };
  }

  // Financial History Guard: block if referenced by any payment_items
  const { count: linkedCount, error: countError } = await admin
    .from('payment_items')
    .select('id', { count: 'exact', head: true })
    .eq('source_bank_id', bankId);

  if (countError) {
    return {
      success: false,
      error: countError.message || 'Failed to verify bank payment references.',
    };
  }

  if ((linkedCount ?? 0) > 0) {
    return {
      success: false,
      error: `Cannot permanently delete this bank because it is linked to ${linkedCount} payment record(s) in history. Please Disable it instead to preserve audit records.`,
    };
  }

  const { error: deleteError } = await admin
    .from('company_banks')
    .delete()
    .eq('id', bankId);

  if (deleteError) {
    return {
      success: false,
      error: deleteError.message || 'Failed to permanently delete company bank.',
    };
  }

  revalidatePath('/settings');
  revalidatePath('/payments');
  revalidatePath('/approvals');
  revalidatePath('/verify');
  revalidatePath('/history');

  return { success: true, data: undefined };
}

/**
 * Admin-only, password-verified permanent deletion of a staff user.
 * Blocks self-deletion, last-admin deletion, and deletion of any user referenced
 * in payment_items or audit_logs.
 */
export async function deleteStaffUser(input: {
  targetUserId: string;
  adminPassword: string;
}): Promise<ActionResult<undefined>> {
  const { user, profile } = await getCurrentUserContext();

  if (!user || !user.email || !profile || !profile.is_active || !profile.is_admin) {
    return { success: false, error: 'Only an active Administrator can delete user accounts.' };
  }

  const parsed = deleteUserSchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues[0]?.message || 'Invalid delete request.',
    };
  }

  const { targetUserId, adminPassword } = parsed.data;

  const isPasswordValid = await verifyAdminPassword(user.email, adminPassword);
  if (!isPasswordValid) {
    return { success: false, error: 'Incorrect admin password. Deletion cancelled.' };
  }

  // Self-Delete Guard
  if (targetUserId === user.id) {
    return { success: false, error: 'You cannot delete your own active Admin account.' };
  }

  const admin = createAdminClient();

  const { data: targetProfile, error: targetError } = await admin
    .from('profiles')
    .select('id, full_name, is_admin, is_active')
    .eq('id', targetUserId)
    .maybeSingle();

  if (targetError || !targetProfile) {
    return { success: false, error: 'Target user record not found.' };
  }

  // Last-Admin Guard
  if (targetProfile.is_admin) {
    const { count: otherAdminsCount, error: adminCountError } = await admin
      .from('profiles')
      .select('id', { count: 'exact', head: true })
      .eq('is_admin', true)
      .eq('is_active', true)
      .neq('id', targetUserId);

    if (adminCountError) {
      return { success: false, error: 'Failed to verify remaining administrator accounts.' };
    }

    if ((otherAdminsCount ?? 0) < 1) {
      return {
        success: false,
        error: 'Cannot delete the last remaining active Administrator account.',
      };
    }
  }

  // Financial & Audit History Guard
  const [paymentsRefRes, auditRefRes] = await Promise.all([
    admin
      .from('payment_items')
      .select('id', { count: 'exact', head: true })
      .or(
        `created_by.eq.${targetUserId},verified_by.eq.${targetUserId},approved_by.eq.${targetUserId},paid_by.eq.${targetUserId},audited_by.eq.${targetUserId}`
      ),
    admin
      .from('audit_logs')
      .select('id', { count: 'exact', head: true })
      .eq('changed_by', targetUserId),
  ]);

  if (paymentsRefRes.error || auditRefRes.error) {
    return {
      success: false,
      error: 'Failed to verify user financial and audit references.',
    };
  }

  const linkedCount = (paymentsRefRes.count ?? 0) + (auditRefRes.count ?? 0);
  if (linkedCount > 0) {
    return {
      success: false,
      error: `Cannot permanently delete this user because they have ${linkedCount} linked payment/audit record(s). Please Disable the account instead to preserve the audit trail.`,
    };
  }

  // Clean up non-financial references so profile & auth deletion succeed cleanly
  await Promise.all([
    admin.from('user_company_access').delete().eq('user_id', targetUserId),
    admin.from('push_subscriptions').delete().eq('user_id', targetUserId),
    admin.from('notifications').delete().eq('recipient_user_id', targetUserId),
    admin
      .from('company_banks')
      .update({ balance_updated_by: null })
      .eq('balance_updated_by', targetUserId),
    admin.from('vendors').update({ created_by: null }).eq('created_by', targetUserId),
    admin
      .from('recurring_reminders')
      .update({ created_by: null })
      .eq('created_by', targetUserId),
    admin.from('payment_purposes').update({ created_by: null }).eq('created_by', targetUserId),
  ]);

  const { error: profileDeleteError } = await admin
    .from('profiles')
    .delete()
    .eq('id', targetUserId);

  if (profileDeleteError) {
    return {
      success: false,
      error: profileDeleteError.message || 'Failed to delete user profile.',
    };
  }

  const { error: authDeleteError } = await admin.auth.admin.deleteUser(targetUserId);
  if (authDeleteError) {
    return {
      success: false,
      error: authDeleteError.message || 'Profile deleted, but failed to remove auth account.',
    };
  }

  revalidatePath('/settings');
  return { success: true, data: undefined };
}
