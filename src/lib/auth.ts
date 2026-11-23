import { cache } from 'react';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import type { Profile } from '@/types/database';
import type { User } from '@supabase/supabase-js';

export type CurrentUserAndProfile = {
  user: User | null;
  profile: Profile | null;
};

/**
 * Request-scoped cached helper to fetch the authenticated user and profile.
 * React cache() ensures that layout.tsx and child page.tsx share ONE single
 * lookup per server request rather than making redundant round-trips.
 */
export const getCurrentUserAndProfile = cache(async (): Promise<CurrentUserAndProfile> => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { user: null, profile: null };
  }

  let profile: Profile | null = null;

  const profileRes = await supabase
    .from('profiles')
    .select('id, full_name, role, is_active, created_at, updated_at')
    .eq('id', user.id)
    .maybeSingle();

  if (profileRes.error) {
    console.error('getCurrentUserAndProfile profile fetch error:', profileRes.error);
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
        }
      } catch (adminErr) {
        console.error('getCurrentUserAndProfile admin fallback error:', adminErr);
      }
    }
  } else {
    profile = profileRes.data as Profile | null;
  }

  // Fallback to admin client if RLS or session timing causes missing row
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
    } catch (err) {
      console.error('getCurrentUserAndProfile secondary admin fallback error:', err);
    }
  }

  return { user, profile };
});
