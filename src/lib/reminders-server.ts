import { createAdminClient } from '@/lib/supabase/admin';
import { formatINR, getCurrentISTInfo } from '@/lib/format';
import { sendPushToUsers } from '@/lib/push';

/**
 * Automated due-day reminder dispatcher (IST Asia/Kolkata).
 * Server-only helper (NEVER exported as a public Server Action).
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

    const claimedByCompany = new Map<string, CandidateRow[]>();
    const nowIso = new Date().toISOString();

    for (const reminder of dueCandidates) {
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
