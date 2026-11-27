import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getCurrentUserContext } from '@/lib/auth';
import { SettingsManagement, type EnrichedProfile } from '@/components/settings/settings-management';
import type { Company, CompanyBank, Profile } from '@/types/database';

export const metadata = {
  title: 'Settings | Payment Desk',
  description: 'Manage team accounts, permissions, and company disbursement banks.',
};

export default async function SettingsPage() {
  const { user, profile, activeCompany } = await getCurrentUserContext();

  if (!user) {
    redirect('/login');
  }

  // Strict Admin Gate: Only is_admin = true can access /settings
  if (!profile || !profile.is_active || !profile.is_admin) {
    redirect('/');
  }

  let enrichedUsers: EnrichedProfile[] = [];
  let banks: CompanyBank[] = [];
  let allCompanies: Company[] = [];

  const supabase = await createClient();

  // Fetch all companies for profile editing and user assignment checkboxes
  const { data: companiesData } = await supabase
    .from('companies')
    .select('id, code, name, contact_email, contact_phone, is_active, created_at')
    .eq('is_active', true)
    .order('code', { ascending: true });

  allCompanies = (companiesData as Company[]) || [];

  if (process.env.SUPABASE_SERVICE_ROLE_KEY) {
    try {
      const admin = createAdminClient();

      let banksAdminQuery = admin
        .from('company_banks')
        .select('*')
        .order('short_code', { ascending: true });

      if (activeCompany) {
        banksAdminQuery = banksAdminQuery.eq('company_id', activeCompany.id);
      }

      const [profilesRes, authUsersRes, banksRes, accessRes] = await Promise.all([
        admin
          .from('profiles')
          .select('id, full_name, role, is_admin, is_active, created_at, updated_at')
          .order('created_at', { ascending: true }),
        admin.auth.admin.listUsers({ page: 1, perPage: 100 }),
        banksAdminQuery,
        admin
          .from('user_company_access')
          .select('user_id, company_id, company:companies(id, code, name)'),
      ]);

      const authEmailMap = new Map<string, string>();
      if (authUsersRes.data?.users) {
        authUsersRes.data.users.forEach((u) => {
          if (u.email) authEmailMap.set(u.id, u.email);
        });
      }

      // Group assigned companies by user_id
      const userCompanyMap = new Map<string, Company[]>();
      if (accessRes.data) {
        accessRes.data.forEach((row: any) => {
          if (row.company) {
            const existing = userCompanyMap.get(row.user_id) || [];
            existing.push(row.company);
            userCompanyMap.set(row.user_id, existing);
          }
        });
      }

      enrichedUsers = (profilesRes.data || []).map((p: any) => ({
        ...p,
        email: authEmailMap.get(p.id) || undefined,
        assignedCompanies: userCompanyMap.get(p.id) || (p.is_admin ? allCompanies : []),
      })) as EnrichedProfile[];

      banks = (banksRes.data || []) as CompanyBank[];
    } catch (err) {
      console.error('SettingsPage admin query error:', err);
    }
  }

  // Fallback if admin query failed
  if (enrichedUsers.length === 0 && banks.length === 0) {
    let banksFallbackQuery = supabase
      .from('company_banks')
      .select('*')
      .order('short_code', { ascending: true });

    if (activeCompany) {
      banksFallbackQuery = banksFallbackQuery.eq('company_id', activeCompany.id);
    }

    const [profilesRes, banksRes] = await Promise.all([
      supabase
        .from('profiles')
        .select('*')
        .order('created_at', { ascending: true }),
      banksFallbackQuery,
    ]);

    enrichedUsers = (profilesRes.data || []).map((p) => ({
      ...p,
      assignedCompanies: p.is_admin ? allCompanies : [],
    })) as EnrichedProfile[];
    banks = (banksRes.data || []) as CompanyBank[];
  }

  const resolvedActiveCompany = activeCompany
    ? allCompanies.find((c) => c.id === activeCompany.id) ?? activeCompany
    : null;

  return (
    <SettingsManagement
      currentUserId={user.id}
      initialUsers={enrichedUsers}
      initialBanks={banks}
      activeCompany={resolvedActiveCompany}
      allCompanies={allCompanies}
    />
  );
}
