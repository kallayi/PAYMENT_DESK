import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getCurrentUserAndProfile } from '@/lib/auth';
import { VendorManagement } from '@/components/vendors/vendor-management';

export const metadata = {
  title: 'Vendors | INDFURN',
  description: 'Manage verified vendors, bank accounts, and GSTIN details.',
};

export default async function VendorsPage() {
  const { user, profile } = await getCurrentUserAndProfile();

  if (!user) {
    redirect('/login');
  }

  if (!profile || !profile.is_active) {
    redirect('/login?error=disabled');
  }

  const supabase = await createClient();

  const { data: vendors } = await supabase
    .from('vendors')
    .select('id, name, gstin, bank_account_no, ifsc_code, notes, is_active, created_by, created_at')
    .order('name', { ascending: true });

  return <VendorManagement initialVendors={vendors || []} />;
}
