'use server';

import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getCurrentUserContext } from '@/lib/auth';
import { sendPushToUsers } from '@/lib/push';
import { formatINR } from '@/lib/format';
import type { ActionResult, Notification, NotificationEvent } from '@/types/database';

const uuidSchema = z.string().uuid('Valid notification ID is required.');

export interface DispatchWorkflowNotificationInput {
  companyId: string;
  paymentItemId: string | null;
  eventType: NotificationEvent;
  actorId: string;
  partyName: string;
  netPayable: number;
  reason?: string | null;
  createdById?: string | null;
  createdByIds?: string[];
  customTitle?: string;
  customBody?: string;
}

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

/**
 * Internal server-side workflow notification dispatcher.
 * Trigger Matrix:
 *   - SUBMITTED_FOR_VERIFICATION -> active VERIFIER users for companyId (/verify)
 *   - VERIFIED_FOR_APPROVAL      -> active APPROVER users for companyId (/approvals)
 *   - APPROVED / HELD / REJECTED -> entry creator + active PREPARER users for companyId (/payments)
 *   - NEVER called on PAID or Audited.
 */
export async function dispatchWorkflowNotification(
  input: DispatchWorkflowNotificationInput
): Promise<void> {
  try {
    if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
      console.warn('[Notifications] SUPABASE_SERVICE_ROLE_KEY missing; skipping workflow notification.');
      return;
    }

    const admin = createAdminClient();

    // Fetch company code, active profiles, and company access list concurrently via service-role client
    const [companyRes, profilesRes, accessRes] = await Promise.all([
      admin
        .from('companies')
        .select('code, name')
        .eq('id', input.companyId)
        .maybeSingle(),
      admin
        .from('profiles')
        .select('id, role, is_admin, is_active')
        .eq('is_active', true),
      admin
        .from('user_company_access')
        .select('user_id')
        .eq('company_id', input.companyId),
    ]);

    if (profilesRes.error) {
      console.warn('[Notifications] Profiles query error:', profilesRes.error.message);
    }
    if (accessRes.error) {
      console.warn('[Notifications] Company access query error:', accessRes.error.message);
    }

    const companyCode = companyRes.data?.code || 'DESK';
    const activeProfiles = profilesRes.data || [];
    const companyUserIds = new Set((accessRes.data || []).map((row) => row.user_id));
    const creatorIdSet = new Set<string>(
      [input.createdById, ...(input.createdByIds || [])].filter(
        (id): id is string => Boolean(id)
      )
    );

    const hasCompanyAccess = (p: { id: string; is_admin: boolean }) =>
      p.is_admin || companyUserIds.has(p.id);

    let targetRole: 'VERIFIER' | 'APPROVER' | 'PREPARER';
    let targetUrl: string;
    let defaultTitle: string;
    let defaultBody: string;
    const formattedAmount = formatINR(input.netPayable);

    const highlightSuffix =
      input.paymentItemId && !input.customTitle
        ? `highlight=${encodeURIComponent(input.paymentItemId)}`
        : '';

    switch (input.eventType) {
      case 'SUBMITTED_FOR_VERIFICATION':
        targetRole = 'VERIFIER';
        targetUrl = highlightSuffix ? `/verify?${highlightSuffix}` : '/verify';
        defaultTitle = `[${companyCode}] Pending Verification`;
        defaultBody = `${input.partyName} · ${formattedAmount} submitted for verification.`;
        break;
      case 'VERIFIED_FOR_APPROVAL':
        targetRole = 'APPROVER';
        targetUrl = highlightSuffix ? `/approvals?${highlightSuffix}` : '/approvals';
        defaultTitle = `[${companyCode}] Ready for Approval`;
        defaultBody = `${input.partyName} · ${formattedAmount} verified and awaiting approval.`;
        break;
      case 'APPROVED':
        targetRole = 'PREPARER';
        targetUrl = highlightSuffix
          ? `/payments?tab=APPROVED&${highlightSuffix}`
          : '/payments?tab=APPROVED';
        defaultTitle = `[${companyCode}] Payment Approved — Ready to Pay`;
        defaultBody = `${input.partyName} · ${formattedAmount} approved — Ready to Pay.`;
        break;
      case 'HELD':
        targetRole = 'PREPARER';
        targetUrl = highlightSuffix
          ? `/payments?tab=ON_HOLD&${highlightSuffix}`
          : '/payments?tab=ON_HOLD';
        defaultTitle = `[${companyCode}] Payment Placed on Hold`;
        defaultBody = `${input.partyName} · ${formattedAmount} was placed on hold.`;
        break;
      case 'REJECTED':
        targetRole = 'PREPARER';
        targetUrl = highlightSuffix
          ? `/payments?tab=REJECTED&${highlightSuffix}`
          : '/payments?tab=REJECTED';
        defaultTitle = `[${companyCode}] Payment Returned / Rejected`;
        defaultBody = `${input.partyName} · ${formattedAmount} was rejected${
          input.reason ? `: "${input.reason}"` : '.'
        }`;
        break;
      default:
        return;
    }

    const title = input.customTitle || defaultTitle;
    const body = input.customBody || defaultBody;

    const recipientIdSet = new Set<string>();
    for (const p of activeProfiles) {
      if (p.id === input.actorId) continue;

      if (targetRole === 'PREPARER') {
        const isCompanyPreparer = p.role === 'PREPARER' && hasCompanyAccess(p);
        const isCreator = creatorIdSet.has(p.id);
        if (isCompanyPreparer || isCreator) {
          recipientIdSet.add(p.id);
        }
      } else if (hasCompanyAccess(p) && p.role === targetRole) {
        recipientIdSet.add(p.id);
      }
    }

    const recipientIds = Array.from(recipientIdSet);
    if (recipientIds.length === 0) {
      return;
    }

    const rowsToInsert = recipientIds.map((recipientId) => ({
      company_id: input.companyId,
      recipient_user_id: recipientId,
      payment_item_id: input.paymentItemId,
      event_type: input.eventType,
      title,
      body,
      is_read: false,
    }));

    const { error: insertError } = await admin
      .from('notifications')
      .insert(rowsToInsert);

    if (insertError) {
      console.warn('[Notifications] Insert error:', insertError.message);
    }

    // Dispatch Web Push without crashing or blocking if push fails
    await Promise.race([
      sendPushToUsers(recipientIds, { title, body, url: targetUrl }),
      new Promise<void>((resolve) => setTimeout(resolve, 2500)),
    ]);
  } catch (err) {
    console.warn('[Notifications] Non-blocking dispatch failed:', err);
  }
}
