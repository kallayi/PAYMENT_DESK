import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getCurrentUserContext } from '@/lib/auth';
import { VendorManagement } from '@/components/vendors/vendor-management';
import type { Vendor } from '@/types/database';

export const metadata = {
  title: 'Vendors | Payment Desk',
  description: 'Lean beneficiary directory and bank routing details for active company.',
};

export default async function VendorsPage() {
  const { user, profile, activeCompany } = await getCurrentUserContext();

  if (!user) {
    redirect('/login');
  }

  if (!profile || !profile.is_active) {
    redirect('/login?error=disabled');
  }

  const supabase = await createClient();

  let query = supabase
    .from('vendors')
    .select('*')
    .order('party_name', { ascending: true });

  if (activeCompany) {
    query = query.eq('company_id', activeCompany.id);
  }

  const { data: vendors } = await query;

  const canManage =
    profile.role === 'PREPARER' || profile.role === 'VERIFIER' || profile.is_admin;

  return (
    <VendorManagement
      initialVendors={(vendors || []) as Vendor[]}
      activeCompany={activeCompany}
      canManage={canManage}
    />
  );
}
