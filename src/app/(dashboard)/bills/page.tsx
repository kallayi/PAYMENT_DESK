import * as React from 'react';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { StaffBillsView } from '@/components/bills/staff-bills-view';
import { Loader2 } from 'lucide-react';

export const metadata = {
  title: 'Stock Bills | INDFURN',
  description: 'Upload supplier invoices to send to Accounts',
};

function BillsLoadingSkeleton() {
  return (
    <div className="w-full flex flex-col items-center justify-center py-20 text-slate-400">
      <Loader2 className="w-6 h-6 animate-spin mb-2" />
      <span className="text-xs font-medium">Loading bills...</span>
    </div>
  );
}

export default async function BillsPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login');
  }

  // 1. Fetch active vendors for the vendor dropdown
  const { data: vendors } = await supabase
    .from('vendors')
    .select('*')
    .eq('is_active', true)
    .order('name', { ascending: true });

  // 2. Fetch bills uploaded by current user
  // Staff should strictly only see bills they uploaded.
  const { data: bills } = await supabase
    .from('incoming_bills')
    .select('*, vendor:vendors(id, name, gstin)')
    .eq('uploaded_by', user.id)
    .order('created_at', { ascending: false });

  return (
    <React.Suspense fallback={<BillsLoadingSkeleton />}>
      <StaffBillsView
        vendors={vendors || []}
        initialBills={bills || []}
      />
    </React.Suspense>
  );
}
