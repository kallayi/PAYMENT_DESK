'use server';

import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import {
  createUserSchema,
  updateUserSchema,
  type CreateUserInput,
  type UpdateUserInput,
} from '@/lib/validators';
import type { ActionResult, Profile } from '@/types/database';

export async function login(formData: FormData): Promise<ActionResult<{ redirectUrl: string }>> {
  const rawEmail = formData.get('email') as string;
  const password = formData.get('password') as string;

  if (!rawEmail || !rawEmail.trim()) {
    return { success: false, error: 'Email or username is required.' };
  }
  if (!password) {
    return { success: false, error: 'Password is required.' };
  }

  const emailTrimmed = rawEmail.trim().toLowerCase();
  const email = emailTrimmed.includes('@') ? emailTrimmed : `${emailTrimmed}@indfurn.com`;

  const supabase = await createClient();

  const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (authError || !authData.user) {
    return { success: false, error: authError?.message || 'Invalid username/email or password.' };
  }

  // Fetch user profile using createAdminClient strictly by authData.user.id
  let profile: Profile | null = null;
  let profileError: any = null;

  try {
    const admin = createAdminClient();
    const adminRes = await admin
      .from('profiles')
      .select('id, full_name, role, is_admin, is_active, created_at, updated_at')
      .eq('id', authData.user.id)
      .maybeSingle();

    profile = adminRes.data as Profile | null;
    profileError = adminRes.error;
  } catch (adminClientErr) {
    console.error('Error creating admin client:', adminClientErr);
    const fallbackRes = await supabase
      .from('profiles')
      .select('id, full_name, role, is_admin, is_active, created_at, updated_at')
      .eq('id', authData.user.id)
      .maybeSingle();

    profile = fallbackRes.data as Profile | null;
    profileError = fallbackRes.error;
  }

  if (profileError) {
    console.error('Profile fetch error:', profileError);
    await supabase.auth.signOut();
    return {
      success: false,
      error: 'Unable to retrieve user profile. Please contact the administrator.',
    };
  }

  if (!profile) {
    console.error('Profile fetch error: No profile record found for user id', authData.user.id);
    await supabase.auth.signOut();
    return {
      success: false,
      error: 'User profile not found. Please contact the administrator.',
    };
  }

  if (!profile.is_active) {
    await supabase.auth.signOut();
    return {
      success: false,
      error: 'This account has been disabled. Please contact the administrator.',
    };
  }

  // Synchronize admin-only role & admin status into auth app_metadata
  try {
    const admin = createAdminClient();
    await admin.auth.admin.updateUserById(authData.user.id, {
      app_metadata: {
        ...authData.user.app_metadata,
        role: profile.role,
        is_admin: profile.is_admin,
      },
      user_metadata: {
        ...authData.user.user_metadata,
        full_name: profile.full_name,
      },
    });
  } catch (syncErr) {
    console.error('Failed to sync app_metadata on login:', syncErr);
  }

  let redirectUrl = '/';
  if (profile.role === 'APPROVER') {
    redirectUrl = '/approvals';
  } else if (profile.role === 'PREPARER') {
    redirectUrl = '/payments';
  } else if (profile.role === 'VERIFIER') {
    redirectUrl = '/verify';
  } else if (profile.role === 'AUDITOR') {
    redirectUrl = '/audit';
  }

  revalidatePath('/', 'layout');
  return { success: true, data: { redirectUrl } };
}

export async function logout(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  revalidatePath('/', 'layout');
  redirect('/login');
}

/**
 * Admin action to create new team accounts (PREPARER, VERIFIER, APPROVER, AUDITOR)
 * Enforces:
 * - is_admin privilege verification
 * - role & is_admin cached in app_metadata
 * - .upsert() on public.profiles with onConflict: 'id'
 * - atomic deleteUser rollback on failure
 * - user_company_access mapping
 */
export async function createUser(input: CreateUserInput): Promise<ActionResult<Profile>> {
  const supabase = await createClient();

  const {
    data: { user: callerUser },
  } = await supabase.auth.getUser();

  if (!callerUser) {
    return { success: false, error: 'Unauthorized. Please sign in.' };
  }

  const { data: callerProfile } = await supabase
    .from('profiles')
    .select('role, is_admin, is_active')
    .eq('id', callerUser.id)
    .single();

  if (!callerProfile || !callerProfile.is_active || !callerProfile.is_admin) {
    return { success: false, error: 'Only an Administrator can create team user accounts.' };
  }

  const parsed = createUserSchema.safeParse(input);
  if (!parsed.success) {
    const errorMsg = parsed.error.issues[0]?.message || 'Invalid user input';
    return { success: false, error: errorMsg };
  }

  const userData = parsed.data;
  const email = userData.email.trim().toLowerCase();
  const adminClient = createAdminClient();

  // Step 1: Create auth user via Supabase Admin API
  const { data: authRecord, error: authError } = await adminClient.auth.admin.createUser({
    email,
    password: userData.password,
    email_confirm: true,
    user_metadata: {
      full_name: userData.full_name.trim(),
    },
    app_metadata: {
      role: userData.role,
      is_admin: Boolean(userData.is_admin),
    },
  });

  if (authError || !authRecord.user) {
    return { success: false, error: authError?.message || 'Failed to create user in Auth.' };
  }

  const createdUserId = authRecord.user.id;

  // Step 2: Upsert into public.profiles (never raw .insert() to avoid race collisions)
  const { data: newProfile, error: profileError } = await adminClient
    .from('profiles')
    .upsert(
      {
        id: createdUserId,
        full_name: userData.full_name.trim(),
        role: userData.role,
        is_admin: Boolean(userData.is_admin),
        is_active: true,
      },
      { onConflict: 'id' }
    )
    .select()
    .single();

  if (profileError || !newProfile) {
    console.error('Profile upsert error:', profileError);
    // Atomic Rollback
    await adminClient.auth.admin.deleteUser(createdUserId);
    return {
      success: false,
      error: profileError?.message || 'Failed to create user profile. Action rolled back.',
    };
  }

  // Step 3: Insert company access mapping
  if (userData.company_ids && userData.company_ids.length > 0) {
    const companyAccessRows = userData.company_ids.map((companyId) => ({
      user_id: createdUserId,
      company_id: companyId,
    }));

    const { error: accessError } = await adminClient
      .from('user_company_access')
      .insert(companyAccessRows);

    if (accessError) {
      console.error('Company access insertion error:', accessError);
      // Atomic Rollback
      await adminClient.auth.admin.deleteUser(createdUserId);
      return {
        success: false,
        error: 'Failed to assign company workspaces. Action rolled back.',
      };
    }
  }

  revalidatePath('/settings');
  return { success: true, data: newProfile as Profile };
}

/**
 * Admin action to update existing team accounts
 * Enforces:
 * - is_admin caller check
 * - Self-lockout guard (cannot disable self or revoke own admin status)
 * - app_metadata sync with profiles
 * - user_company_access sync
 */
export async function updateUser(input: UpdateUserInput): Promise<ActionResult<Profile>> {
  const supabase = await createClient();

  const {
    data: { user: callerUser },
  } = await supabase.auth.getUser();

  if (!callerUser) {
    return { success: false, error: 'Unauthorized. Please sign in.' };
  }

  const { data: callerProfile } = await supabase
    .from('profiles')
    .select('id, role, is_admin, is_active')
    .eq('id', callerUser.id)
    .single();

  if (!callerProfile || !callerProfile.is_active || !callerProfile.is_admin) {
    return { success: false, error: 'Only an Administrator can edit team user accounts.' };
  }

  const parsed = updateUserSchema.safeParse(input);
  if (!parsed.success) {
    const errorMsg = parsed.error.issues[0]?.message || 'Invalid user update input';
    return { success: false, error: errorMsg };
  }

  const { user_id, full_name, role, is_admin, is_active, company_ids } = parsed.data;

  // Self-Lockout Guards
  if (callerProfile.id === user_id) {
    if (!is_active) {
      return { success: false, error: 'You cannot disable your own administrator account.' };
    }
    if (!is_admin) {
      return { success: false, error: 'You cannot remove administrator privileges from yourself.' };
    }
  }

  const adminClient = createAdminClient();

  // 1. Update public.profiles
  const { data: updatedProfile, error: profileError } = await adminClient
    .from('profiles')
    .update({
      full_name: full_name.trim(),
      role,
      is_admin: Boolean(is_admin),
      is_active: Boolean(is_active),
      updated_at: new Date().toISOString(),
    })
    .eq('id', user_id)
    .select()
    .single();

  if (profileError || !updatedProfile) {
    return { success: false, error: profileError?.message || 'Failed to update user profile.' };
  }

  // 2. Sync auth.users.raw_app_meta_data and user_metadata
  try {
    const { data: targetAuthUser } = await adminClient.auth.admin.getUserById(user_id);
    if (targetAuthUser?.user) {
      await adminClient.auth.admin.updateUserById(user_id, {
        app_metadata: {
          ...targetAuthUser.user.app_metadata,
          role,
          is_admin: Boolean(is_admin),
        },
        user_metadata: {
          ...targetAuthUser.user.user_metadata,
          full_name: full_name.trim(),
        },
      });
    }
  } catch (syncErr) {
    console.error('Error updating auth app_metadata for user:', syncErr);
  }

  // 3. Update user_company_access
  if (company_ids && company_ids.length > 0) {
    // Delete existing mappings
    await adminClient.from('user_company_access').delete().eq('user_id', user_id);

    // Insert new mappings
    const companyAccessRows = company_ids.map((companyId) => ({
      user_id,
      company_id: companyId,
    }));
    await adminClient.from('user_company_access').insert(companyAccessRows);
  }

  revalidatePath('/settings');
  return { success: true, data: updatedProfile as Profile };
}

/**
 * Admin action to toggle team user active status (Enable / Disable)
 * Enforces self-lockout check
 */
export async function toggleUserActive(targetUserId: string): Promise<ActionResult<Profile>> {
  const supabase = await createClient();

  const {
    data: { user: callerUser },
  } = await supabase.auth.getUser();

  if (!callerUser) {
    return { success: false, error: 'Unauthorized. Please sign in.' };
  }

  if (callerUser.id === targetUserId) {
    return { success: false, error: 'You cannot disable your own administrator account.' };
  }

  const { data: callerProfile } = await supabase
    .from('profiles')
    .select('role, is_admin, is_active')
    .eq('id', callerUser.id)
    .single();

  if (!callerProfile || !callerProfile.is_active || !callerProfile.is_admin) {
    return { success: false, error: 'Only an Administrator can manage user access.' };
  }

  const adminClient = createAdminClient();

  const { data: currentTarget } = await adminClient
    .from('profiles')
    .select('*')
    .eq('id', targetUserId)
    .single();

  if (!currentTarget) {
    return { success: false, error: 'User record not found.' };
  }

  const newStatus = !currentTarget.is_active;

  const { data: updated, error } = await adminClient
    .from('profiles')
    .update({
      is_active: newStatus,
      updated_at: new Date().toISOString(),
    })
    .eq('id', targetUserId)
    .select()
    .single();

  if (error || !updated) {
    console.error('Failed to update user status in admin:', error);
    return { success: false, error: 'Failed to update user status. Please try again.' };
  }

  revalidatePath('/settings');
  return { success: true, data: updated as Profile };
}
