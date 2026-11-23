import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';

export default async function HomePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login');
  }

  const profileRes = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single();

  const role = profileRes.data?.role;
  if (role === 'OWNER') {
    redirect('/approvals');
  } else {
    redirect('/payments');
  }
}
