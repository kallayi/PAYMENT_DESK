import * as React from 'react';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getCurrentUserContext } from '@/lib/auth';
import { PaymentsWorkspace } from '@/components/payments/payments-workspace';
import { Loader2 } from 'lucide-react';
import type { CompanyBank, PaymentItem, Vendor, RecurringReminder } from '@/types/database';

export const metadata = {
  title: 'Payments | Payment Desk',
  description: 'Manage payments ledger and submit for approval.',
};

function PaymentsLoadingSkeleton() {
  return (
    <div className="w-full flex flex-col items-center justify-center py-20 text-slate-400">
      <Loader2 className="w-6 h-6 animate-spin mb-2" />
      <span className="text-xs font-medium">Loading payments ledger...</span>
    </div>
  );
}

interface PaymentsPageProps {
  searchParams?: Promise<{ fromReminder?: string }>;
}

export default async function PaymentsPage({ searchParams }: PaymentsPageProps) {
  const { user, profile, activeCompany } = await getCurrentUserContext();

  if (!user) {
    redirect('/login');
  }

  if (!profile || !profile.is_active) {
    redirect('/login?error=disabled');
  }

  // Approvers without admin belong on /approvals
  if (profile.role === 'APPROVER' && !profile.is_admin) {
    redirect('/approvals');
  }

  if (profile.role !== 'PREPARER' && profile.role !== 'APPROVER' && !profile.is_admin) {
    redirect('/login');
  }

  const resolvedParams = searchParams ? await searchParams : {};
  const fromReminderId = resolvedParams.fromReminder;

  const supabase = await createClient();

  // Concurrently fetch active vendors, banks, and payment ledger in parallel
  let vendorsQuery = supabase
    .from('vendors')
    .select('*')
    .eq('is_active', true)
    .order('party_name', { ascending: true });

  let banksQuery = supabase
    .from('company_banks')
    .select('*, balance_updater:profiles!balance_updated_by(full_name)')
    .eq('is_active', true)
    .order('short_code', { ascending: true });

  let paymentsQuery = supabase
    .from('payment_items')
    .select(
      '*, vendor:vendors(*), source_bank:company_banks(*)'
    )
    .order('created_at', { ascending: false });

  if (activeCompany) {
    vendorsQuery = vendorsQuery.eq('company_id', activeCompany.id);
    banksQuery = banksQuery.eq('company_id', activeCompany.id);
    paymentsQuery = paymentsQuery.eq('company_id', activeCompany.id);
  }

  let reminderPromise: Promise<{ data: RecurringReminder | null }> = Promise.resolve({ data: null });
  if (fromReminderId && activeCompany) {
    reminderPromise = supabase
      .from('recurring_reminders')
      .select('id, title, estimated_amount, vendor_id')
      .eq('id', fromReminderId)
      .eq('company_id', activeCompany.id)
      .maybeSingle() as unknown as Promise<{ data: RecurringReminder | null }>;
  }

  const [vendorsRes, banksRes, paymentsRes, reminderRes] = await Promise.all([
    vendorsQuery,
    banksQuery,
    paymentsQuery,
    reminderPromise,
  ]);

  const vendors = (vendorsRes.data || []) as Vendor[];
  const banks = (banksRes.data || []) as CompanyBank[];
  const payments = (paymentsRes.data || []) as PaymentItem[];
  const initialReminder = reminderRes.data;

  return (
    <React.Suspense fallback={<PaymentsLoadingSkeleton />}>
      <PaymentsWorkspace
        initialPayments={payments}
        vendors={vendors}
        banks={banks}
        companyCode={activeCompany?.code || 'INDFURN'}
        initialFromReminder={
          initialReminder
            ? {
              id: initialReminder.id,
              title: initialReminder.title,
              estimated_amount: initialReminder.estimated_amount,
              vendor_id: initialReminder.vendor_id,
            }
            : null
        }
      />
    </React.Suspense>
  );
}
