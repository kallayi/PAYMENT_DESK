import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

export default async function HomePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login');
  }

  let role = (user.user_metadata?.role as string) || null;

  const profileRes = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .maybeSingle();

  if (profileRes.data?.role) {
    role = profileRes.data.role;
  } else {
    if (profileRes.error) {
      console.error('HomePage profile fetch error:', profileRes.error);
    }
    if (process.env.SUPABASE_SERVICE_ROLE_KEY) {
      try {
        const admin = createAdminClient();
        const adminRes = await admin
          .from('profiles')
          .select('role')
          .eq('id', user.id)
          .maybeSingle();
        if (adminRes.data?.role) {
          role = adminRes.data.role;
        }
      } catch (e) {
        console.error('HomePage admin profile fetch error:', e);
      }
    }
  }

  if (role === 'OWNER') {
    redirect('/approvals');
  } else {
    redirect('/payments');
  }
}
