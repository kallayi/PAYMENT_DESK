'use server';

import { createClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';
import { recurringReminderSchema, type RecurringReminderInput } from '@/lib/validators';
import { getCurrentUserContext } from '@/lib/auth';
import type { ActionResult, Profile, RecurringReminder } from '@/types/database';

function canManageReminders(profile: Profile | null): boolean {
  if (!profile || !profile.is_active) return false;
  return profile.role === 'PREPARER' || profile.role === 'VERIFIER' || profile.is_admin;
}

export async function getReminders(
  explicitCompanyId?: string
): Promise<ActionResult<RecurringReminder[]>> {
  const supabase = await createClient();
  const { user, profile, activeCompany } = await getCurrentUserContext();

  if (!user || !profile || !profile.is_active) {
    return { success: false, error: 'Unauthorized. Please sign in.' };
  }

  // Preparer, Verifier, or Admin
  if (!canManageReminders(profile)) {
    return {
      success: false,
      error: 'Access denied: Monthly reminders are for Preparers and Verifiers only.',
    };
  }

  const companyId = explicitCompanyId || activeCompany?.id;
  if (!companyId) {
    return { success: false, error: 'A company workspace must be active.' };
  }

  const { data, error } = await supabase
    .from('recurring_reminders')
    .select('*, vendor:vendors(id, name, party_name, beneficiary_name, account_number, ifsc_code)')
    .eq('company_id', companyId)
    .order('due_day_of_month', { ascending: true });

  if (error) {
    return { success: false, error: error.message || 'Failed to fetch monthly reminders.' };
  }

  return { success: true, data: (data || []) as RecurringReminder[] };
}

export async function createReminder(
  input: RecurringReminderInput
): Promise<ActionResult<RecurringReminder>> {
  const supabase = await createClient();
  const { user, profile, activeCompany } = await getCurrentUserContext();

  if (!user || !profile || !profile.is_active) {
    return { success: false, error: 'Unauthorized. Please sign in.' };
  }

  if (!canManageReminders(profile)) {
    return {
      success: false,
      error: 'Access denied: Only Preparers or Verifiers can add recurring reminders.',
    };
  }

  const parsed = recurringReminderSchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues[0]?.message || 'Invalid reminder data.',
    };
  }

  if (!activeCompany) {
    return { success: false, error: 'A company workspace must be active.' };
  }
  const companyId = activeCompany.id;

  const { data, error } = await supabase
    .from('recurring_reminders')
    .insert({
      company_id: companyId,
      title: parsed.data.title.trim(),
      due_day_of_month: parsed.data.due_day_of_month,
      estimated_amount: parsed.data.estimated_amount ?? null,
      vendor_id: parsed.data.vendor_id || null,
      remarks: parsed.data.remarks?.trim() || null,
      is_active: parsed.data.is_active ?? true,
      created_by: user.id,
    })
    .select('*, vendor:vendors(id, name, party_name, beneficiary_name, account_number, ifsc_code)')
    .single();

  if (error || !data) {
    return { success: false, error: error?.message || 'Failed to create reminder.' };
  }

  revalidatePath('/reminders');
  return { success: true, data: data as RecurringReminder };
}

export async function updateReminder(
  id: string,
  input: RecurringReminderInput
): Promise<ActionResult<RecurringReminder>> {
  const supabase = await createClient();
  const { user, profile, activeCompany } = await getCurrentUserContext();

  if (!user || !profile || !profile.is_active) {
    return { success: false, error: 'Unauthorized. Please sign in.' };
  }

  if (!canManageReminders(profile)) {
    return {
      success: false,
      error: 'Access denied: Only Preparers or Verifiers can update reminders.',
    };
  }

  const parsed = recurringReminderSchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues[0]?.message || 'Invalid reminder data.',
    };
  }

  if (!activeCompany) {
    return { success: false, error: 'A company workspace must be active.' };
  }
  const companyId = activeCompany.id;

  let query = supabase
    .from('recurring_reminders')
    .update({
      title: parsed.data.title.trim(),
      due_day_of_month: parsed.data.due_day_of_month,
      estimated_amount: parsed.data.estimated_amount ?? null,
      vendor_id: parsed.data.vendor_id || null,
      remarks: parsed.data.remarks?.trim() || null,
      is_active: parsed.data.is_active ?? true,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id);

  if (companyId) {
    query = query.eq('company_id', companyId);
  }

  const { data, error } = await query
    .select('*, vendor:vendors(id, name, party_name, beneficiary_name, account_number, ifsc_code)')
    .single();

  if (error || !data) {
    return { success: false, error: error?.message || 'Failed to update reminder.' };
  }

  revalidatePath('/reminders');
  return { success: true, data: data as RecurringReminder };
}

export async function deleteReminder(
  id: string
): Promise<ActionResult<undefined>> {
  const supabase = await createClient();
  const { user, profile, activeCompany } = await getCurrentUserContext();

  if (!user || !profile || !profile.is_active) {
    return { success: false, error: 'Unauthorized. Please sign in.' };
  }

  if (!canManageReminders(profile)) {
    return {
      success: false,
      error: 'Access denied: Only Preparers or Verifiers can delete reminders.',
    };
  }

  let query = supabase.from('recurring_reminders').delete().eq('id', id);
  if (activeCompany) {
    query = query.eq('company_id', activeCompany.id);
  }

  const { error } = await query;
  if (error) {
    return { success: false, error: error.message || 'Failed to delete reminder.' };
  }

  revalidatePath('/reminders');
  return { success: true, data: undefined };
}

export async function toggleReminderMonthDone(
  id: string,
  targetMonth: string // e.g. '2026-11'
): Promise<ActionResult<RecurringReminder>> {
  const supabase = await createClient();
  const { user, profile, activeCompany } = await getCurrentUserContext();

  if (!user || !profile || !profile.is_active) {
    return { success: false, error: 'Unauthorized. Please sign in.' };
  }

  if (!canManageReminders(profile)) {
    return {
      success: false,
      error: 'Access denied: Only Preparers or Verifiers can update reminder status.',
    };
  }

  let fetchQuery = supabase.from('recurring_reminders').select('*').eq('id', id);
  if (activeCompany) {
    fetchQuery = fetchQuery.eq('company_id', activeCompany.id);
  }
  const { data: current, error: fetchError } = await fetchQuery.single();

  if (fetchError || !current) {
    return { success: false, error: 'Reminder not found.' };
  }

  // Toggle: if already completed for this month, reset to null; otherwise set to targetMonth
  const nextCompletedMonth = current.last_completed_month === targetMonth ? null : targetMonth;

  const { data: updated, error: updateError } = await supabase
    .from('recurring_reminders')
    .update({
      last_completed_month: nextCompletedMonth,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .select('*, vendor:vendors(id, name, party_name, beneficiary_name, account_number, ifsc_code)')
    .single();

  if (updateError || !updated) {
    return { success: false, error: updateError?.message || 'Failed to update reminder status.' };
  }

  revalidatePath('/reminders');
  return { success: true, data: updated as RecurringReminder };
}
