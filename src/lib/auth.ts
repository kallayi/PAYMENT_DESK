import { cache } from 'react';
import { cookies } from 'next/headers';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import type { Company, Profile } from '@/types/database';
import type { User } from '@supabase/supabase-js';

export type CurrentUserContext = {
  user: User | null;
  profile: Profile | null;
  allowedCompanies: Company[];
  activeCompany: Company | null;
};

export type CurrentUserAndProfile = {
  user: User | null;
  profile: Profile | null;
};

/**
 * Request-scoped cached helper to fetch the authenticated user, profile,
 * allowed company workspaces, and active company workspace.
 * React cache() ensures that layout.tsx and child page.tsx components share ONE single
 * auth + profile + company-access resolution per server request.
 */
export const getCurrentUserContext = cache(async (): Promise<CurrentUserContext> => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { user: null, profile: null, allowedCompanies: [], activeCompany: null };
  }

  let profile: Profile | null = null;

  const profileRes = await supabase
    .from('profiles')
    .select('id, full_name, role, is_admin, is_active, created_at, updated_at')
    .eq('id', user.id)
    .maybeSingle();

  if (profileRes.error) {
    console.error('getCurrentUserContext profile fetch error:', profileRes.error);
    if (process.env.SUPABASE_SERVICE_ROLE_KEY) {
      try {
        const admin = createAdminClient();
        const adminRes = await admin
          .from('profiles')
          .select('id, full_name, role, is_admin, is_active, created_at, updated_at')
          .eq('id', user.id)
          .maybeSingle();

        if (adminRes.data) {
          profile = adminRes.data as Profile;
        }
      } catch (adminErr) {
        console.error('getCurrentUserContext admin fallback error:', adminErr);
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
        .select('id, full_name, role, is_admin, is_active, created_at, updated_at')
        .eq('id', user.id)
        .maybeSingle();

      if (adminRes.data) {
        profile = adminRes.data as Profile;
      }
    } catch (err) {
      console.error('getCurrentUserContext secondary admin fallback error:', err);
    }
  }

  // Ensure admin-only app_metadata role and is_admin are in sync with verified database profile
  if (profile && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    if (
      user.app_metadata?.role !== profile.role ||
      user.app_metadata?.is_admin !== profile.is_admin
    ) {
      try {
        const admin = createAdminClient();
        admin.auth.admin
          .updateUserById(user.id, {
            app_metadata: {
              ...user.app_metadata,
              role: profile.role,
              is_admin: profile.is_admin,
            },
            user_metadata: {
              ...user.user_metadata,
              full_name: profile.full_name,
            },
          })
          .catch(() => {
            // Non-blocking background sync
          });
      } catch {
        // Ignore background sync errors
      }
    }
  }

  // Fetch allowed companies
  let allowedCompanies: Company[] = [];

  if (profile?.is_admin) {
    // Admin users have full access to both INDFURN and VINMORE
    const { data: allCompanies } = await supabase
      .from('companies')
      .select('id, code, name, is_active, created_at')
      .eq('is_active', true)
      .order('code', { ascending: true });

    allowedCompanies = (allCompanies as Company[]) || [];
  } else if (profile) {
    // Regular users have access based on public.user_company_access
    const { data: accessRows } = await supabase
      .from('user_company_access')
      .select('company:companies(id, code, name, is_active, created_at)')
      .eq('user_id', user.id);

    if (accessRows && accessRows.length > 0) {
      allowedCompanies = accessRows
        .map((row: any) => row.company)
        .filter((c: any): c is Company => Boolean(c && c.is_active));
    }
  }

  // Fallback: If no company access row is provisioned yet, default to INDFURN
  if (allowedCompanies.length === 0) {
    const { data: defaultCompany } = await supabase
      .from('companies')
      .select('id, code, name, is_active, created_at')
      .eq('code', 'INDFURN')
      .maybeSingle();

    if (defaultCompany) {
      allowedCompanies = [defaultCompany as Company];
    }
  }

  // Resolve activeCompany from HTTP-only cookie pd_active_company
  let activeCompany: Company | null = null;
  try {
    const cookieStore = await cookies();
    const activeCompanyCookie = cookieStore.get('pd_active_company')?.value;

    if (activeCompanyCookie) {
      activeCompany =
        allowedCompanies.find(
          (c) =>
            c.id === activeCompanyCookie ||
            c.code.toUpperCase() === activeCompanyCookie.toUpperCase()
        ) || null;
    }
  } catch {
    // Ignore cookies read errors in non-request contexts
  }

  if (!activeCompany && allowedCompanies.length > 0) {
    activeCompany = allowedCompanies[0];
  }

  return { user, profile, allowedCompanies, activeCompany };
});

/**
 * Backward-compatible helper returning { user, profile }
 */
export const getCurrentUserAndProfile = cache(async (): Promise<CurrentUserAndProfile> => {
  const ctx = await getCurrentUserContext();
  return { user: ctx.user, profile: ctx.profile };
});
