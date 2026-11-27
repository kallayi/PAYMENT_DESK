'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import {
  Bell,
  BellRing,
  CheckCheck,
  Loader2,
  X,
  ChevronRight,
  Clock,
  CalendarClock,
} from 'lucide-react';
import { toast } from 'sonner';
import { createClient } from '@/lib/supabase/client';
import {
  markNotificationRead,
  markAllNotificationsRead,
} from '@/actions/notifications';
import { switchActiveCompany } from '@/actions/company';
import type { Company, Notification, NotificationEvent } from '@/types/database';

interface NotificationBellProps {
  userId: string;
  initialNotifications: Notification[];
  initialUnreadCount: number;
  allowedCompanies?: Company[];
  activeCompanyId?: string | null;
}

type ActionableNotification = Notification & {
  action_url?: string | null;
  link?: string | null;
  type?: string | null;
  payment_id?: string | null;
};

function appendHighlightParam(url: string, paymentId: string | null | undefined): string {
  if (!paymentId) return url;
  if (url.includes('highlight=')) return url;
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}highlight=${encodeURIComponent(paymentId)}`;
}

function resolveNotificationTargetUrl(item: ActionableNotification): string {
  const paymentId = item.payment_item_id || item.payment_id || null;
  const requestId = item.payment_request_id || null;
  const directUrl = (item.action_url || item.link || '').trim();
  if (directUrl) {
    if (directUrl.startsWith('/requests')) {
      return appendHighlightParam(directUrl, requestId || paymentId);
    }
    return appendHighlightParam(directUrl, paymentId);
  }

  const eventKey = String(item.event_type || item.type || '').toUpperCase();
  const titleLower = (item.title || '').toLowerCase();

  let baseUrl = '/';
  switch (eventKey as NotificationEvent) {
    case 'SUBMITTED_FOR_VERIFICATION':
      baseUrl = '/verify';
      break;
    case 'VERIFIED_FOR_APPROVAL':
      baseUrl = '/approvals';
      break;
    case 'APPROVED':
      baseUrl = '/payments?tab=APPROVED';
      break;
    case 'HELD':
      baseUrl = '/payments?tab=ON_HOLD';
      break;
    case 'REJECTED':
      baseUrl = '/payments?tab=REJECTED';
      break;
    case 'REMINDER_DUE':
      baseUrl = '/reminders';
      break;
    case 'PAYMENT_REQUEST_CREATED':
    case 'PAYMENT_REQUEST_DECLINED':
      return appendHighlightParam('/requests', requestId || paymentId);
    case 'PAYMENT_REQUEST_SUBMITTED':
      return appendHighlightParam('/tracker', paymentId);
    case 'BATCH_SETTLED':
      baseUrl = '/audit';
      break;
    default:
      if (titleLower.includes('payment request')) {
        return appendHighlightParam('/requests', requestId || paymentId);
      } else if (titleLower.includes('verification')) baseUrl = '/verify';
      else if (titleLower.includes('for approval')) baseUrl = '/approvals';
      else if (titleLower.includes('approved') || titleLower.includes('ready to pay'))
        baseUrl = '/payments?tab=APPROVED';
      else if (titleLower.includes('hold')) baseUrl = '/payments?tab=ON_HOLD';
      else if (titleLower.includes('reject') || titleLower.includes('return'))
        baseUrl = '/payments?tab=REJECTED';
      else if (titleLower.includes('paid') || titleLower.includes('settled'))
        baseUrl = '/history';
      else baseUrl = '/';
  }

  return appendHighlightParam(baseUrl, paymentId);
}

function formatRelativeTime(isoString: string): string {
  try {
    const diffMs = Date.now() - new Date(isoString).getTime();
    const diffMin = Math.max(0, Math.floor(diffMs / 60000));
    if (diffMin < 1) return 'Just now';
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHr = Math.floor(diffMin / 60);
    if (diffHr < 24) return `${diffHr}h ago`;
    const diffDays = Math.floor(diffHr / 24);
    if (diffDays < 7) return `${diffDays}d ago`;
    return new Date(isoString).toLocaleDateString('en-IN', {
      day: '2-digit',
      month: 'short',
    });
  } catch {
    return '';
  }
}

const PUSH_STATE_EVENT = 'payment-desk-push-changed';
const PUSH_BANNER_DISMISSED_KEY = 'payment-desk-push-banner-dismissed';

function playNotificationChime() {
  try {
    if (typeof window === 'undefined') return;
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;

    const ctx = new AudioCtx();
    if (ctx.state === 'suspended') {
      void ctx.resume().catch(() => { });
    }

    const now = ctx.currentTime;
    const notes = [
      { freq: 659.25, start: 0, duration: 0.14 }, // E5
      { freq: 880.0, start: 0.11, duration: 0.22 }, // A5
    ];

    notes.forEach((n) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(n.freq, now + n.start);

      gain.gain.setValueAtTime(0.0001, now + n.start);
      gain.gain.exponentialRampToValueAtTime(0.07, now + n.start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + n.start + n.duration);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + n.start);
      osc.stop(now + n.start + n.duration + 0.02);
    });

    window.setTimeout(() => {
      void ctx.close().catch(() => { });
    }, 600);
  } catch {
    // Autoplay policies or unavailable AudioContext should never break notifications
  }
}

function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const buffer = new ArrayBuffer(rawData.length);
  const outputArray = new Uint8Array(buffer);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

async function syncSubscriptionToServer(
  subscription: globalThis.PushSubscription
): Promise<{ ok: true } | { ok: false; error: string }> {
  const subJson = subscription.toJSON();
  if (!subJson.endpoint || !subJson.keys?.p256dh || !subJson.keys?.auth) {
    return { ok: false, error: 'Could not retrieve browser push subscription keys.' };
  }

  const res = await fetch('/api/push/subscribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      endpoint: subJson.endpoint,
      keys: {
        p256dh: subJson.keys.p256dh,
        auth: subJson.keys.auth,
      },
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Subscription failed' }));
    return { ok: false, error: err.error || 'Failed to register push subscription.' };
  }

  return { ok: true };
}

function isPushServiceAbortError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  return (
    err.name === 'AbortError' ||
    /push service error/i.test(err.message) ||
    /registration failed/i.test(err.message)
  );
}

async function subscribeDeviceToPush(): Promise<{ ok: true } | { ok: false; error: string }> {
  const vapidPublicKey = (process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || '').trim();
  if (!vapidPublicKey) {
    return {
      ok: false,
      error: 'Push notifications require NEXT_PUBLIC_VAPID_PUBLIC_KEY to be configured.',
    };
  }

  await navigator.serviceWorker.register('/sw.js');
  const reg = await navigator.serviceWorker.ready;

  const permission = await window.Notification.requestPermission();
  if (permission !== 'granted') {
    return { ok: false, error: 'Browser notification permission was denied.' };
  }

  const applicationServerKey = urlBase64ToUint8Array(vapidPublicKey);
  const existing = await reg.pushManager.getSubscription();

  // First try syncing an existing browser subscription to avoid unnecessary churn
  if (existing) {
    const syncExistingRes = await syncSubscriptionToServer(existing);
    if (syncExistingRes.ok) {
      return { ok: true };
    }
    await existing.unsubscribe().catch(() => {});
  }

  let subscription: globalThis.PushSubscription | null = null;
  try {
    subscription = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey,
    });
  } catch (err) {
    if (!isPushServiceAbortError(err)) {
      throw err;
    }

    // Clear any stale subscription, pause 500ms, and retry push registration once
    const stale = await reg.pushManager.getSubscription();
    if (stale) {
      await stale.unsubscribe().catch(() => {});
    }
    await new Promise((resolve) => setTimeout(resolve, 500));

    try {
      subscription = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey,
      });
    } catch (retryErr) {
      if (isPushServiceAbortError(retryErr)) {
        return {
          ok: false,
          error:
            "Push blocked by browser or temporary network. On Brave, enable 'Google services for push messaging' in Settings, or tap Retry.",
        };
      }
      throw retryErr;
    }
  }

  return syncSubscriptionToServer(subscription);
}

function usePushStatus() {
  const [isSecureContext, setIsSecureContext] = React.useState<boolean>(true);
  const [pushSupported, setPushSupported] = React.useState<boolean>(false);
  const [isPushEnabled, setIsPushEnabled] = React.useState<boolean>(false);
  const [permissionState, setPermissionState] = React.useState<NotificationPermission>('default');
  const [hasChecked, setHasChecked] = React.useState<boolean>(false);

  const refreshPushState = React.useCallback(() => {
    if (typeof window === 'undefined') return;

    const secure = window.isSecureContext;
    setIsSecureContext(secure);

    if (
      !secure ||
      !('serviceWorker' in navigator) ||
      !('PushManager' in window) ||
      !('Notification' in window)
    ) {
      setPushSupported(false);
      setIsPushEnabled(false);
      setHasChecked(true);
      return;
    }

    setPushSupported(true);
    setPermissionState(window.Notification.permission);

    navigator.serviceWorker
      .getRegistration('/sw.js')
      .then((reg) => (reg ? reg.pushManager.getSubscription() : null))
      .then((sub) => {
        setIsPushEnabled(Boolean(sub) && window.Notification.permission === 'granted');
      })
      .catch(() => {
        setIsPushEnabled(false);
      })
      .finally(() => {
        setHasChecked(true);
      });
  }, []);

  React.useEffect(() => {
    refreshPushState();
    const handleSync = () => refreshPushState();
    window.addEventListener(PUSH_STATE_EVENT, handleSync);
    return () => window.removeEventListener(PUSH_STATE_EVENT, handleSync);
  }, [refreshPushState]);

  return {
    isSecureContext,
    pushSupported,
    isPushEnabled,
    permissionState,
    hasChecked,
    setIsPushEnabled,
  };
}

export function PushOptInBanner() {
  const { isSecureContext, pushSupported, isPushEnabled, permissionState, hasChecked, setIsPushEnabled } =
    usePushStatus();
  const [isDismissed, setIsDismissed] = React.useState<boolean>(true);
  const [isEnabling, setIsEnabling] = React.useState<boolean>(false);

  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    setIsDismissed(window.sessionStorage.getItem(PUSH_BANNER_DISMISSED_KEY) === '1');
  }, []);

  if (
    !hasChecked ||
    !isSecureContext ||
    !pushSupported ||
    isPushEnabled ||
    permissionState === 'denied' ||
    isDismissed
  ) {
    return null;
  }

  const handleEnable = async () => {
    setIsEnabling(true);
    try {
      const result = await subscribeDeviceToPush();
      if (!result.ok) {
        toast.error(result.error, { duration: 7000 });
        window.dispatchEvent(new Event(PUSH_STATE_EVENT));
        return;
      }
      setIsPushEnabled(true);
      window.dispatchEvent(new Event(PUSH_STATE_EVENT));
      toast.success('Lock-screen alerts enabled on this device!');
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to enable push alerts.');
    } finally {
      setIsEnabling(false);
    }
  };

  const handleDismiss = () => {
    setIsDismissed(true);
    try {
      window.sessionStorage.setItem(PUSH_BANNER_DISMISSED_KEY, '1');
    } catch {
      // Ignore storage errors
    }
  };

  return (
    <div className="mb-4 px-3.5 py-2.5 rounded-xl border border-amber-200 bg-amber-50/80 shadow-sm flex items-center justify-between gap-2.5">
      <div className="flex items-center gap-2.5 min-w-0">
        <span className="w-7 h-7 rounded-lg bg-[#7F1D1D]/10 text-[#7F1D1D] flex items-center justify-center shrink-0">
          <BellRing className="w-4 h-4" />
        </span>
        <p className="text-xs font-medium text-slate-800 leading-snug">
          Get instant lock-screen alerts even when Payment Desk is closed.
        </p>
      </div>

      <div className="flex items-center gap-1.5 shrink-0">
        <button
          type="button"
          onClick={handleEnable}
          disabled={isEnabling}
          className="min-h-[32px] px-3 py-1 rounded-lg bg-brand hover:bg-brand-hover text-white text-xs font-semibold inline-flex items-center gap-1.5 shadow-sm transition-colors cursor-pointer disabled:opacity-60"
        >
          {isEnabling ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <BellRing className="w-3.5 h-3.5" />
          )}
          <span>{isEnabling ? 'Enabling...' : 'Enable Alerts'}</span>
        </button>

        <button
          type="button"
          onClick={handleDismiss}
          aria-label="Dismiss lock-screen alerts banner"
          className="min-h-[32px] min-w-[32px] rounded-lg text-slate-400 hover:text-slate-700 hover:bg-amber-100/70 inline-flex items-center justify-center transition-colors cursor-pointer"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}

export function NotificationBell({
  userId,
  initialNotifications,
  initialUnreadCount,
  allowedCompanies = [],
  activeCompanyId = null,
}: NotificationBellProps) {
  const router = useRouter();
  const [, startTransition] = React.useTransition();
  const [isOpen, setIsOpen] = React.useState<boolean>(false);
  const [notifications, setNotifications] =
    React.useState<Notification[]>(initialNotifications);
  const [unreadCount, setUnreadCount] = React.useState<number>(initialUnreadCount);
  const [isMarkingAll, setIsMarkingAll] = React.useState<boolean>(false);

  const companyById = React.useMemo(
    () => new Map(allowedCompanies.map((c) => [c.id, c])),
    [allowedCompanies]
  );

  // Web Push opt-in status
  const { isSecureContext, pushSupported, isPushEnabled, setIsPushEnabled } = usePushStatus();
  const [isTogglingPush, setIsTogglingPush] = React.useState<boolean>(false);
  const [isSendingTest, setIsSendingTest] = React.useState<boolean>(false);

  const containerRef = React.useRef<HTMLDivElement | null>(null);

  React.useEffect(() => {
    setNotifications(initialNotifications);
    setUnreadCount(initialUnreadCount);
  }, [initialNotifications, initialUnreadCount]);

  // Lightweight Supabase Realtime subscription for live unread updates
  React.useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`notifications-live-${userId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'notifications',
          filter: `recipient_user_id=eq.${userId}`,
        },
        (payload) => {
          const newNotif = payload.new as Notification;
          if (!newNotif?.id) return;
          setNotifications((prev) => [newNotif, ...prev].slice(0, 25));
          setUnreadCount((prev) => prev + 1);
          playNotificationChime();
          toast.info(newNotif.title, { description: newNotif.body });
          startTransition(() => {
            router.refresh();
          });
        }
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [userId, router]);

  // Close popover when clicking outside
  React.useEffect(() => {
    if (!isOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  const handleTogglePush = async () => {
    if (!pushSupported) {
      toast.error('Push notifications are not supported on this browser.');
      return;
    }

    setIsTogglingPush(true);
    try {
      if (isPushEnabled) {
        const reg = await navigator.serviceWorker.register('/sw.js');
        await navigator.serviceWorker.ready;
        const sub = await reg.pushManager.getSubscription();
        if (sub) {
          await fetch('/api/push/subscribe', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ endpoint: sub.endpoint }),
          });
          await sub.unsubscribe();
        }
        setIsPushEnabled(false);
        window.dispatchEvent(new Event(PUSH_STATE_EVENT));
        toast.success('Push alerts disabled for this device.');
        return;
      }

      const result = await subscribeDeviceToPush();
      if (!result.ok) {
        toast.error(result.error, { duration: 7000 });
        window.dispatchEvent(new Event(PUSH_STATE_EVENT));
        return;
      }

      setIsPushEnabled(true);
      window.dispatchEvent(new Event(PUSH_STATE_EVENT));
      toast.success('Push alerts enabled on this device!');
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to configure push alerts.');
    } finally {
      setIsTogglingPush(false);
    }
  };

  const handleSendTestPush = async () => {
    setIsSendingTest(true);
    try {
      const res = await fetch('/api/push/test', { method: 'POST' });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(body.error || 'Failed to send test alert.');
        return;
      }
      toast.success('Test alert sent! Check your device notification tray.');
    } catch {
      toast.error('Network error while sending test alert.');
    } finally {
      setIsSendingTest(false);
    }
  };

  const handleNotificationClick = async (item: ActionableNotification) => {
    setIsOpen(false);
    const targetUrl = resolveNotificationTargetUrl(item);

    if (!item.is_read) {
      setNotifications((prev) =>
        prev.map((n) => (n.id === item.id ? { ...n, is_read: true } : n))
      );
      setUnreadCount((prev) => Math.max(0, prev - 1));
      void markNotificationRead(item.id);
    }

    if (item.company_id && activeCompanyId && item.company_id !== activeCompanyId) {
      try {
        const res = await switchActiveCompany(item.company_id);
        if (res.success) {
          toast.success(`Switched workspace to ${res.data.name}`);
          router.push(targetUrl);
          router.refresh();
          return;
        }
      } catch {
        // Fall back to direct navigation
      }
    }

    router.push(targetUrl);
  };

  const handleMarkAllRead = async () => {
    if (unreadCount === 0) return;

    const prevNotifs = notifications;
    const prevCount = unreadCount;

    setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })));
    setUnreadCount(0);
    setIsMarkingAll(true);

    try {
      const res = await markAllNotificationsRead();
      if (!res.success) {
        setNotifications(prevNotifs);
        setUnreadCount(prevCount);
        toast.error(res.error || 'Failed to mark all as read.');
      }
    } catch {
      setNotifications(prevNotifs);
      setUnreadCount(prevCount);
    } finally {
      setIsMarkingAll(false);
    }
  };

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        aria-label="Open notifications"
        className="relative min-h-[40px] min-w-[40px] px-2 rounded-lg text-slate-600 hover:text-slate-900 hover:bg-slate-100 inline-flex items-center justify-center transition-colors cursor-pointer"
      >
        <Bell className="w-4 h-4" />
        {unreadCount > 0 && (
          <span className="absolute top-1 right-1 min-w-[16px] h-4 px-1 rounded-full bg-[#7F1D1D] text-white text-[10px] font-bold tabular-nums flex items-center justify-center shadow-sm">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {isOpen && (
        <div className="fixed inset-x-3 top-16 w-auto sm:absolute sm:inset-x-auto sm:right-0 sm:top-auto sm:mt-2 sm:w-96 max-h-[calc(100dvh-5.5rem)] flex flex-col rounded-xl border border-slate-200 bg-white shadow-xl z-50 overflow-hidden animate-in fade-in-50 zoom-in-95">
          {/* Header */}
          <div className="px-4 py-3 border-b border-slate-200 bg-slate-50/70 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-slate-900">Workflow Alerts</span>
              {unreadCount > 0 && (
                <span className="px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-[#7F1D1D] text-white tabular-nums">
                  {unreadCount} new
                </span>
              )}
            </div>

            <div className="flex items-center gap-2">
              {unreadCount > 0 && (
                <button
                  type="button"
                  onClick={handleMarkAllRead}
                  disabled={isMarkingAll}
                  className="text-[11px] font-semibold text-brand hover:underline inline-flex items-center gap-1 cursor-pointer"
                >
                  <CheckCheck className="w-3.5 h-3.5" />
                  <span>Mark all read</span>
                </button>
              )}
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="p-1 text-slate-400 hover:text-slate-700 rounded"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* Push Opt-in Strip */}
          {!isSecureContext ? (
            <div className="px-4 py-2 border-b border-slate-100 bg-amber-50/50 text-[11px] text-amber-800">
              Open via HTTPS (Live link) to enable lock-screen alerts.
            </div>
          ) : (
            pushSupported && (
              <div className="px-4 py-2 border-b border-slate-100 bg-white flex items-center justify-between gap-2 text-[11px]">
                <span className="text-slate-500 truncate">
                  {isPushEnabled ? 'Device push alerts active' : 'Get instant mobile/desktop alerts'}
                </span>
                <div className="flex items-center gap-1.5 shrink-0">
                  {isPushEnabled && (
                    <button
                      type="button"
                      onClick={handleSendTestPush}
                      disabled={isSendingTest}
                      className="px-2 py-1 rounded-md font-semibold border border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100 inline-flex items-center gap-1 transition-colors cursor-pointer disabled:opacity-60"
                    >
                      {isSendingTest && <Loader2 className="w-3 h-3 animate-spin" />}
                      <span>{isSendingTest ? 'Sending...' : 'Send Test'}</span>
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={handleTogglePush}
                    disabled={isTogglingPush}
                    className={`px-2.5 py-1 rounded-md font-semibold inline-flex items-center gap-1 transition-colors cursor-pointer ${isPushEnabled
                      ? 'bg-emerald-50 text-emerald-800 border border-emerald-200 hover:bg-emerald-100'
                      : 'bg-brand text-white hover:bg-brand-hover'
                      }`}
                  >
                    {isTogglingPush ? (
                      <Loader2 className="w-3 h-3 animate-spin" />
                    ) : (
                      <BellRing className="w-3 h-3" />
                    )}
                    <span>{isPushEnabled ? 'Push Enabled' : 'Enable Push Alerts'}</span>
                  </button>
                </div>
              </div>
            )
          )}

          {/* Notifications List */}
          <div className="max-h-80 overflow-y-auto divide-y divide-slate-100">
            {notifications.length === 0 ? (
              <div className="p-8 text-center">
                <Bell className="w-7 h-7 text-slate-300 mx-auto mb-1.5" />
                <p className="text-xs font-semibold text-slate-700">All caught up</p>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  Workflow alerts for submissions, verifications, and approvals appear here.
                </p>
              </div>
            ) : (
              notifications.map((item) => {
                const notifCompany = item.company_id ? companyById.get(item.company_id) : undefined;
                const isVinmoreCompany = notifCompany?.code?.toUpperCase() === 'VINMORE';

                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => handleNotificationClick(item)}
                    className={`w-full text-left px-4 py-3 hover:bg-slate-50 transition-colors flex items-start gap-2.5 cursor-pointer ${!item.is_read ? 'bg-brand-tint/70' : 'bg-white'
                      }`}
                  >
                    {item.event_type === 'REMINDER_DUE' ? (
                      <span
                        className={`mt-0.5 w-6 h-6 rounded-full flex items-center justify-center shrink-0 ${!item.is_read
                          ? 'bg-amber-100 text-amber-800 border border-amber-200'
                          : 'bg-slate-100 text-slate-500'
                          }`}
                      >
                        <CalendarClock className="w-3.5 h-3.5" />
                      </span>
                    ) : (
                      <span
                        className={`mt-1.5 w-2 h-2 rounded-full shrink-0 ${!item.is_read ? 'bg-brand' : 'bg-slate-200'
                          }`}
                      />
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-1.5 min-w-0">
                          {notifCompany && (
                            <span
                              className={`text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded shrink-0 ${isVinmoreCompany
                                ? 'bg-teal-50 text-teal-800 border border-teal-200'
                                : 'bg-rose-50 text-[#7F1D1D] border border-rose-200'
                                }`}
                            >
                              {notifCompany.code}
                            </span>
                          )}
                          <span
                            className={`text-xs truncate ${!item.is_read
                              ? 'font-bold text-slate-900'
                              : 'font-medium text-slate-700'
                              }`}
                          >
                            {item.title}
                          </span>
                        </div>
                        <span className="text-[10px] text-slate-400 shrink-0 inline-flex items-center gap-0.5">
                          <Clock className="w-2.5 h-2.5" />
                          {formatRelativeTime(item.created_at)}
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-600 mt-0.5 line-clamp-2 leading-snug">
                        {item.body}
                      </p>
                    </div>
                    <ChevronRight className="w-3.5 h-3.5 text-slate-300 shrink-0 mt-1" />
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
