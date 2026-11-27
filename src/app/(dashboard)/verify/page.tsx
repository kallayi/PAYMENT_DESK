import * as React from 'react';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getCurrentUserContext } from '@/lib/auth';
import { VerifierQueueView } from '@/components/verify/verifier-queue-view';
import { Loader2 } from 'lucide-react';
import type { PaymentItem, CompanyBank } from '@/types/database';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export const metadata = {
  title: 'Verification Queue | Payment Desk',
  description: 'Senior Accountant verification queue for submitted vendor payments.',
};

function VerifyLoadingSkeleton() {
  return (
    <div className="w-full flex flex-col items-center justify-center py-20 text-slate-400">
      <Loader2 className="w-6 h-6 animate-spin mb-2" />
      <span className="text-xs font-medium">Loading verification queue...</span>
    </div>
  );
}

export default async function VerifyPage() {
  const { user, profile, activeCompany } = await getCurrentUserContext();

  if (!user || !profile || !profile.is_active) {
    redirect('/login');
  }

  // Verifier, Approver, or Admin
  if (profile.role !== 'VERIFIER' && profile.role !== 'APPROVER' && !profile.is_admin) {
    redirect('/payments');
  }

  const supabase = await createClient();

  let paymentsQuery = supabase
    .from('payment_items')
    .select(
      '*, vendor:vendors(*), source_bank:company_banks(*), creator:profiles!created_by(id, full_name, role)'
    )
    .eq('status', 'PENDING_VERIFICATION')
    .order('due_date', { ascending: true });

  let banksQuery = supabase
    .from('company_banks')
    .select(
      'id, company_id, bank_name, full_name, short_code, short_name, account_number_masked, account_mask, available_balance, balance_updated_at, is_active, balance_updater:profiles!balance_updated_by(full_name)'
    )
    .eq('is_active', true)
    .order('short_code', { ascending: true });

  if (activeCompany) {
    paymentsQuery = paymentsQuery.eq('company_id', activeCompany.id);
    banksQuery = banksQuery.eq('company_id', activeCompany.id);
  }

  const [paymentsRes, banksRes] = await Promise.all([paymentsQuery, banksQuery]);

  if (paymentsRes.error) {
    console.error('Error fetching verification queue:', paymentsRes.error);
  }
  if (banksRes.error) {
    console.error('Error fetching company banks:', banksRes.error);
  }

  const canSeeFullDebitAc = profile.is_admin;
  const sanitizedPayments = ((paymentsRes.data || []) as PaymentItem[]).map((p) =>
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
    <React.Suspense fallback={<VerifyLoadingSkeleton />}>
      <VerifierQueueView
        initialPayments={sanitizedPayments}
        companyName={activeCompany?.name || 'INDFURN'}
        banks={(banksRes.data || []) as unknown as CompanyBank[]}
      />
    </React.Suspense>
  );
}
