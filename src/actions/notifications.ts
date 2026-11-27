'use server';

import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { getCurrentUserContext } from '@/lib/auth';
import type { ActionResult, Notification } from '@/types/database';

const uuidSchema = z.string().uuid('Valid notification ID is required.');

/**
 * Fetch the logged-in user's recent in-app notifications and unread count.
 * Strictly scoped to recipient_user_id = user.id.
 */
export async function getMyNotifications(
  limit: number = 25
): Promise<ActionResult<{ notifications: Notification[]; unreadCount: number }>> {
  const supabase = await createClient();
  const { user, profile } = await getCurrentUserContext();

  if (!user || !profile || !profile.is_active) {
    return { success: false, error: 'Unauthorized. Please sign in.' };
  }

  const safeLimit = Math.min(Math.max(1, Number(limit) || 25), 50);

  const [listRes, countRes] = await Promise.all([
    supabase
      .from('notifications')
      .select('id, company_id, recipient_user_id, payment_item_id, payment_request_id, action_url, event_type, title, body, is_read, created_at')
      .eq('recipient_user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(safeLimit),
    supabase
      .from('notifications')
      .select('id', { count: 'exact', head: true })
      .eq('recipient_user_id', user.id)
      .eq('is_read', false),
  ]);

  if (listRes.error) {
    return { success: false, error: listRes.error.message || 'Failed to load notifications.' };
  }

  return {
    success: true,
    data: {
      notifications: (listRes.data || []) as Notification[],
      unreadCount: countRes.count || 0,
    },
  };
}

/**
 * Mark a single notification as read (strictly scoped to recipient_user_id = user.id).
 */
export async function markNotificationRead(
  notificationId: string
): Promise<ActionResult<undefined>> {
  const parsed = uuidSchema.safeParse(notificationId);
  if (!parsed.success) {
    return { success: false, error: 'Invalid notification ID.' };
  }

  const supabase = await createClient();
  const { user, profile } = await getCurrentUserContext();

  if (!user || !profile || !profile.is_active) {
    return { success: false, error: 'Unauthorized. Please sign in.' };
  }

  const { error } = await supabase
    .from('notifications')
    .update({ is_read: true })
    .eq('id', notificationId)
    .eq('recipient_user_id', user.id);

  if (error) {
    return { success: false, error: error.message || 'Failed to mark notification read.' };
  }

  return { success: true, data: undefined };
}

/**
 * Mark all notifications as read for the logged-in user.
 */
export async function markAllNotificationsRead(): Promise<ActionResult<undefined>> {
  const supabase = await createClient();
  const { user, profile } = await getCurrentUserContext();

  if (!user || !profile || !profile.is_active) {
    return { success: false, error: 'Unauthorized. Please sign in.' };
  }

  const { error } = await supabase
    .from('notifications')
    .update({ is_read: true })
    .eq('recipient_user_id', user.id)
    .eq('is_read', false);

  if (error) {
    return { success: false, error: error.message || 'Failed to mark all notifications read.' };
  }

  return { success: true, data: undefined };
}
