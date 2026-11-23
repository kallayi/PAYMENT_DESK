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

  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error || !data.user) {
    return { success: false, error: error?.message || 'Invalid username/email or password.' };
  }

  // Check if profile is active and fetch role
  const profileRes = await supabase
    .from('profiles')
    .select('role, is_active')
    .eq('id', data.user.id)
    .single();

  if (profileRes.error || !profileRes.data) {
    await supabase.auth.signOut();
    return {
      success: false,
      error: 'User profile not found. Please contact the administrator.',
    };
  }

  const profile = profileRes.data;

  if (!profile.is_active) {
    await supabase.auth.signOut();
    return {
      success: false,
      error: 'This account has been disabled. Please contact the administrator.',
    };
  }

  const role = profile.role;
  const redirectUrl =
    role === 'OWNER'
      ? '/approvals'
      : role === 'ACCOUNTANT'
        ? '/payments'
        : '/bills';

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
 * Owner-only action to create new team accounts (STAFF or ACCOUNTANT)
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
