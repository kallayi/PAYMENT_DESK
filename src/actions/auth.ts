'use server';

import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { createUserSchema, type CreateUserInput } from '@/lib/validators';
import type { ActionResult, Profile } from '@/types/database';

export async function login(formData: FormData): Promise<ActionResult<{ redirectUrl: string }>> {
  const rawEmail = formData.get('email') as string;
  const password = formData.get('password') as string;

  if (!rawEmail || !rawEmail.trim()) {
    return { success: false, error: 'Email or username is required' };
  }
  if (!password) {
    return { success: false, error: 'Password is required' };
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
  // This bypasses RLS and session cookie propagation delays immediately after signInWithPassword
  let profile: { id: string; full_name: string; role: 'OWNER' | 'ACCOUNTANT'; is_active: boolean } | null = null;
  let profileError: any = null;

  try {
    const admin = createAdminClient();
    const adminRes = await admin
      .from('profiles')
      .select('id, full_name, role, is_active')
      .eq('id', authData.user.id)
      .maybeSingle();

    profile = adminRes.data;
    profileError = adminRes.error;
  } catch (adminClientErr) {
    console.error('Error creating admin client:', adminClientErr);
    // Fallback to standard client
    const fallbackRes = await supabase
      .from('profiles')
      .select('id, full_name, role, is_active')
      .eq('id', authData.user.id)
      .maybeSingle();

    profile = fallbackRes.data;
    profileError = fallbackRes.error;
  }

  if (profileError) {
    console.error('Profile fetch error:', profileError);
    await supabase.auth.signOut();
    return {
      success: false,
      error: `Profile fetch error: ${profileError.message || 'Database error'}`,
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

  const role = profile.role;
  const redirectUrl = role === 'OWNER' ? '/approvals' : '/payments';

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
 * Owner-only action to create new team accounts (ACCOUNTANT or OWNER)
 */
export async function createUser(input: CreateUserInput): Promise<ActionResult<Profile>> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { success: false, error: 'Unauthorized. Please sign in.' };
  }

  const { data: callerProfile } = await supabase
    .from('profiles')
    .select('role, is_active')
    .eq('id', user.id)
    .single();

  if (!callerProfile || !callerProfile.is_active || callerProfile.role !== 'OWNER') {
    return { success: false, error: 'Only the OWNER can create team user accounts.' };
  }

  const parsed = createUserSchema.safeParse(input);
  if (!parsed.success) {
    const errorMsg = parsed.error.issues[0]?.message || 'Invalid user input';
    return { success: false, error: errorMsg };
  }

  const userData = parsed.data;
  const email = userData.email.trim().toLowerCase();

  const admin = createAdminClient();

  // Create auth user via Supabase Admin API
  const { data: authRecord, error: authError } = await admin.auth.admin.createUser({
    email,
    password: userData.password,
    email_confirm: true,
    user_metadata: {
      full_name: userData.full_name.trim(),
    },
  });

  if (authError || !authRecord.user) {
    return { success: false, error: authError?.message || 'Failed to create user in Auth.' };
  }

  // Insert profile row
  const { data: newProfile, error: profileError } = await admin
    .from('profiles')
    .insert({
      id: authRecord.user.id,
      full_name: userData.full_name.trim(),
      role: userData.role,
      is_active: true,
    })
    .select()
    .single();

  if (profileError || !newProfile) {
    // Rollback auth user if profile insertion failed
    await admin.auth.admin.deleteUser(authRecord.user.id);
    return {
      success: false,
      error: profileError?.message || 'Failed to create profile row.',
    };
  }

  revalidatePath('/settings');
  return { success: true, data: newProfile };
}

/**
 * Owner-only action to enable or disable team users
 */
export async function toggleUserActive(targetUserId: string): Promise<ActionResult<Profile>> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { success: false, error: 'Unauthorized. Please sign in.' };
  }

  if (user.id === targetUserId) {
    return { success: false, error: 'You cannot disable your own administrator account.' };
  }

  const { data: callerProfile } = await supabase
    .from('profiles')
    .select('role, is_active')
    .eq('id', user.id)
    .single();

  if (!callerProfile || !callerProfile.is_active || callerProfile.role !== 'OWNER') {
    return { success: false, error: 'Only the OWNER can manage user access.' };
  }

  const admin = createAdminClient();

  const { data: currentTarget } = await admin
    .from('profiles')
    .select('*')
    .eq('id', targetUserId)
    .single();

  if (!currentTarget) {
    return { success: false, error: 'User record not found.' };
  }

  const newStatus = !currentTarget.is_active;

  const { data: updated, error } = await admin
    .from('profiles')
    .update({
      is_active: newStatus,
      updated_at: new Date().toISOString(),
    })
    .eq('id', targetUserId)
    .select()
    .single();

  if (error || !updated) {
    return { success: false, error: error?.message || 'Failed to update user status.' };
  }

  revalidatePath('/settings');
  return { success: true, data: updated };
}
