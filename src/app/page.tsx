import { redirect } from 'next/navigation';
import { getCurrentUserContext } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';

export default async function HomePage() {
  const { user, profile } = await getCurrentUserContext();

  if (!user) {
    redirect('/login');
  }

  if (profile && !profile.is_active) {
    const supabase = await createClient();
    await supabase.auth.signOut();
    redirect('/login?error=disabled');
  }

  const role =
    profile?.role ||
    (user.app_metadata?.role as string);

  if (role === 'APPROVER') {
    redirect('/approvals');
  } else if (role === 'PREPARER') {
    redirect('/payments');
  } else if (role === 'VERIFIER') {
    redirect('/verify');
  } else if (role === 'AUDITOR') {
    redirect('/audit');
  } else {
    // If role cannot be resolved, sign out and prompt login rather than guessing
    const supabase = await createClient();
    await supabase.auth.signOut();
    redirect('/login');
  }
}
