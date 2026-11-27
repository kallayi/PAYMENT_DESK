import * as React from 'react';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getCurrentUserContext } from '@/lib/auth';
import { AuditorWorkspace } from '@/components/audit/auditor-workspace';
import { Loader2 } from 'lucide-react';
import type { CompanyBank, PaymentBatch, PaymentItem } from '@/types/database';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export const metadata = {
  title: 'Audit Workspace | Payment Desk',
  description: 'Read-only side-by-side payment voucher and bank acknowledgement audit portal.',
};

function AuditLoadingSkeleton() {
  return (
    <div className="w-full flex flex-col items-center justify-center py-20 text-slate-400">
      <Loader2 className="w-6 h-6 animate-spin mb-2" />
      <span className="text-xs font-medium">Loading audit queue...</span>
    </div>
  );
}

export default async function AuditPage() {
  const { user, profile, activeCompany } = await getCurrentUserContext();

  if (!user || !profile || !profile.is_active) {
    redirect('/login');
  }

  // Gate strictly to AUDITOR, APPROVER (oversight), or Admin
  if (
    profile.role !== 'AUDITOR' &&
    profile.role !== 'APPROVER' &&
    !profile.is_admin
  ) {
    redirect('/payments');
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
      '*, vendor:vendors(*), source_bank:company_banks(*), batch:payment_batches(*), creator:profiles!created_by(id, full_name, role), verifier:profiles!verified_by(id, full_name, role), approver:profiles!approved_by(id, full_name, role), payer:profiles!paid_by(id, full_name, role), auditor:profiles!audited_by(id, full_name, role)'
    )
    .eq('status', 'PAID')
    .order('paid_at', { ascending: false });

  let batchesQuery = supabase
    .from('payment_batches')
    .select(
      '*, source_bank:company_banks(*), creator:profiles!created_by(id, full_name, role), auditor:profiles!audited_by(id, full_name, role)'
    )
    .order('batch_date', { ascending: false })
    .order('created_at', { ascending: false });

  if (activeCompany) {
    banksQuery = banksQuery.eq('company_id', activeCompany.id);
    paymentsQuery = paymentsQuery.eq('company_id', activeCompany.id);
    batchesQuery = batchesQuery.eq('company_id', activeCompany.id);
  }

  const [banksRes, paymentsRes, batchesRes] = await Promise.all([
    banksQuery,
    paymentsQuery,
    batchesQuery,
  ]);

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
  const batches = ((batchesRes.data || []) as PaymentBatch[]).map((b) =>
    canSeeFullDebitAc || !b.source_bank
      ? b
      : {
        ...b,
        source_bank: {
          ...b.source_bank,
          full_debit_account_number: null,
        },
      }
  );

  return (
    <React.Suspense fallback={<AuditLoadingSkeleton />}>
      <AuditorWorkspace
        initialPayments={payments}
        initialBatches={batches}
        banks={banks}
        companyName={activeCompany?.name || 'INDFURN'}
        canAudit={profile.role === 'AUDITOR' || profile.is_admin}
        currentAuditorName={profile.full_name || 'Auditor'}
      />
    </React.Suspense>
  );
}
