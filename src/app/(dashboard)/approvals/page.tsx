import * as React from 'react';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { OwnerApprovalsView } from '@/components/payments/owner-approvals-view';
import { Loader2 } from 'lucide-react';
import type { CompanyBank, PaymentItem } from '@/types/database';

export const metadata = {
  title: 'Approvals | INDFURN',
  description: 'Owner authorization portal for vendor payments and bank disbursements.',
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
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login');
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, is_active')
    .eq('id', user.id)
    .single();

  if (!profile || !profile.is_active) {
    await supabase.auth.signOut();
    redirect('/login?error=disabled');
  }

  // Strict role check: Only Owner can access /approvals
  if (profile.role !== 'OWNER') {
    redirect('/payments');
  }

  // Fetch company banks and pending/on-hold payment items in parallel
  const [banksRes, paymentsRes] = await Promise.all([
    supabase
      .from('company_banks')
      .select('*')
      .eq('is_active', true)
      .order('short_name', { ascending: true }),
    supabase
      .from('payment_items')
      .select(
        '*, vendor:vendors(id, name, gstin, bank_account_no, ifsc_code), source_bank:company_banks(id, short_name, full_name)'
      )
      .in('status', ['PENDING_APPROVAL', 'ON_HOLD'])
      .order('created_at', { ascending: false }),
  ]);

  const banks = (banksRes.data || []) as CompanyBank[];
  const payments = (paymentsRes.data || []) as PaymentItem[];

  return (
    <React.Suspense fallback={<ApprovalsLoadingSkeleton />}>
      <OwnerApprovalsView initialPayments={payments} banks={banks} />
    </React.Suspense>
  );
}
