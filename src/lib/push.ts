import * as webpush from 'web-push';
import { createAdminClient } from '@/lib/supabase/admin';

export interface PushPayload {
  title: string;
  body: string;
  url: string;
  priority?: 'urgent' | 'normal';
  actionLabel?: string;
  tag?: string;
}

/**
 * Dispatch PWA Web Push notifications to a list of user IDs.
 * Gracefully skips if VAPID keys are missing or invalid so builds & Server Actions never crash.
 * Automatically prunes expired/unsubscribed endpoints (HTTP 404 / 410).
 */
export async function sendPushToUsers(
  userIds: string[],
  payload: PushPayload
): Promise<void> {
  if (!userIds || userIds.length === 0) return;

  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY?.trim();
  const privateKey = process.env.VAPID_PRIVATE_KEY?.trim();
  const subject = process.env.VAPID_SUBJECT?.trim() || 'mailto:admin@indfurn.com';

  if (!publicKey || !privateKey) {
    console.warn(
      '[WebPush] NEXT_PUBLIC_VAPID_PUBLIC_KEY or VAPID_PRIVATE_KEY is not set. Skipping Web Push dispatch.'
    );
    return;
  }

  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.warn('[WebPush] SUPABASE_SERVICE_ROLE_KEY is missing. Skipping Web Push dispatch.');
    return;
  }

  try {
    webpush.setVapidDetails(subject, publicKey, privateKey);
  } catch (err) {
    console.warn('[WebPush] Invalid VAPID configuration:', err);
    return;
  }

  try {
    const admin = createAdminClient();
    const uniqueUserIds = Array.from(new Set(userIds));

    const [subsRes, unreadRes] = await Promise.all([
      admin
        .from('push_subscriptions')
        .select('id, user_id, endpoint, p256dh, auth')
        .in('user_id', uniqueUserIds),
      admin
        .from('notifications')
        .select('recipient_user_id')
        .eq('is_read', false)
        .in('recipient_user_id', uniqueUserIds),
    ]);

    const { data: subscriptions, error } = subsRes;
    if (error || !subscriptions || subscriptions.length === 0) {
      return;
    }

    const unreadCountByUser = new Map<string, number>();
    if (!unreadRes.error && unreadRes.data) {
      for (const row of unreadRes.data) {
        if (!row.recipient_user_id) continue;
        unreadCountByUser.set(
          row.recipient_user_id,
          (unreadCountByUser.get(row.recipient_user_id) ?? 0) + 1
        );
      }
    }

    const priority: 'urgent' | 'normal' =
      payload.priority === 'urgent' ? 'urgent' : 'normal';
    const actionLabel = payload.actionLabel || 'Open Desk';
    const payloadByUserId = new Map<string, string>();
    const staleEndpoints: string[] = [];

    const results = await Promise.allSettled(
      subscriptions.map(async (sub) => {
        try {
          let stringifiedPayload = payloadByUserId.get(sub.user_id);
          if (!stringifiedPayload) {
            const badgeCount = Math.max(1, unreadCountByUser.get(sub.user_id) ?? 1);
            stringifiedPayload = JSON.stringify({
              title: payload.title,
              body: payload.body,
              url: payload.url,
              priority,
              actionLabel,
              tag: payload.tag,
              badgeCount,
            });
            payloadByUserId.set(sub.user_id, stringifiedPayload);
          }

          await webpush.sendNotification(
            {
              endpoint: sub.endpoint,
              keys: {
                p256dh: sub.p256dh,
                auth: sub.auth,
              },
            },
            stringifiedPayload,
            {
              TTL: 86400,
              urgency: priority === 'urgent' ? 'high' : 'normal',
            }
          );
        } catch (pushErr: any) {
          const statusCode = pushErr?.statusCode;
          if (statusCode === 404 || statusCode === 410) {
            staleEndpoints.push(sub.endpoint);
          } else {
            console.warn('[WebPush] Delivery failed for endpoint:', statusCode || pushErr?.message);
          }
          throw pushErr;
        }
      })
    );

    void results;

    // Clean up expired / uninstalled endpoints
    if (staleEndpoints.length > 0) {
      await admin
        .from('push_subscriptions')
        .delete()
        .in('endpoint', staleEndpoints);
    }
  } catch (err) {
    console.warn('[WebPush] Unexpected dispatch error:', err);
  }
}
