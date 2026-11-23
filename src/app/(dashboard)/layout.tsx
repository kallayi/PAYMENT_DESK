import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getCurrentUserAndProfile } from '@/lib/auth';
import { AppShell } from '@/components/layout/app-shell';

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user, profile } = await getCurrentUserAndProfile();

  if (!user) {
    redirect('/login');
  }

  if (!profile || !profile.is_active) {
    const supabase = await createClient();
    await supabase.auth.signOut();
    redirect('/login?error=disabled');
  }

  const supabase = await createClient();
  let pendingCount = 0;
  const statusFilter = profile.role === 'OWNER' ? 'PENDING_APPROVAL' : 'APPROVED';
  const { count } = await supabase
    .from('payment_items')
    .select('id', { count: 'exact', head: true })
    .eq('status', statusFilter);
  pendingCount = count || 0;

  return (
    <AppShell profile={profile} pendingCount={pendingCount}>
      {children}
    </AppShell>
  );
}
