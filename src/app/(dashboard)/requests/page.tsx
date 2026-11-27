import * as React from 'react';
import { redirect } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { getCurrentUserContext } from '@/lib/auth';
import { PaymentRequestsWorkspace } from '@/components/requests/payment-requests-workspace';
import type { CompanyBank, PaymentPurpose, PaymentRequest, Vendor } from '@/types/database';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export const metadata = {
  title: 'Direct Payment Requests | Payment Desk',
  description: 'Inbox for direct payment requests from Approver, Admin, or Verifier to Accounts.',
};

function RequestsLoadingSkeleton() {
  return (
    <div className="w-full flex flex-col items-center justify-center py-20 text-slate-400">
      <Loader2 className="w-6 h-6 animate-spin mb-2" />
      <span className="text-xs font-medium">Loading payment requests inbox...</span>
    </div>
  );
}

export default async function PaymentRequestsPage() {
  const { user, profile, activeCompany } = await getCurrentUserContext();

  if (!user) {
    redirect('/login');
  }

  if (!profile || !profile.is_active) {
    redirect('/login?error=disabled');
  }

  // Only PREPARER, VERIFIER, APPROVER, and Admins can access /requests
  if (
    profile.role !== 'PREPARER' &&
    profile.role !== 'VERIFIER' &&
    profile.role !== 'APPROVER' &&
    !profile.is_admin
  ) {
    redirect('/');
  }

  const supabase = await createClient();

  let requestsQuery = supabase
    .from('payment_requests')
    .select(
      '*, vendor:vendors(*), requester:profiles!requested_by(id, full_name, role), processor:profiles!processed_by(id, full_name, role)'
    )
    .order('created_at', { ascending: false });

  let vendorsQuery = supabase
    .from('vendors')
    .select('*')
    .eq('is_active', true)
    .order('party_name', { ascending: true });

  let banksQuery = supabase
    .from('company_banks')
    .select('*')
    .eq('is_active', true)
    .order('short_code', { ascending: true });

  let purposesQuery = supabase
    .from('payment_purposes')
    .select('*')
    .order('label', { ascending: true });

  if (activeCompany) {
    requestsQuery = requestsQuery.eq('company_id', activeCompany.id);
    vendorsQuery = vendorsQuery.eq('company_id', activeCompany.id);
    banksQuery = banksQuery.eq('company_id', activeCompany.id);
    purposesQuery = purposesQuery.eq('company_id', activeCompany.id);
  }

  const [requestsRes, vendorsRes, banksRes, purposesRes] = await Promise.all([
    requestsQuery,
    vendorsQuery,
    banksQuery,
    purposesQuery,
  ]);

  const canSeeFullDebitAc = profile.role === 'PREPARER' || profile.is_admin;
  const banks = ((banksRes.data || []) as CompanyBank[]).map((b) =>
    canSeeFullDebitAc ? b : { ...b, full_debit_account_number: null }
  );

  return (
    <React.Suspense fallback={<RequestsLoadingSkeleton />}>
      <PaymentRequestsWorkspace
        initialRequests={(requestsRes.data || []) as PaymentRequest[]}
        vendors={(vendorsRes.data || []) as Vendor[]}
        banks={banks}
        initialPurposes={(purposesRes.data || []) as PaymentPurpose[]}
        companyName={activeCompany?.name || 'INDFURN'}
        currentUserId={user.id}
        userRole={profile.role}
        isAdmin={profile.is_admin}
      />
    </React.Suspense>
  );
}
