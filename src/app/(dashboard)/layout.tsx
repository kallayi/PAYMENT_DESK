import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { AppShell } from '@/components/layout/app-shell';

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login');
  }

  const profileRes = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single();

  const profile = profileRes.data;

  if (!profile || !profile.is_active) {
    await supabase.auth.signOut();
    redirect('/login?error=disabled');
  }

  let pendingCount = 0;
  if (profile.role === 'OWNER') {
    const { count } = await supabase
      .from('payment_items')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'PENDING_APPROVAL');
    pendingCount = count || 0;
  } else if (profile.role === 'ACCOUNTANT') {
    const { count } = await supabase
      .from('payment_items')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'APPROVED');
    pendingCount = count || 0;
  }

  return (
    <AppShell profile={profile} pendingCount={pendingCount}>
      {children}
    </AppShell>
  );
}
