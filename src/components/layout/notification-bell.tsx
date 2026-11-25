'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import {
  Bell,
  BellRing,
  CheckCheck,
  Loader2,
  X,
  ArrowRight,
  Clock,
} from 'lucide-react';
import { toast } from 'sonner';
import { createClient } from '@/lib/supabase/client';
import {
  markNotificationRead,
  markAllNotificationsRead,
} from '@/actions/notifications';
import type { Notification, NotificationEvent } from '@/types/database';

interface NotificationBellProps {
  userId: string;
  initialNotifications: Notification[];
  initialUnreadCount: number;
}

function getTargetRouteForEvent(eventType: NotificationEvent): string {
  switch (eventType) {
    case 'SUBMITTED_FOR_VERIFICATION':
      return '/verify';
    case 'VERIFIED_FOR_APPROVAL':
      return '/approvals';
    case 'APPROVED':
    case 'HELD':
    case 'REJECTED':
      return '/payments';
    default:
      return '/';
  }
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

export function NotificationBell({
  userId,
  initialNotifications,
  initialUnreadCount,
}: NotificationBellProps) {
  const router = useRouter();
  const [isOpen, setIsOpen] = React.useState<boolean>(false);
  const [notifications, setNotifications] =
    React.useState<Notification[]>(initialNotifications);
  const [unreadCount, setUnreadCount] = React.useState<number>(initialUnreadCount);
  const [isMarkingAll, setIsMarkingAll] = React.useState<boolean>(false);

  // Web Push opt-in status
  const [pushSupported, setPushSupported] = React.useState<boolean>(false);
  const [isPushEnabled, setIsPushEnabled] = React.useState<boolean>(false);
  const [isTogglingPush, setIsTogglingPush] = React.useState<boolean>(false);

  const containerRef = React.useRef<HTMLDivElement | null>(null);

  React.useEffect(() => {
    setNotifications(initialNotifications);
    setUnreadCount(initialUnreadCount);
  }, [initialNotifications, initialUnreadCount]);

  // Check current Service Worker push subscription state
  React.useEffect(() => {
    if (
      typeof window === 'undefined' ||
      !('serviceWorker' in navigator) ||
      !('PushManager' in window)
    ) {
      return;
    }

    setPushSupported(true);
    navigator.serviceWorker.ready
      .then((reg) => reg.pushManager.getSubscription())
      .then((sub) => {
        setIsPushEnabled(Boolean(sub) && Notification.permission === 'granted');
      })
      .catch(() => {
        // Ignore SW readiness check failures
      });
  }, []);

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
          toast.info(newNotif.title, { description: newNotif.body });
        }
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [userId]);

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
      const reg = await navigator.serviceWorker.register('/sw.js');
      await navigator.serviceWorker.ready;

      if (isPushEnabled) {
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
        toast.success('Push alerts disabled for this device.');
        return;
      }

      const vapidPublicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY?.trim();
      if (!vapidPublicKey) {
        toast.error('Push notifications require NEXT_PUBLIC_VAPID_PUBLIC_KEY to be configured.');
        return;
      }

      const permission = await window.Notification.requestPermission();
      if (permission !== 'granted') {
        toast.error('Browser notification permission was denied.');
        return;
      }

      const subscription = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
      });

      const subJson = subscription.toJSON();
      if (!subJson.endpoint || !subJson.keys?.p256dh || !subJson.keys?.auth) {
        toast.error('Could not retrieve browser push subscription keys.');
        return;
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
        toast.error(err.error || 'Failed to register push subscription.');
        return;
      }

      setIsPushEnabled(true);
      toast.success('Push alerts enabled on this device!');
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to configure push alerts.');
    } finally {
      setIsTogglingPush(false);
    }
  };

  const handleNotificationClick = async (item: Notification) => {
    setIsOpen(false);
    const targetRoute = getTargetRouteForEvent(item.event_type);

    if (!item.is_read) {
      setNotifications((prev) =>
        prev.map((n) => (n.id === item.id ? { ...n, is_read: true } : n))
      );
      setUnreadCount((prev) => Math.max(0, prev - 1));
      void markNotificationRead(item.id);
    }

    router.push(targetRoute);
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
        className="relative min-h-[38px] min-w-[38px] px-2 rounded-lg text-slate-600 hover:text-slate-900 hover:bg-slate-100 inline-flex items-center justify-center transition-colors cursor-pointer"
      >
        <Bell className="w-4 h-4" />
        {unreadCount > 0 && (
          <span className="absolute top-1 right-1 min-w-[16px] h-4 px-1 rounded-full bg-[#7F1D1D] text-white text-[10px] font-bold tabular-nums flex items-center justify-center shadow-xs">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {isOpen && (
        <div className="absolute right-0 mt-2 w-80 sm:w-96 rounded-xl border border-slate-200 bg-white shadow-xl z-50 overflow-hidden animate-in fade-in-50 zoom-in-95">
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
          {pushSupported && (
            <div className="px-4 py-2 border-b border-slate-100 bg-white flex items-center justify-between gap-2 text-[11px]">
              <span className="text-slate-500">
                {isPushEnabled ? 'Device push alerts active' : 'Get instant mobile/desktop alerts'}
              </span>
              <button
                type="button"
                onClick={handleTogglePush}
                disabled={isTogglingPush}
                className={`px-2.5 py-1 rounded-md font-semibold inline-flex items-center gap-1 transition-colors cursor-pointer ${
                  isPushEnabled
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
              notifications.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => handleNotificationClick(item)}
                  className={`w-full text-left px-4 py-3 hover:bg-slate-50 transition-colors flex items-start gap-2.5 cursor-pointer ${
                    !item.is_read ? 'bg-rose-50/35' : 'bg-white'
                  }`}
                >
                  <span
                    className={`mt-1.5 w-2 h-2 rounded-full shrink-0 ${
                      !item.is_read ? 'bg-[#7F1D1D]' : 'bg-slate-200'
                    }`}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <span
                        className={`text-xs truncate ${
                          !item.is_read
                            ? 'font-bold text-slate-900'
                            : 'font-medium text-slate-700'
                        }`}
                      >
                        {item.title}
                      </span>
                      <span className="text-[10px] text-slate-400 shrink-0 inline-flex items-center gap-0.5">
                        <Clock className="w-2.5 h-2.5" />
                        {formatRelativeTime(item.created_at)}
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-600 mt-0.5 line-clamp-2 leading-snug">
                      {item.body}
                    </p>
                  </div>
                  <ArrowRight className="w-3.5 h-3.5 text-slate-300 shrink-0 mt-1" />
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
