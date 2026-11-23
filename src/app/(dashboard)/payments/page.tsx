import * as React from 'react';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getCurrentUserAndProfile } from '@/lib/auth';
import { PaymentsWorkspace } from '@/components/payments/payments-workspace';
import { Loader2 } from 'lucide-react';
import type { CompanyBank, PaymentItem, Vendor } from '@/types/database';

export const metadata = {
  title: 'Payments | INDFURN',
  description: 'Manage payments ledger and submit for owner approval.',
};

function PaymentsLoadingSkeleton() {
  return (
    <div className="w-full flex flex-col items-center justify-center py-20 text-slate-400">
      <Loader2 className="w-6 h-6 animate-spin mb-2" />
      <span className="text-xs font-medium">Loading payments ledger...</span>
    </div>
  );
}

export default async function PaymentsPage() {
  const { user, profile } = await getCurrentUserAndProfile();

  if (!user) {
    redirect('/login');
  }

  if (!profile || !profile.is_active) {
    redirect('/login?error=disabled');
  }

  // Strict role check: Only Accountant and Owner can access /payments
  if (profile.role !== 'ACCOUNTANT' && profile.role !== 'OWNER') {
    redirect('/login');
  }

  const supabase = await createClient();

  // Concurrently fetch active vendors, banks, and payment ledger in parallel
  const [vendorsRes, banksRes, paymentsRes] = await Promise.all([
    supabase
      .from('vendors')
      .select('id, name, gstin, bank_account_no, ifsc_code, notes, is_active, created_by, created_at')
      .eq('is_active', true)
      .order('name', { ascending: true }),
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
      .order('created_at', { ascending: false }),
  ]);

  const vendors = (vendorsRes.data || []) as Vendor[];
  const banks = (banksRes.data || []) as CompanyBank[];
  const payments = (paymentsRes.data || []) as PaymentItem[];

  return (
    <React.Suspense fallback={<PaymentsLoadingSkeleton />}>
      <PaymentsWorkspace
        initialPayments={payments}
        vendors={vendors}
        banks={banks}
      />
    </React.Suspense>
  );
}
