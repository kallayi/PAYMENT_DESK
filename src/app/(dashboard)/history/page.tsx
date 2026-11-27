import * as React from 'react';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getCurrentUserContext } from '@/lib/auth';
import { HistoryView } from '@/components/history/history-view';
import { Loader2 } from 'lucide-react';
import type { CompanyBank, PaymentItem, Vendor } from '@/types/database';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export const metadata = {
  title: 'Payment History & Ledger | Payment Desk',
  description:
    'Monthly settled payments ledger, UTR/Cheque audit archive, Payment Advice slips, and CSV/A4 PDF exports.',
};

function HistoryLoadingSkeleton() {
  return (
    <div className="w-full flex flex-col items-center justify-center py-20 text-slate-400">
      <Loader2 className="w-6 h-6 animate-spin mb-2" />
      <span className="text-xs font-medium">Loading monthly payment history ledger...</span>
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

  let vendorsQuery = supabase
    .from('vendors')
    .select('*')
    .eq('is_active', true)
    .order('party_name', { ascending: true });

  // Strictly archived/completed records ONLY (never include in-flight workflow statuses)
  let paymentsQuery = supabase
    .from('payment_items')
    .select(
      '*, vendor:vendors(*), source_bank:company_banks(*), batch:payment_batches(*), creator:profiles!created_by(id, full_name, role), verifier:profiles!verified_by(id, full_name, role), approver:profiles!approved_by(id, full_name, role), payer:profiles!paid_by(id, full_name, role), auditor:profiles!audited_by(id, full_name, role)'
    )
    .in('status', ['PAID', 'REJECTED'])
    .order('paid_at', { ascending: false, nullsFirst: false })
    .order('updated_at', { ascending: false });

  if (activeCompany) {
    banksQuery = banksQuery.eq('company_id', activeCompany.id);
    vendorsQuery = vendorsQuery.eq('company_id', activeCompany.id);
    paymentsQuery = paymentsQuery.eq('company_id', activeCompany.id);
  }

  const [banksRes, vendorsRes, paymentsRes] = await Promise.all([
    banksQuery,
    vendorsQuery,
    paymentsQuery,
  ]);

  const canSeeFullDebitAc = profile.role === 'PREPARER' || profile.is_admin;
  const banks = ((banksRes.data || []) as CompanyBank[]).map((b) =>
    canSeeFullDebitAc ? b : { ...b, full_debit_account_number: null }
  );
  const vendors = (vendorsRes.data || []) as Vendor[];
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

  const canMarkReceiptSent =
    profile.is_admin ||
    profile.role === 'PREPARER' ||
    profile.role === 'VERIFIER' ||
    profile.role === 'APPROVER';
  const canUndoReceiptSent = profile.is_admin || profile.role === 'PREPARER';

  return (
    <React.Suspense fallback={<HistoryLoadingSkeleton />}>
      <HistoryView
        initialPayments={payments}
        vendors={vendors}
        banks={banks}
        companyCode={activeCompany?.code || 'INDFURN'}
        companyName={activeCompany?.name || 'INDFURN'}
        activeCompany={activeCompany}
        currentUserName={profile.full_name || 'Accounts Team'}
        canMarkReceiptSent={canMarkReceiptSent}
        canUndoReceiptSent={canUndoReceiptSent}
      />
    </React.Suspense>
  );
}
