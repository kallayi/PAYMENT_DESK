'use server';

import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { revalidatePath } from 'next/cache';
import { recurringReminderSchema, type RecurringReminderInput } from '@/lib/validators';
import { getCurrentUserContext } from '@/lib/auth';
import { formatINR, getCurrentISTInfo } from '@/lib/format';
import { sendPushToUsers } from '@/lib/push';
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

/**
 * Automated due-day reminder dispatcher (IST Asia/Kolkata).
 * Safe for both Vercel Cron (all companies) and on-visit fallback (scoped to activeCompany.id).
 * Strictly sends alerts ONLY to active PREPARER and is_admin users in that company.
 * Uses an atomic last_notified_month claim so reminders never duplicate within the same month.
 */
export async function checkAndDispatchDueReminders(
  explicitCompanyId?: string
): Promise<{ checked: number; dispatched: number }> {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return { checked: 0, dispatched: 0 };
  }

  try {
    const admin = createAdminClient();
    const { yearMonth, day, daysInMonth } = getCurrentISTInfo();

    let query = admin
      .from('recurring_reminders')
      .select(
        'id, company_id, title, due_day_of_month, estimated_amount, last_completed_month, last_notified_month, vendor:vendors(party_name, name), company:companies(id, name, code)'
      )
      .eq('is_active', true)
      .or(`last_completed_month.is.null,last_completed_month.neq.${yearMonth}`)
      .or(`last_notified_month.is.null,last_notified_month.neq.${yearMonth}`);

    if (explicitCompanyId) {
      query = query.eq('company_id', explicitCompanyId);
    }

    const { data: candidates, error: fetchError } = await query;

    if (fetchError || !candidates || candidates.length === 0) {
      return { checked: 0, dispatched: 0 };
    }

    type CandidateRow = {
      id: string;
      company_id: string;
      title: string;
      due_day_of_month: number;
      estimated_amount: number | null;
      vendor?: { party_name?: string | null; name?: string | null } | null;
      company?: { id: string; name?: string | null; code?: string | null } | null;
    };

    const dueCandidates = (candidates as unknown as CandidateRow[]).filter((r) => {
      const effectiveDueDay = Math.min(Number(r.due_day_of_month) || 1, daysInMonth);
      return day >= effectiveDueDay;
    });

    if (dueCandidates.length === 0) {
      return { checked: candidates.length, dispatched: 0 };
    }

    // Group claimed reminders per company
    const claimedByCompany = new Map<string, CandidateRow[]>();
    const nowIso = new Date().toISOString();

    for (const reminder of dueCandidates) {
      // Atomic claim: prevents race conditions between cron & concurrent page visits
      const { data: claimedRows, error: claimError } = await admin
        .from('recurring_reminders')
        .update({
          last_notified_month: yearMonth,
          updated_at: nowIso,
        })
        .eq('id', reminder.id)
        .or(`last_notified_month.is.null,last_notified_month.neq.${yearMonth}`)
        .select('id');

      if (claimError || !claimedRows || claimedRows.length === 0) {
        continue;
      }

      const list = claimedByCompany.get(reminder.company_id) || [];
      list.push(reminder);
      claimedByCompany.set(reminder.company_id, list);
    }

    if (claimedByCompany.size === 0) {
      return { checked: candidates.length, dispatched: 0 };
    }

    // Fetch active Accounts (PREPARER) and Admin profiles once
    const { data: eligibleProfiles } = await admin
      .from('profiles')
      .select('id, role, is_admin')
      .eq('is_active', true)
      .or('role.eq.PREPARER,is_admin.eq.true');

    if (!eligibleProfiles || eligibleProfiles.length === 0) {
      return { checked: candidates.length, dispatched: 0 };
    }

    const companyIds = Array.from(claimedByCompany.keys());
    const { data: accessRows } = await admin
      .from('user_company_access')
      .select('user_id, company_id')
      .in('company_id', companyIds);

    const accessByCompany = new Map<string, Set<string>>();
    for (const row of accessRows || []) {
      const set = accessByCompany.get(row.company_id) || new Set<string>();
      set.add(row.user_id);
      accessByCompany.set(row.company_id, set);
    }

    let dispatchedCount = 0;

    for (const [companyId, companyReminders] of claimedByCompany.entries()) {
      const companyAccess = accessByCompany.get(companyId) || new Set<string>();

      // Strict privacy: ONLY active PREPARERs with company access or Admins
      const recipientIds = eligibleProfiles
        .filter((p) => p.is_admin || (p.role === 'PREPARER' && companyAccess.has(p.id)))
        .map((p) => p.id);

      if (recipientIds.length === 0) continue;

      for (const r of companyReminders) {
        const companyCode = r.company?.code || r.company?.name || 'Accounts';
        const vendorName = r.vendor?.party_name || r.vendor?.name || '';
        const estText =
          r.estimated_amount && Number(r.estimated_amount) > 0
            ? `Est. ${formatINR(r.estimated_amount)} • `
            : '';

        const title = `[${companyCode}] Due Reminder: ${r.title}`;
        const body = `${vendorName ? `${vendorName} • ` : ''}${estText}Due ${r.due_day_of_month}th. Open Monthly Reminders to create entry.`;

        const notificationRows = recipientIds.map((uid) => ({
          company_id: companyId,
          recipient_user_id: uid,
          payment_item_id: null,
          event_type: 'REMINDER_DUE' as const,
          title,
          body,
          is_read: false,
        }));

        const { error: insertError } = await admin
          .from('notifications')
          .insert(notificationRows);

        if (!insertError) {
          dispatchedCount += 1;
          void sendPushToUsers(recipientIds, {
            title,
            body,
            url: '/reminders',
          });
        }
      }
    }

    return { checked: candidates.length, dispatched: dispatchedCount };
  } catch (err) {
    console.warn('[Reminders] Failed to check/dispatch due reminders:', err);
    return { checked: 0, dispatched: 0 };
  }
}
