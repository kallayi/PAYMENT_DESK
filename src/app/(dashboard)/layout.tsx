import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getCurrentUserContext } from '@/lib/auth';
import { logout } from '@/actions/auth';
import { AppShell } from '@/components/layout/app-shell';
import type { Notification, PaymentStatus } from '@/types/database';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

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

  if (allowedCompanies.length === 0 || !activeCompany) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#F8FAFC] dark:bg-[#050505] px-4">
        <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 sm:p-8 shadow-sm text-center space-y-4">
          <h1 className="text-base sm:text-lg font-bold text-slate-900">
            No Company Workspace Assigned
          </h1>
          <p className="text-xs sm:text-sm text-slate-600 leading-relaxed">
            Your account ({profile.full_name}) does not currently have access to any active company workspace. Please ask your Administrator to grant company access.
          </p>
          <form action={logout} className="pt-1">
            <button
              type="submit"
              className="w-full min-h-[42px] px-4 rounded-lg bg-[#7F1D1D] hover:bg-[#991B1B] text-white text-xs sm:text-sm font-semibold transition-colors cursor-pointer"
            >
              Sign Out
            </button>
          </form>
        </div>
      </div>
    );
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

  let reqCountQuery = supabase
    .from('payment_requests')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'PENDING');

  if (activeCompany) {
    countQuery = countQuery.eq('company_id', activeCompany.id);
    reqCountQuery = reqCountQuery.eq('company_id', activeCompany.id);
  }

  const notificationsListQuery = supabase
    .from('notifications')
    .select('*')
    .eq('recipient_user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(25);

  const unreadCountQuery = supabase
    .from('notifications')
    .select('id', { count: 'exact', head: true })
    .eq('recipient_user_id', user.id)
    .eq('is_read', false);

  const [countRes, reqCountRes, notifRes, unreadRes] = await Promise.all([
    countQuery,
    reqCountQuery,
    notificationsListQuery,
    unreadCountQuery,
  ]);

  const pendingCount = countRes.count || 0;
  const pendingRequestsCount = reqCountRes.count || 0;
  const initialNotifications = (notifRes.data || []) as Notification[];
  const initialUnreadCount = unreadRes.count || 0;

  return (
    <AppShell
      profile={profile}
      pendingCount={pendingCount}
      pendingRequestsCount={pendingRequestsCount}
      allowedCompanies={allowedCompanies}
      activeCompany={activeCompany}
      initialNotifications={initialNotifications}
      initialUnreadCount={initialUnreadCount}
    >
      {children}
    </AppShell>
  );
}
