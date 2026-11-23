import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { SettingsManagement } from '@/components/settings/settings-management';

export default async function SettingsPage() {
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

  if (!profile || !profile.is_active || profile.role !== 'OWNER') {
    redirect('/payments');
  }

  const [{ data: users }, { data: banks }] = await Promise.all([
    supabase.from('profiles').select('*').order('created_at', { ascending: true }),
    supabase.from('company_banks').select('*').order('created_at', { ascending: true }),
  ]);

  return (
    <SettingsManagement
      currentUserId={user.id}
      initialUsers={users || []}
      initialBanks={banks || []}
    />
  );
}
