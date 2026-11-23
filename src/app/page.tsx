import { redirect } from 'next/navigation';
import { getCurrentUserAndProfile } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';

export default async function HomePage() {
  const { user, profile } = await getCurrentUserAndProfile();

  if (!user) {
    redirect('/login');
  }

  if (profile && !profile.is_active) {
    const supabase = await createClient();
    await supabase.auth.signOut();
    redirect('/login?error=disabled');
  }

  const role = profile?.role || (user.user_metadata?.role as string) || 'ACCOUNTANT';
  if (role === 'OWNER') {
    redirect('/approvals');
  } else {
    redirect('/payments');
  }
}
