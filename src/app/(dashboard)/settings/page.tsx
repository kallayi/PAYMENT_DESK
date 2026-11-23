import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getCurrentUserAndProfile } from '@/lib/auth';
import { SettingsManagement } from '@/components/settings/settings-management';

export const metadata = {
  title: 'Settings | INDFURN',
  description: 'Manage company banks and user permissions.',
};

export default async function SettingsPage() {
  const { user, profile } = await getCurrentUserAndProfile();

  if (!user) {
    redirect('/login');
  }

  if (!profile || !profile.is_active || profile.role !== 'OWNER') {
    redirect('/payments');
  }

  const supabase = await createClient();

  const [{ data: users }, { data: banks }] = await Promise.all([
    supabase
      .from('profiles')
      .select('id, full_name, role, is_active, created_at, updated_at')
      .order('created_at', { ascending: true }),
    supabase
      .from('company_banks')
      .select('id, short_name, full_name, account_mask, is_active, created_at')
      .order('created_at', { ascending: true }),
  ]);

  return (
    <SettingsManagement
      currentUserId={user.id}
      initialUsers={users || []}
      initialBanks={banks || []}
    />
  );
}
