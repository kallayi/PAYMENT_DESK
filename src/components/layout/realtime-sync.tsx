'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

interface RealtimeSyncProps {
  companyId?: string;
  userId: string;
}

type RealtimeChannelStatus =
  | 'INITIAL'
  | 'SUBSCRIBED'
  | 'TIMED_OUT'
  | 'CHANNEL_ERROR'
  | 'CLOSED';

function isAnyDialogOpen(): boolean {
  if (typeof document === 'undefined') return false;
  return Boolean(document.querySelector('[role="dialog"], dialog[open]'));
}

/**
 * Listens for live changes across payment_items, payment_batches, payment_requests,
 * and company_banks scoped to the active company, plus online/visibility resume
 * triggers, automatic reconnect, and degraded-network fallback heartbeats.
 */
export function RealtimeSync({ companyId, userId }: RealtimeSyncProps) {
  const router = useRouter();
  const [, startTransition] = React.useTransition();
  const [reconnectTick, setReconnectTick] = React.useState<number>(0);

  const refreshTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastResumeRefreshRef = React.useRef<number>(0);
  const statusRef = React.useRef<RealtimeChannelStatus>('INITIAL');

  const triggerRefresh = React.useCallback(
    (options?: { skipIfDialogOpen?: boolean }) => {
      if (options?.skipIfDialogOpen && isAnyDialogOpen()) {
        return;
      }

      if (refreshTimerRef.current) {
        clearTimeout(refreshTimerRef.current);
      }

      refreshTimerRef.current = setTimeout(() => {
        refreshTimerRef.current = null;
        if (options?.skipIfDialogOpen && isAnyDialogOpen()) {
          return;
        }
        startTransition(() => {
          router.refresh();
        });
      }, 350);
    },
    [router]
  );

  React.useEffect(() => {
    const supabase = createClient();
    const channelName = `payment-desk-live-${companyId || 'all'}-${userId}`;
    const companyFilter = companyId ? `company_id=eq.${companyId}` : undefined;
    let isDisposed = false;

    statusRef.current = 'INITIAL';

    const scheduleReconnect = () => {
      if (isDisposed || reconnectTimerRef.current) return;
      reconnectTimerRef.current = setTimeout(() => {
        reconnectTimerRef.current = null;
        if (!isDisposed) {
          setReconnectTick((prev) => prev + 1);
        }
      }, 4000);
    };

    const channel = supabase
      .channel(channelName)
      .on(
        'postgres_changes',
        companyFilter
          ? {
              event: '*',
              schema: 'public',
              table: 'payment_items',
              filter: companyFilter,
            }
          : {
              event: '*',
              schema: 'public',
              table: 'payment_items',
            },
        () => {
          triggerRefresh();
        }
      )
      .on(
        'postgres_changes',
        companyFilter
          ? {
              event: '*',
              schema: 'public',
              table: 'payment_batches',
              filter: companyFilter,
            }
          : {
              event: '*',
              schema: 'public',
              table: 'payment_batches',
            },
        () => {
          triggerRefresh();
        }
      )
      .on(
        'postgres_changes',
        companyFilter
          ? {
              event: '*',
              schema: 'public',
              table: 'payment_requests',
              filter: companyFilter,
            }
          : {
              event: '*',
              schema: 'public',
              table: 'payment_requests',
            },
        () => {
          triggerRefresh();
        }
      )
      .on(
        'postgres_changes',
        companyFilter
          ? {
              event: 'UPDATE',
              schema: 'public',
              table: 'company_banks',
              filter: companyFilter,
            }
          : {
              event: 'UPDATE',
              schema: 'public',
              table: 'company_banks',
            },
        () => {
          triggerRefresh();
        }
      )
      .subscribe((status) => {
        if (isDisposed) return;

        if (status === 'SUBSCRIBED') {
          statusRef.current = 'SUBSCRIBED';
          if (reconnectTimerRef.current) {
            clearTimeout(reconnectTimerRef.current);
            reconnectTimerRef.current = null;
          }
        } else if (status === 'TIMED_OUT') {
          statusRef.current = 'TIMED_OUT';
          scheduleReconnect();
        } else if (status === 'CHANNEL_ERROR') {
          statusRef.current = 'CHANNEL_ERROR';
          scheduleReconnect();
        } else if (status === 'CLOSED') {
          statusRef.current = 'CLOSED';
          scheduleReconnect();
        }
      });

    const handleForegroundResume = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
        return;
      }
      const now = Date.now();
      if (now - lastResumeRefreshRef.current < 2500) {
        return;
      }
      lastResumeRefreshRef.current = now;
      triggerRefresh({ skipIfDialogOpen: true });

      if (statusRef.current !== 'SUBSCRIBED') {
        scheduleReconnect();
      }
    };

    const handleOnline = () => {
      handleForegroundResume();
      if (statusRef.current !== 'SUBSCRIBED') {
        setReconnectTick((prev) => prev + 1);
      }
    };

    document.addEventListener('visibilitychange', handleForegroundResume);
    window.addEventListener('focus', handleForegroundResume);
    window.addEventListener('online', handleOnline);

    // 12s fallback heartbeat when WebSockets are disconnected/blocked
    const degradedHeartbeat = setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') {
        return;
      }
      if (statusRef.current !== 'SUBSCRIBED') {
        triggerRefresh({ skipIfDialogOpen: true });
        scheduleReconnect();
      }
    }, 12000);

    // 45s light safety sync even when WebSockets are healthy so counts never drift
    const safetySync = setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') {
        return;
      }
      if (!isAnyDialogOpen()) {
        startTransition(() => {
          router.refresh();
        });
      }
    }, 45000);

    return () => {
      isDisposed = true;
      if (refreshTimerRef.current) {
        clearTimeout(refreshTimerRef.current);
        refreshTimerRef.current = null;
      }
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      clearInterval(degradedHeartbeat);
      clearInterval(safetySync);
      document.removeEventListener('visibilitychange', handleForegroundResume);
      window.removeEventListener('focus', handleForegroundResume);
      window.removeEventListener('online', handleOnline);
      void supabase.removeChannel(channel);
    };
  }, [companyId, userId, reconnectTick, triggerRefresh, router]);

  return null;
}
