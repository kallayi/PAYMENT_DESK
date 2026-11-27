import * as React from 'react';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getCurrentUserContext } from '@/lib/auth';
import { checkAndDispatchDueReminders } from '@/lib/reminders-server';
import { getCurrentISTInfo } from '@/lib/format';
import { RemindersView } from '@/components/reminders/reminders-view';
import { Loader2 } from 'lucide-react';
import type { RecurringReminder, ReminderLinkedPayment, Vendor } from '@/types/database';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export const metadata = {
  title: 'Monthly Reminders | Payment Desk',
  description: 'Accounts monthly recurring dues and obligations checklist.',
};

function RemindersLoadingSkeleton() {
  return (
    <div className="w-full flex flex-col items-center justify-center py-20 text-slate-400">
      <Loader2 className="w-6 h-6 animate-spin mb-2" />
      <span className="text-xs font-medium">Loading monthly reminders...</span>
    </div>
  );
}

export default async function RemindersPage() {
  const { user, profile, activeCompany } = await getCurrentUserContext();

  if (!user || !profile || !profile.is_active) {
    redirect('/login');
  }

  // Preparer, Verifier, or Admin
  if (profile.role !== 'PREPARER' && profile.role !== 'VERIFIER' && !profile.is_admin) {
    redirect('/approvals');
  }

  const supabase = await createClient();
  const { yearMonth, monthLabel, monthStartIso, nextMonthStartIso } = getCurrentISTInfo();

  // On-visit non-blocking check ensures due-day alerts fire immediately if morning cron hasn't run yet
  if (activeCompany) {
    void checkAndDispatchDueReminders(activeCompany.id).catch(() => { });
  }

  let remindersQuery = supabase
    .from('recurring_reminders')
    .select('*, vendor:vendors(id, name, party_name, beneficiary_name, account_number, ifsc_code)')
    .order('due_day_of_month', { ascending: true });

  let vendorsQuery = supabase
    .from('vendors')
    .select('*')
    .eq('is_active', true)
    .order('party_name', { ascending: true });

  let linkedPaymentsQuery = supabase
    .from('payment_items')
    .select(
      'id, recurring_reminder_id, status, net_payable, utr_number, cheque_number, paid_at, rejection_reason, updated_at'
    )
    .not('recurring_reminder_id', 'is', null)
    .gte('created_at', monthStartIso)
    .lt('created_at', nextMonthStartIso)
    .order('created_at', { ascending: false });

  if (activeCompany) {
    remindersQuery = remindersQuery.eq('company_id', activeCompany.id);
    vendorsQuery = vendorsQuery.eq('company_id', activeCompany.id);
    linkedPaymentsQuery = linkedPaymentsQuery.eq('company_id', activeCompany.id);
  }

  const [remindersRes, vendorsRes, linkedPaymentsRes] = await Promise.all([
    remindersQuery,
    vendorsQuery,
    linkedPaymentsQuery,
  ]);

  const reminders = (remindersRes.data || []) as RecurringReminder[];
  const vendors = (vendorsRes.data || []) as Vendor[];

  const linkedPaymentsByReminder: Record<string, ReminderLinkedPayment> = {};
  for (const row of (linkedPaymentsRes.data || []) as ReminderLinkedPayment[]) {
    const rid = row.recurring_reminder_id;
    if (!rid) continue;
    const existing = linkedPaymentsByReminder[rid];
    if (!existing) {
      linkedPaymentsByReminder[rid] = row;
    } else {
      const existingInactive =
        existing.status === 'REJECTED' || existing.status === 'CANCELLED';
      const rowActive = row.status !== 'REJECTED' && row.status !== 'CANCELLED';
      if (existingInactive && rowActive) {
        linkedPaymentsByReminder[rid] = row;
      }
    }
  }

  return (
    <React.Suspense fallback={<RemindersLoadingSkeleton />}>
      <RemindersView
        initialReminders={reminders}
        vendors={vendors}
        companyName={activeCompany?.name || 'INDFURN'}
        linkedPaymentsByReminder={linkedPaymentsByReminder}
        currentMonthKey={yearMonth}
        currentMonthLabel={monthLabel}
        canCreatePayment={profile.role === 'PREPARER' || profile.is_admin}
      />
    </React.Suspense>
  );
}
