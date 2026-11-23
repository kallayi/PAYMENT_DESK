import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { AppShell } from '@/components/layout/app-shell';
import type { Profile } from '@/types/database';

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

  let profile: Profile | null = null;

  const profileRes = await supabase
    .from('profiles')
    .select('id, full_name, role, is_active, created_at, updated_at')
    .eq('id', user.id)
    .maybeSingle();

  if (profileRes.error) {
    console.error('DashboardLayout profile fetch error:', profileRes.error);
    if (process.env.SUPABASE_SERVICE_ROLE_KEY) {
      try {
        const admin = createAdminClient();
        const adminRes = await admin
          .from('profiles')
          .select('id, full_name, role, is_active, created_at, updated_at')
          .eq('id', user.id)
          .maybeSingle();

        if (adminRes.data) {
          profile = adminRes.data as Profile;
        } else if (adminRes.error) {
          console.error('DashboardLayout admin profile fallback error:', adminRes.error);
        }
      } catch (adminErr) {
        console.error('DashboardLayout admin client initialization error:', adminErr);
      }
    }
  } else {
    profile = profileRes.data as Profile | null;
  }

  // If still not found via user client, try admin client before failing
  if (!profile && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    try {
      const admin = createAdminClient();
      const adminRes = await admin
        .from('profiles')
        .select('id, full_name, role, is_active, created_at, updated_at')
        .eq('id', user.id)
        .maybeSingle();

      if (adminRes.data) {
        profile = adminRes.data as Profile;
      }
    } catch (e) {
      console.error('DashboardLayout secondary admin fetch error:', e);
    }
  }

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
