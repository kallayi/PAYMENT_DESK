import * as React from 'react';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getCurrentUserContext } from '@/lib/auth';
import { RemindersView } from '@/components/reminders/reminders-view';
import { Loader2 } from 'lucide-react';
import type { RecurringReminder, Vendor } from '@/types/database';

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

  // Strictly Preparer or Admin
  if (profile.role !== 'PREPARER' && !profile.is_admin) {
    redirect('/approvals');
  }

  const supabase = await createClient();

  let remindersQuery = supabase
    .from('recurring_reminders')
    .select('*, vendor:vendors(id, name, party_name, beneficiary_name, account_number, ifsc_code)')
    .order('due_day_of_month', { ascending: true });

  let vendorsQuery = supabase
    .from('vendors')
    .select('*')
    .eq('is_active', true)
    .order('party_name', { ascending: true });

  if (activeCompany) {
    remindersQuery = remindersQuery.eq('company_id', activeCompany.id);
    vendorsQuery = vendorsQuery.eq('company_id', activeCompany.id);
  }

  const [remindersRes, vendorsRes] = await Promise.all([
    remindersQuery,
    vendorsQuery,
  ]);

  const reminders = (remindersRes.data || []) as RecurringReminder[];
  const vendors = (vendorsRes.data || []) as Vendor[];

  return (
    <React.Suspense fallback={<RemindersLoadingSkeleton />}>
      <RemindersView
        initialReminders={reminders}
        vendors={vendors}
        companyName={activeCompany?.name || 'INDFURN'}
      />
    </React.Suspense>
  );
}
