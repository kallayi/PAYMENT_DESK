import * as React from 'react';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getCurrentUserAndProfile } from '@/lib/auth';
import { HistoryView } from '@/components/history/history-view';
import { Loader2 } from 'lucide-react';
import type { CompanyBank, PaymentItem } from '@/types/database';

export const metadata = {
  title: 'History & UTR Audit | INDFURN PayFlow',
  description: 'Search past approvals, verified UTR references, and export audit sheets.',
};

function HistoryLoadingSkeleton() {
  return (
    <div className="w-full flex flex-col items-center justify-center py-20 text-slate-400">
      <Loader2 className="w-6 h-6 animate-spin mb-2" />
      <span className="text-xs font-medium">Loading history and transactions ledger...</span>
    </div>
  );
}

export default async function HistoryPage() {
  const { user, profile } = await getCurrentUserAndProfile();

  if (!user) {
    redirect('/login');
  }

  if (!profile || !profile.is_active) {
    redirect('/login?error=disabled');
  }

  // Strict role check: Only Owner and Accountant can access history
  if (profile.role !== 'OWNER' && profile.role !== 'ACCOUNTANT') {
    redirect('/login');
  }

  const supabase = await createClient();

  // Concurrently fetch active banks and all payment items in parallel
  const [banksRes, paymentsRes] = await Promise.all([
    supabase
      .from('company_banks')
      .select('id, short_name, full_name, account_mask, is_active, created_at')
      .eq('is_active', true)
      .order('short_name', { ascending: true }),
    supabase
      .from('payment_items')
      .select(
        '*, vendor:vendors(id, name, gstin, bank_account_no, ifsc_code), source_bank:company_banks(id, short_name, full_name)'
      )
      .order('sheet_date', { ascending: false })
      .order('created_at', { ascending: false }),
  ]);

  const banks = (banksRes.data || []) as CompanyBank[];
  const payments = (paymentsRes.data || []) as PaymentItem[];

  return (
    <React.Suspense fallback={<HistoryLoadingSkeleton />}>
      <HistoryView
        initialPayments={payments}
        banks={banks}
        currentRole={profile.role}
      />
    </React.Suspense>
  );
}
