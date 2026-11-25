import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getCurrentUserContext } from '@/lib/auth';
import { AppShell } from '@/components/layout/app-shell';
import type { Notification, PaymentStatus } from '@/types/database';

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user, profile, allowedCompanies, activeCompany } = await getCurrentUserContext();

  if (!user) {
    redirect('/login');
  }

  if (!profile || !profile.is_active) {
    const supabase = await createClient();
    await supabase.auth.signOut();
    redirect('/login?error=disabled');
  }

  const supabase = await createClient();

  // Role-appropriate badge count
  let statusFilter: PaymentStatus = 'PENDING_APPROVAL';
  if (profile.role === 'PREPARER') {
    statusFilter = 'APPROVED';
  } else if (profile.role === 'VERIFIER') {
    statusFilter = 'PENDING_VERIFICATION';
  } else if (profile.role === 'AUDITOR') {
    statusFilter = 'PAID';
  }

  let countQuery = supabase
    .from('payment_items')
    .select('id', { count: 'exact', head: true })
    .eq('status', statusFilter);

  if (activeCompany) {
    countQuery = countQuery.eq('company_id', activeCompany.id);
  }

  const notificationsListQuery = supabase
    .from('notifications')
    .select(
      'id, company_id, recipient_user_id, payment_item_id, event_type, title, body, is_read, created_at'
    )
    .eq('recipient_user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(25);

  const unreadCountQuery = supabase
    .from('notifications')
    .select('id', { count: 'exact', head: true })
    .eq('recipient_user_id', user.id)
    .eq('is_read', false);

  const [countRes, notifRes, unreadRes] = await Promise.all([
    countQuery,
    notificationsListQuery,
    unreadCountQuery,
  ]);

  const pendingCount = countRes.count || 0;
  const initialNotifications = (notifRes.data || []) as Notification[];
  const initialUnreadCount = unreadRes.count || 0;

  return (
    <AppShell
      profile={profile}
      pendingCount={pendingCount}
      allowedCompanies={allowedCompanies}
      activeCompany={activeCompany}
      initialNotifications={initialNotifications}
      initialUnreadCount={initialUnreadCount}
    >
      {children}
    </AppShell>
  );
}
