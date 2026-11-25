import * as React from 'react';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getCurrentUserContext } from '@/lib/auth';
import { VerifierQueueView } from '@/components/verify/verifier-queue-view';
import { Loader2 } from 'lucide-react';
import type { PaymentItem } from '@/types/database';

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

  let query = supabase
    .from('payment_items')
    .select(
      '*, vendor:vendors(*), source_bank:company_banks(*), creator:profiles!created_by(id, full_name, role)'
    )
    .eq('status', 'PENDING_VERIFICATION')
    .order('due_date', { ascending: true });

  if (activeCompany) {
    query = query.eq('company_id', activeCompany.id);
  }

  const { data: payments, error } = await query;

  if (error) {
    console.error('Error fetching verification queue:', error);
  }

  return (
    <React.Suspense fallback={<VerifyLoadingSkeleton />}>
      <VerifierQueueView
        initialPayments={(payments || []) as PaymentItem[]}
        companyName={activeCompany?.name || 'INDFURN'}
      />
    </React.Suspense>
  );
}
