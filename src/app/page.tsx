import { redirect } from 'next/navigation';
import { getCurrentUserAndProfile } from '@/lib/auth';

export default async function HomePage() {
  const { user, profile } = await getCurrentUserAndProfile();

  if (!user) {
    redirect('/login');
  }

  const role = profile?.role || (user.user_metadata?.role as string) || 'ACCOUNTANT';
  if (role === 'OWNER') {
    redirect('/approvals');
  } else {
    redirect('/payments');
  }
}
