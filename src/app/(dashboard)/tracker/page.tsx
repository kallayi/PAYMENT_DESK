import * as React from 'react';
import { redirect } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { getCurrentUserContext } from '@/lib/auth';
import { LiveWorkflowTracker } from '@/components/payments/live-workflow-tracker';
import type { PaymentItem, PaymentStatus } from '@/types/database';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export const metadata = {
  title: 'Live Workflow Tracker | Payment Desk',
  description: 'Real-time payment lifecycle monitor showing active bottlenecks and current desk ownership.',
};

const ACTIVE_TRACKER_STATUSES: PaymentStatus[] = [
  'DRAFT',
  'PENDING_VERIFICATION',
  'PENDING_APPROVAL',
  'ON_HOLD',
  'APPROVED',
];

function TrackerLoadingSkeleton() {
  return (
    <div className="w-full flex flex-col items-center justify-center py-20 text-slate-400">
      <Loader2 className="w-6 h-6 animate-spin mb-2" />
      <span className="text-xs font-medium">Loading live workflow tracker...</span>
    </div>
  );
}

export default async function TrackerPage() {
  const { user, profile, activeCompany } = await getCurrentUserContext();

  if (!user) {
    redirect('/login');
  }

  if (!profile || !profile.is_active) {
    redirect('/login?error=disabled');
  }

  if (profile.role === 'AUDITOR' && !profile.is_admin) {
    redirect('/audit');
  }

  const supabase = await createClient();

  let paymentsQuery = supabase
    .from('payment_items')
    .select(
      '*, vendor:vendors(*), source_bank:company_banks(*), creator:profiles!created_by(id, full_name, role), verifier:profiles!verified_by(id, full_name, role), approver:profiles!approved_by(id, full_name, role)'
    )
    .in('status', ACTIVE_TRACKER_STATUSES)
    .order('updated_at', { ascending: false })
    .order('created_at', { ascending: false });

  if (activeCompany) {
    paymentsQuery = paymentsQuery.eq('company_id', activeCompany.id);
  }

  const { data } = await paymentsQuery;

  const canSeeFullDebitAc = profile.role === 'PREPARER' || profile.is_admin;
  const payments = ((data || []) as PaymentItem[]).map((p) =>
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
    <React.Suspense fallback={<TrackerLoadingSkeleton />}>
      <LiveWorkflowTracker
        initialPayments={payments}
        companyName={activeCompany?.name || 'INDFURN'}
        userRole={profile.role}
        isAdmin={profile.is_admin}
      />
    </React.Suspense>
  );
}
