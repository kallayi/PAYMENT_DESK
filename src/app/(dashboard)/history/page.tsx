import * as React from 'react';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getCurrentUserContext } from '@/lib/auth';
import { HistoryView } from '@/components/history/history-view';
import { Loader2 } from 'lucide-react';
import type { CompanyBank, PaymentItem } from '@/types/database';

export const metadata = {
  title: 'History & Archive | Payment Desk',
  description: 'Search past approvals, verified UTR/Cheque references, audit status, and export PDF/CSV.',
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
  const { user, profile, activeCompany } = await getCurrentUserContext();

  if (!user) {
    redirect('/login');
  }

  if (!profile || !profile.is_active) {
    redirect('/login?error=disabled');
  }

  const supabase = await createClient();

  let banksQuery = supabase
    .from('company_banks')
    .select('*')
    .eq('is_active', true)
    .order('short_code', { ascending: true });

  let paymentsQuery = supabase
    .from('payment_items')
    .select(
      '*, vendor:vendors(*), source_bank:company_banks(*), creator:profiles!created_by(id, full_name, role), verifier:profiles!verified_by(id, full_name, role), approver:profiles!approved_by(id, full_name, role), payer:profiles!paid_by(id, full_name, role), auditor:profiles!audited_by(id, full_name, role)'
    )
    .order('sheet_date', { ascending: false })
    .order('created_at', { ascending: false });

  if (activeCompany) {
    banksQuery = banksQuery.eq('company_id', activeCompany.id);
    paymentsQuery = paymentsQuery.eq('company_id', activeCompany.id);
  }

  const [banksRes, paymentsRes] = await Promise.all([banksQuery, paymentsQuery]);

  const canSeeFullDebitAc = profile.role === 'PREPARER' || profile.is_admin;
  const banks = ((banksRes.data || []) as CompanyBank[]).map((b) =>
    canSeeFullDebitAc ? b : { ...b, full_debit_account_number: null }
  );
  const payments = ((paymentsRes.data || []) as PaymentItem[]).map((p) =>
    canSeeFullDebitAc || !p.source_bank
      ? p
      : {
        ...p,
        source_bank: {
          ...p.source_bank,
          full_debit_account_number: null,
        },
      }
  );

  return (
    <React.Suspense fallback={<HistoryLoadingSkeleton />}>
      <HistoryView
        initialPayments={payments}
        banks={banks}
        companyCode={activeCompany?.code || 'INDFURN'}
        companyName={activeCompany?.name || 'INDFURN'}
        activeCompany={activeCompany}
        currentUserName={profile.full_name || 'Accounts Team'}
      />
    </React.Suspense>
  );
}
