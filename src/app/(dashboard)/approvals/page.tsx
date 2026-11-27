import * as React from 'react';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getCurrentUserContext } from '@/lib/auth';
import { OwnerApprovalsView } from '@/components/payments/owner-approvals-view';
import { Loader2 } from 'lucide-react';
import type { CompanyBank, PaymentItem } from '@/types/database';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export const metadata = {
  title: 'Approvals | Payment Desk',
  description: 'Approver authorization portal for vendor payments and bank disbursements.',
};

function ApprovalsLoadingSkeleton() {
  return (
    <div className="w-full flex flex-col items-center justify-center py-20 text-slate-400">
      <Loader2 className="w-6 h-6 animate-spin mb-2" />
      <span className="text-xs font-medium">Loading approval queue...</span>
    </div>
  );
}

export default async function ApprovalsPage() {
  const { user, profile, activeCompany } = await getCurrentUserContext();

  if (!user) {
    redirect('/login');
  }

  if (!profile || !profile.is_active) {
    redirect('/login?error=disabled');
  }

  // Strict role check: Approver or Admin
  if (profile.role !== 'APPROVER' && !profile.is_admin) {
    redirect('/payments');
  }

  const supabase = await createClient();

  // Fetch company banks and relevant payment items concurrently
  let banksQuery = supabase
    .from('company_banks')
    .select('*, balance_updater:profiles!balance_updated_by(full_name)')
    .eq('is_active', true)
    .order('short_code', { ascending: true });

  let paymentsQuery = supabase
    .from('payment_items')
    .select(
      '*, vendor:vendors(*), source_bank:company_banks(*), creator:profiles!created_by(id, full_name)'
    )
    .in('status', ['PENDING_APPROVAL', 'ON_HOLD', 'PENDING_VERIFICATION', 'APPROVED'])
    .order('created_at', { ascending: false });

  if (activeCompany) {
    banksQuery = banksQuery.eq('company_id', activeCompany.id);
    paymentsQuery = paymentsQuery.eq('company_id', activeCompany.id);
  }

  const [banksRes, paymentsRes] = await Promise.all([banksQuery, paymentsQuery]);

  const canSeeFullDebitAc = profile.is_admin;
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
    <React.Suspense fallback={<ApprovalsLoadingSkeleton />}>
      <OwnerApprovalsView
        initialPayments={payments}
        banks={banks}
        companyName={activeCompany?.name || 'INDFURN'}
      />
    </React.Suspense>
  );
}
