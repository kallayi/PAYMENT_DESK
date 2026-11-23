import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { VendorManagement } from '@/components/vendors/vendor-management';

export default async function VendorsPage() {
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

  if (!profile || !profile.is_active || profile.role === 'STAFF') {
    redirect('/bills');
  }

  const { data: vendors } = await supabase
    .from('vendors')
    .select('*')
    .order('name', { ascending: true });

  return <VendorManagement initialVendors={vendors || []} />;
}
