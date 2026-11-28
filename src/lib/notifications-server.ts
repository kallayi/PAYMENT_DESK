import { createAdminClient } from '@/lib/supabase/admin';
import { sendPushToUsers } from '@/lib/push';
import { formatINR } from '@/lib/format';
import type { NotificationEvent } from '@/types/database';

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
 * Internal server-side workflow notification dispatcher (NEVER exported as a Server Action).
 * Trigger Matrix:
 *   - SUBMITTED_FOR_VERIFICATION -> active VERIFIER users for companyId (/verify)
 *   - VERIFIED_FOR_APPROVAL      -> active APPROVER users for companyId (/approvals)
 *   - APPROVED / HELD / REJECTED -> entry creator + active PREPARER users for companyId (/payments)
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
    let priority: 'urgent' | 'normal' = 'normal';
    let actionLabel = 'Open Desk';
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
        priority = 'urgent';
        actionLabel = 'Verify Bill';
        break;
      case 'VERIFIED_FOR_APPROVAL':
        targetRole = 'APPROVER';
        targetUrl = highlightSuffix ? `/approvals?${highlightSuffix}` : '/approvals';
        defaultTitle = `[${companyCode}] Ready for Approval`;
        defaultBody = `${input.partyName} · ${formattedAmount} verified and awaiting approval.`;
        priority = 'urgent';
        actionLabel = 'Review & Approve';
        break;
      case 'APPROVED':
        targetRole = 'PREPARER';
        targetUrl = highlightSuffix
          ? `/payments?tab=APPROVED&${highlightSuffix}`
          : '/payments?tab=APPROVED';
        defaultTitle = `[${companyCode}] Payment Approved — Ready to Pay`;
        defaultBody = `${input.partyName} · ${formattedAmount} approved — Ready to Pay.`;
        priority = 'normal';
        actionLabel = 'Ready to Pay';
        break;
      case 'HELD':
        targetRole = 'PREPARER';
        targetUrl = highlightSuffix
          ? `/payments?tab=ON_HOLD&${highlightSuffix}`
          : '/payments?tab=ON_HOLD';
        defaultTitle = `[${companyCode}] Payment Placed on Hold`;
        defaultBody = `${input.partyName} · ${formattedAmount} was placed on hold.`;
        priority = 'normal';
        actionLabel = 'View Held Bill';
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
        priority = 'urgent';
        actionLabel = 'Fix Returned Bill';
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

    const pushTag = input.paymentItemId
      ? `pd-${input.eventType.toLowerCase()}-${input.paymentItemId}`
      : undefined;

    await Promise.race([
      sendPushToUsers(recipientIds, {
        title,
        body,
        url: targetUrl,
        priority,
        actionLabel,
        tag: pushTag,
      }),
      new Promise<void>((resolve) => setTimeout(resolve, 2500)),
    ]);
  } catch (err) {
    console.warn('[Notifications] Non-blocking dispatch failed:', err);
  }
}
